const mongoose = require('mongoose');
const config = require('../config');

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: config.maxMessageLength },
    read: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Fetch a conversation's history newest-first with cursor pagination.
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Unread counts per receiver.
messageSchema.index({ receiverId: 1, read: 1, conversationId: 1 });

module.exports = mongoose.model('Message', messageSchema);
