const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/errors');
const { isObjectId, profileValues, escapeRegex, cleanLine } = require('../utils/validate');

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');

const optionalString = (v, name) => {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string') throw new AppError(400, `Invalid ${name}`);
  return cleanLine(v).slice(0, 60);
};

exports.search = asyncHandler(async (req, res) => {
  const q = optionalString(req.query.q, 'name');
  const college = optionalString(req.query.college, 'college');
  const branch = optionalString(req.query.branch, 'branch');

  let year;
  if (req.query.year !== undefined && req.query.year !== '') {
    year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1 || year > 6) throw new AppError(400, 'Invalid year');
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  // Never list myself, people I blocked, or people who blocked me.
  const filter = {
    _id: { $nin: [req.user._id, ...req.user.blocked] },
    blocked: { $ne: req.user._id },
  };
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  if (college) filter.college = new RegExp(escapeRegex(college), 'i');
  if (branch) filter.branch = new RegExp(escapeRegex(branch), 'i');
  if (year) filter.year = year;

  const docs = await User.find(filter)
    .sort({ online: -1, name: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  res.json({ users: docs.slice(0, limit).map((u) => User.publicShape(u)), page, hasMore });
});

exports.getUser = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw new AppError(400, 'Invalid user id');
  const user = await User.findById(req.params.id).select('+blocked');
  // Treat "blocked me" exactly like "does not exist".
  if (!user || user.blocked.some((b) => String(b) === String(req.user._id))) {
    throw new AppError(404, 'User not found');
  }
  res.json({ user: User.publicShape(user) });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const { errors, values } = profileValues(req.body, { requireAll: false });
  if (Object.keys(errors).length) throw new AppError(400, 'Please fix the highlighted fields', errors);
  if (!Object.keys(values).length) throw new AppError(400, 'Nothing to update');
  // Only whitelisted, validated fields are applied (no mass assignment of email/password/etc).
  Object.assign(req.user, values);
  await req.user.save();
  res.json({ user: User.selfShape(req.user) });
});

const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/gif': (b) => b.slice(0, 3).toString() === 'GIF',
  'image/webp': (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
};

exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'Choose an image to upload');
  const file = req.file;
  const fd = fs.openSync(file.path, 'r');
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  if (!MAGIC[file.mimetype] || !MAGIC[file.mimetype](head)) {
    fs.unlink(file.path, () => {});
    throw new AppError(400, 'That file is not a valid image');
  }

  const old = req.user.profilePicture;
  req.user.profilePicture = `/uploads/avatars/${file.filename}`;
  await req.user.save();

  if (old && old.startsWith('/uploads/avatars/')) {
    fs.unlink(path.join(AVATAR_DIR, path.basename(old)), () => {});
  }
  res.json({ user: User.selfShape(req.user) });
});

exports.listBlocked = asyncHandler(async (req, res) => {
  const users = await User.find({ _id: { $in: req.user.blocked } }).sort({ name: 1 }).lean();
  res.json({ users: users.map((u) => User.publicShape(u)) });
});

exports.block = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isObjectId(id)) throw new AppError(400, 'Invalid user id');
  if (id === String(req.user._id)) throw new AppError(400, 'You cannot block yourself');
  const target = await User.findById(id).select('_id');
  if (!target) throw new AppError(404, 'User not found');
  await User.updateOne({ _id: req.user._id }, { $addToSet: { blocked: target._id } });
  res.json({ ok: true });
});

exports.unblock = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!isObjectId(id)) throw new AppError(400, 'Invalid user id');
  await User.updateOne({ _id: req.user._id }, { $pull: { blocked: id } });
  res.json({ ok: true });
});
