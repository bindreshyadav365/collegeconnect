const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/errors');
const { validateEmail, validatePassword, profileValues } = require('../utils/validate');
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  extractToken,
  verifyToken,
} = require('../middleware/auth');

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', BCRYPT_ROUNDS);

exports.register = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { errors, values } = profileValues(body, { requireAll: true });

  const email = validateEmail(body.email);
  if (email.error) errors.email = email.error;
  const pwError = validatePassword(body.password);
  if (pwError) errors.password = pwError;

  if (Object.keys(errors).length) throw new AppError(400, 'Please fix the highlighted fields', errors);

  const password = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await User.create({ ...values, email: email.value, password });
  } catch (err) {
    if (err && err.code === 11000) {
      throw new AppError(409, 'An account with this email already exists', {
        email: 'Email already registered',
      });
    }
    throw err;
  }

  setAuthCookie(res, signToken(user._id));
  res.status(201).json({ user: User.selfShape(user) });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  // typeof checks stop NoSQL operator objects such as {"$gt": ""} from reaching the query.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new AppError(400, 'Email and password are required');
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'Invalid email or password');

  setAuthCookie(res, signToken(user._id));
  res.json({ user: User.selfShape(user) });
});

exports.logout = asyncHandler(async (req, res) => {
  // Drop live sockets belonging to this session's user, if the token is still valid.
  try {
    const token = extractToken(req);
    if (token) {
      const { sub } = verifyToken(token);
      const io = req.app.get('io');
      if (io) io.in(`user:${sub}`).disconnectSockets(true);
    }
  } catch {
    /* invalid token: nothing to disconnect */
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: User.selfShape(req.user) });
});
