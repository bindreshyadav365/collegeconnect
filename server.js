const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const config = require('./config');
const User = require('./models/User');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const { authenticate, pageAuth, guestOnly, userFromToken, extractToken } = require('./middleware/auth');
const { AppError } = require('./utils/errors');
const { initSocket } = require('./socket/chat');

const app = express();
const server = http.createServer(app);

const originAllowed = (origin) => !origin || config.clientOrigins.includes(origin);

const io = new Server(server, {
  cors: { origin: config.clientOrigins, credentials: true },
  // Reject cross-site WebSocket / polling handshakes from unknown origins.
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
});
app.set('io', io);

app.disable('x-powered-by');
if (config.isProd) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

app.use(
  cors({
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    credentials: true,
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(mongoSanitize()); // strips $ and . operators from body/query/params

// CSRF defence in depth (cookie is SameSite=Strict): state-changing requests must come from our origin.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!originAllowed(req.headers.origin)) return next(new AppError(403, 'Origin not allowed'));
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api', (req, res, next) => next(new AppError(404, 'Not found')));

// ---- Static assets (public) ----
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: config.isProd ? '1h' : 0 }));

// ---- Pages ----
const view = (name) => (req, res) => res.sendFile(path.join(__dirname, 'views', `${name}.html`));

app.get('/', async (req, res) => {
  const user = await userFromToken(extractToken(req)).catch(() => null);
  res.redirect(user ? '/dashboard' : '/login');
});
app.get('/login', guestOnly, view('login'));
app.get('/register', guestOnly, view('register'));
app.get('/dashboard', pageAuth, view('dashboard'));
app.get('/profile', pageAuth, view('profile'));
// /chat and /chat/:conversationId share a page. The conversation id in the URL is only a
// hint for the browser: the API decides whether the user may read it (403 otherwise).
app.get(['/chat', '/chat/:conversationId'], pageAuth, view('chat'));

// ---- Errors ----
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2 MB or smaller' : 'Upload failed';
    return res.status(400).json({ error: msg });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err && err.name === 'CastError') return res.status(400).json({ error: 'Invalid id' });
  if (err && err.name === 'ValidationError') return res.status(400).json({ error: 'Invalid data' });

  const status = (err && err.status) || 500;
  if (status >= 500) console.error(err);
  const body = { error: status >= 500 ? 'Internal server error' : err.message };
  if (err && err.details) body.details = err.details;
  if (req.originalUrl.startsWith('/api')) return res.status(status).json(body);
  res.status(status).send(body.error);
});

async function start(port = config.port) {
  await mongoose.connect(config.mongoUri);
  await Promise.all([User.init(), Conversation.init(), Message.init()]);
  // Server restart edge case: sockets from the previous process are gone, so nobody is online.
  await User.updateMany({ online: true }, { $set: { online: false, lastSeen: new Date() } });
  initSocket(io);
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

async function shutdown() {
  try {
    await User.updateMany({ online: true }, { $set: { online: false, lastSeen: new Date() } });
  } catch {
    /* ignore */
  }
  io.close();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

if (require.main === module) {
  start()
    .then(() => console.log(`CollegeConnect running at http://localhost:${server.address().port}`))
    .catch((err) => {
      console.error('Failed to start:', err.message);
      process.exit(1);
    });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { app, server, io, start };
