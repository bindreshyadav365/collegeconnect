const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { AppError, asyncHandler } = require('../utils/errors');
const { isObjectId } = require('../utils/validate');

// The one participant check used by REST routes, services and sockets.
//   authenticatedUserId === participants[0] OR authenticatedUserId === participants[1]
const isParticipant = (conversation, userId) =>
  conversation.participants.some((p) => String((p && p._id) || p) === String(userId));

const otherParticipantId = (conversation, userId) =>
  conversation.participants.find((p) => String((p && p._id) || p) !== String(userId));

/**
 * Authorization middleware for any route with a :conversationId param.
 * Runs AFTER `authenticate`. The user id always comes from the verified token
 * (req.user), never from the request body/query/params.
 *   invalid id      -> 400
 *   no such convo   -> 404
 *   not a member    -> 403
 */
const loadConversation = asyncHandler(async (req, res, next) => {
  const id = req.params.conversationId;
  if (!isObjectId(id)) throw new AppError(400, 'Invalid conversation id');
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new AppError(404, 'Conversation not found');
  if (!isParticipant(conversation, req.user._id)) {
    throw new AppError(403, 'You do not have access to this conversation');
  }
  req.conversation = conversation;
  next();
});

/**
 * For routes acting on a single message (edit / delete). The caller must be a
 * participant of the message's conversation AND the sender of the message.
 */
const loadOwnMessage = asyncHandler(async (req, res, next) => {
  const id = req.params.messageId;
  if (!isObjectId(id)) throw new AppError(400, 'Invalid message id');
  const message = await Message.findById(id);
  if (!message) throw new AppError(404, 'Message not found');
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation || !isParticipant(conversation, req.user._id)) {
    throw new AppError(403, 'You do not have access to this message');
  }
  if (String(message.senderId) !== String(req.user._id)) {
    throw new AppError(403, 'You can only modify your own messages');
  }
  req.message = message;
  req.conversation = conversation;
  next();
});

module.exports = { isParticipant, otherParticipantId, loadConversation, loadOwnMessage };
