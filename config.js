require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error(
    'FATAL: JWT_SECRET is missing or shorter than 32 characters.\n' +
      "Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
  process.exit(1);
}

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/collegeconnect',
  jwtSecret,
  jwtExpiresIn: '7d',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
  maxMessageLength: 2000,
};
