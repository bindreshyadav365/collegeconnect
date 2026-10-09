const config = require('../config');

const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

// Remove anything that looks like an HTML tag. Rendering on the client always uses
// textContent as well, and CSP blocks inline scripts, so this is defence in depth.
const stripTags = (s) => s.replace(/<\/?[a-z!][^>]*>/gi, '');

// Single-line text (names, college, ...)
const cleanLine = (s) =>
  stripTags(String(s))
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Multi-line text (messages): keep \n and \t
const cleanMessage = (s) =>
  stripTags(String(s))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  if (typeof email !== 'string') return { error: 'Email is required' };
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !EMAIL_RE.test(value)) return { error: 'Enter a valid email address' };
  if (config.allowedEmailDomains.length) {
    const domain = value.split('@')[1];
    if (!config.allowedEmailDomains.includes(domain)) {
      return { error: `Use your college email (${config.allowedEmailDomains.join(', ')})` };
    }
  }
  return { value };
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(password) > 72) return 'Password is too long (max 72 bytes)';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}

// Validates profile fields. With requireAll every required field must be present
// (registration); otherwise only supplied fields are validated (profile update).
function profileValues(body, { requireAll = false } = {}) {
  const errors = {};
  const values = {};
  body = body && typeof body === 'object' ? body : {};

  const text = (key, label, min, max, required) => {
    if (body[key] === undefined) {
      if (required) errors[key] = `${label} is required`;
      return;
    }
    if (typeof body[key] !== 'string') {
      errors[key] = `${label} must be text`;
      return;
    }
    const s = cleanLine(body[key]);
    if (required || s) {
      if (s.length < min) errors[key] = `${label} must be at least ${min} characters`;
      else if (s.length > max) errors[key] = `${label} must be at most ${max} characters`;
    }
    values[key] = s;
  };

  text('name', 'Name', 2, 60, requireAll);
  text('college', 'College', 2, 100, requireAll);
  text('branch', 'Branch', 2, 100, requireAll);
  text('bio', 'Bio', 0, 200, false);

  if (body.year === undefined) {
    if (requireAll) errors.year = 'Year is required';
  } else {
    const n = Number(body.year);
    if (!Number.isInteger(n) || n < 1 || n > 6) errors.year = 'Year must be a number from 1 to 6';
    else values.year = n;
  }

  return { errors, values };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  isObjectId,
  cleanLine,
  cleanMessage,
  validateEmail,
  validatePassword,
  profileValues,
  escapeRegex,
};
