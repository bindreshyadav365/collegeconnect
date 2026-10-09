const crypto = require('crypto');
const path = require('path');
const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../utils/errors');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads', 'avatars'),
    // Random server-chosen name: the client-supplied filename is never used.
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT[file.mimetype]) return cb(new AppError(400, 'Only JPG, PNG, GIF or WebP images are allowed'));
    cb(null, true);
  },
});

router.use(authenticate);

router.get('/', ctrl.search);
router.put('/me', ctrl.updateMe);
router.post('/me/avatar', upload.single('avatar'), ctrl.uploadAvatar);
router.get('/blocked', ctrl.listBlocked);
router.get('/:id', ctrl.getUser);
router.post('/:id/block', ctrl.block);
router.delete('/:id/block', ctrl.unblock);

module.exports = router;
