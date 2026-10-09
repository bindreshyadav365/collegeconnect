const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { AppError, asyncHandler } = require('../utils/errors');
const { isObjectId } = require('../utils/validate');
const { otherParticipantId } = require('../middleware/authorization');
const { hasBlocked } = require('../services/messageService');

const PARTICIPANT_SELECT = 'name profilePicture online lastSeen branch year college bio +blocked';

// Builds the list/detail shape. `me` is the authenticated user document (with +blocked).
function summarize(conversation, me, unreadMap) {
  const other = conversation.participants.find((p) => String(p._id) !== String(me._id));
  const blockedByMe = hasBlocked(me, other._id);
  const blockedMe = hasBlocked(other, me._id);
  return {
    id: String(conversation._id),
    user: User.publicShape(other),
    lastMessage: conversation.lastMessage && conversation.lastMessage.content
      ? {
          content: conversation.lastMessage.content,
          senderId: String(conversation.lastMessage.senderId),
          createdAt: conversation.lastMessage.createdAt,
        }
      : null,
    unread: (unreadMap && unreadMap.get(String(conversation._id))) || 0,
    updatedAt: conversation.updatedAt,
    blockedByMe,
    // Deliberately doesn't reveal *who* blocked, only that messaging isn't possible.
    canMessage: !blockedByMe && !blockedMe,
  };
}

exports.list = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(200)
    .populate({ path: 'participants', select: PARTICIPANT_SELECT });

  const unread = await Message.aggregate([
    { $match: { receiverId: req.user._id, read: false } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.count]));

  res.json({
    conversations: conversations
      .filter((c) => c.participants.length === 2 && c.participants.every(Boolean))
      .map((c) => summarize(c, req.user, unreadMap)),
  });
});

// Find-or-create the single conversation between me and another student.
exports.start = asyncHandler(async (req, res) => {
  const targetId = req.body && req.body.userId;
  if (!isObjectId(targetId)) throw new AppError(400, 'A valid userId is required');
  if (targetId === String(req.user._id)) throw new AppError(400, 'You cannot start a conversation with yourself');

  const target = await User.findById(targetId).select('+blocked');
  if (!target) throw new AppError(404, 'User not found');
  if (hasBlocked(req.user, target._id)) throw new AppError(403, 'You have blocked this user. Unblock them first.');
  if (hasBlocked(target, req.user._id)) throw new AppError(404, 'User not found');

  const { conversation, created } = await Conversation.findOrCreateBetween(req.user._id, target._id);
  await conversation.populate({ path: 'participants', select: PARTICIPANT_SELECT });

  res.status(created ? 201 : 200).json({ conversation: summarize(conversation, req.user) });
});

// req.conversation was loaded and participant-checked by loadConversation.
exports.get = asyncHandler(async (req, res) => {
  const conversation = await req.conversation.populate({ path: 'participants', select: PARTICIPANT_SELECT });
  if (!otherParticipantId(conversation, req.user._id)) throw new AppError(404, 'Conversation not found');
  const unread = await Message.countDocuments({
    conversationId: conversation._id,
    receiverId: req.user._id,
    read: false,
  });
  res.json({ conversation: summarize(conversation, req.user, new Map([[String(conversation._id), unread]])) });
});
