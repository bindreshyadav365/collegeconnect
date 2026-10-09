const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2 && String(v[0]) !== String(v[1]),
        message: 'A conversation needs exactly two different participants',
      },
    },
    // "<smallerId>_<largerId>": a unique index on this makes duplicate conversations
    // between the same two users impossible, even under concurrent requests.
    participantKey: { type: String, required: true, unique: true },
    lastMessage: {
      content: { type: String, default: '' },
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date },
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });

conversationSchema.statics.keyFor = (a, b) => [String(a), String(b)].sort().join('_');

conversationSchema.statics.findOrCreateBetween = async function (a, b) {
  const key = this.keyFor(a, b);
  const existing = await this.findOne({ participantKey: key });
  if (existing) return { conversation: existing, created: false };
  try {
    const sorted = [String(a), String(b)].sort();
    const conversation = await this.create({ participants: sorted, participantKey: key });
    return { conversation, created: true };
  } catch (err) {
    if (err && err.code === 11000) {
      // Lost a race with a concurrent request: return the winner's conversation.
      return { conversation: await this.findOne({ participantKey: key }), created: false };
    }
    throw err;
  }
};

module.exports = mongoose.model('Conversation', conversationSchema);
