const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, select: false },
    college: { type: String, required: true, trim: true, maxlength: 100 },
    branch: { type: String, required: true, trim: true, maxlength: 100 },
    year: { type: Number, required: true, min: 1, max: 6 },
    profilePicture: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 200 },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    blocked: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [], select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

userSchema.index({ name: 1 });
userSchema.index({ college: 1, branch: 1, year: 1 });
userSchema.index({ online: -1, name: 1 });

// Safe shape other students may see. Never includes email, password or block list.
userSchema.statics.publicShape = function (u) {
  return {
    id: String(u._id),
    name: u.name,
    college: u.college,
    branch: u.branch,
    year: u.year,
    profilePicture: u.profilePicture || '',
    bio: u.bio || '',
    online: !!u.online,
    lastSeen: u.lastSeen,
  };
};

// Shape returned to the user themself.
userSchema.statics.selfShape = function (u) {
  return { ...this.publicShape(u), email: u.email, createdAt: u.createdAt };
};

module.exports = mongoose.model('User', userSchema);
