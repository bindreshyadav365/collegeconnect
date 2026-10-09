const Message = require('../models/Message');
const { AppError, asyncHandler } = require('../utils/errors');
const {
  serializeMessage,
  createMessage,
  normalizeContent,
  markConversationRead,
  refreshLastMessage,
} = require('../services/messageService');
const { otherParticipantId } = require('../middleware/authorization');

const emitTo = (req, userIds, event, payload) => {
  const io = req.app.get('io');
  if (!io) return;
  userIds.forEach((id) => io.to(`user:${id}`).emit(event, payload));
};

// History for a conversation. The query is scoped to the conversation that
// loadConversation already proved the caller belongs to.
exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = { conversationId: req.conversation._id };

  if (req.query.before !== undefined) {
    if (typeof req.query.before !== 'string' || Number.isNaN(Date.parse(req.query.before))) {
      throw new AppError(400, 'Invalid "before" cursor');
    }
    filter.createdAt = { $lt: new Date(req.query.before) };
  }
  if (req.query.after !== undefined) {
    if (typeof req.query.after !== 'string' || Number.isNaN(Date.parse(req.query.after))) {
      throw new AppError(400, 'Invalid "after" cursor');
    }
    filter.createdAt = { ...(filter.createdAt || {}), $gt: new Date(req.query.after) };
  }

  const docs = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit).reverse();
  res.json({ messages: page.map(serializeMessage), hasMore });
});

// REST fallback for sending (used when the socket is down). Same service as sockets.
exports.send = asyncHandler(async (req, res) => {
  const { message, receiverId } = await createMessage({
    senderId: req.user._id,
    conversationId: String(req.conversation._id),
    content: req.body && req.body.content,
  });
  emitTo(req, [String(req.user._id), receiverId], 'message:new', message);
  res.status(201).json({ message });
});

exports.markRead = asyncHandler(async (req, res) => {
  const { updated, otherId } = await markConversationRead({
    conversation: req.conversation,
    readerId: req.user._id,
  });
  if (updated) {
    emitTo(req, [otherId], 'messages:read', {
      conversationId: String(req.conversation._id),
      readerId: String(req.user._id),
    });
  }
  res.json({ updated });
});

// req.message / req.conversation set by loadOwnMessage (participant AND sender).
exports.edit = asyncHandler(async (req, res) => {
  const content = normalizeContent(req.body && req.body.content);
  req.message.content = content;
  req.message.edited = true;
  await req.message.save();
  await refreshLastMessage(req.conversation._id);

  const payload = serializeMessage(req.message);
  emitTo(req, [String(req.user._id), String(otherParticipantId(req.conversation, req.user._id))], 'message:updated', payload);
  res.json({ message: payload });
});

exports.remove = asyncHandler(async (req, res) => {
  const payload = { id: String(req.message._id), conversationId: String(req.conversation._id) };
  await Message.deleteOne({ _id: req.message._id });
  await refreshLastMessage(req.conversation._id);
  emitTo(req, [String(req.user._id), String(otherParticipantId(req.conversation, req.user._id))], 'message:deleted', payload);
  res.json({ ok: true });
});
