const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/errors');
const { isObjectId } = require('../utils/validate');

const COOKIE_NAME = 'token';

const signToken = (userId) =>
  jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });

// Returns the payload or throws. Only HS256 is accepted (no "alg: none" tricks).
const verifyToken = (token) => jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.isProd,
  path: '/',
});

const setAuthCookie = (res, token) =>
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: config.cookieMaxAgeMs });

const clearAuthCookie = (res) => res.clearCookie(COOKIE_NAME, cookieOptions());

function extractToken(req) {
  if (req.cookies && typeof req.cookies[COOKIE_NAME] === 'string') return req.cookies[COOKIE_NAME];
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// Resolves the token to a live user document. Returns null if anything is wrong.
async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }
  if (!isObjectId(payload.sub)) return null;
  return User.findById(payload.sub).select('+blocked');
}

// API authentication: 401 JSON when not logged in / token invalid / user deleted.
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw new AppError(401, 'Authentication required');
  const user = await userFromToken(token);
  if (!user) {
    clearAuthCookie(res);
    throw new AppError(401, 'Invalid or expired session. Please log in again.');
  }
  req.user = user;
  next();
});

// Page authentication: redirect browsers to /login.
const pageAuth = asyncHandler(async (req, res, next) => {
  const user = await userFromToken(extractToken(req));
  if (!user) {
    clearAuthCookie(res);
    return res.redirect('/login');
  }
  req.user = user;
  next();
});

// Login / register pages: bounce already-logged-in users to the dashboard.
const guestOnly = asyncHandler(async (req, res, next) => {
  const user = await userFromToken(extractToken(req));
  if (user) return res.redirect('/dashboard');
  next();
});

module.exports = {
  COOKIE_NAME,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  extractToken,
  userFromToken,
  authenticate,
  pageAuth,
  guestOnly,
};
