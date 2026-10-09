const config = require('../config');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { AppError } = require('../utils/errors');
const { isObjectId, cleanMessage } = require('../utils/validate');
const { isParticipant, otherParticipantId } = require('../middleware/authorization');

const serializeMessage = (m) => ({
  id: String(m._id),
  conversationId: String(m.conversationId),
  senderId: String(m.senderId),
  receiverId: String(m.receiverId),
  content: m.content,
  createdAt: m.createdAt,
  read: !!m.read,
  edited: !!m.edited,
});

const hasBlocked = (user, otherId) => (user.blocked || []).some((b) => String(b) === String(otherId));

function normalizeContent(content) {
  if (typeof content !== 'string') throw new AppError(400, 'Message must be text');
  const text = cleanMessage(content);
  if (!text) throw new AppError(400, 'Message cannot be empty');
  if (text.length > config.maxMessageLength) {
    throw new AppError(400, `Message is too long (max ${config.maxMessageLength} characters)`);
  }
  return text;
}

/**
 * Creates a message. Shared by REST and Socket.IO so the authorization logic exists once.
 * senderId must come from the verified session; the receiver is derived server-side
 * from the conversation, never taken from the client.
 */
async function createMessage({ senderId, conversationId, content }) {
  if (!isObjectId(conversationId)) throw new AppError(400, 'Invalid conversation id');
  const text = normalizeContent(content);

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new AppError(404, 'Conversation not found');
  if (!isParticipant(conversation, senderId)) {
    throw new AppError(403, 'You do not have access to this conversation');
  }

  const receiverId = otherParticipantId(conversation, senderId);
  if (!receiverId || String(receiverId) === String(senderId)) {
    throw new AppError(400, 'You cannot send a message to yourself');
  }

  const [sender, receiver] = await Promise.all([
    User.findById(senderId).select('+blocked'),
    User.findById(receiverId).select('+blocked'),
  ]);
  if (!sender) throw new AppError(401, 'Account no longer exists');
  if (!receiver) throw new AppError(404, 'This user no longer exists');
  if (hasBlocked(sender, receiverId)) throw new AppError(403, 'You have blocked this user. Unblock them to send messages.');
  if (hasBlocked(receiver, senderId)) throw new AppError(403, 'You cannot message this user');

  const message = await Message.create({
    conversationId: conversation._id,
    senderId,
    receiverId,
    content: text,
  });

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessage: { content: text.slice(0, 120), senderId, createdAt: message.createdAt },
        updatedAt: new Date(),
      },
    }
  );

  return { message: serializeMessage(message), receiverId: String(receiverId) };
}

// Marks everything addressed to readerId in this conversation as read.
async function markConversationRead({ conversation, readerId }) {
  const res = await Message.updateMany(
    { conversationId: conversation._id, receiverId: readerId, read: false },
    { $set: { read: true } }
  );
  return { updated: res.modifiedCount || 0, otherId: String(otherParticipantId(conversation, readerId)) };
}

async function refreshLastMessage(conversationId) {
  const last = await Message.findOne({ conversationId }).sort({ createdAt: -1, _id: -1 }).lean();
  const lastMessage = last
    ? { content: last.content.slice(0, 120), senderId: last.senderId, createdAt: last.createdAt }
    : { content: '', senderId: undefined, createdAt: undefined };
  await Conversation.updateOne({ _id: conversationId }, { $set: { lastMessage } });
}

module.exports = {
  serializeMessage,
  hasBlocked,
  normalizeContent,
  createMessage,
  markConversationRead,
  refreshLastMessage,
};
