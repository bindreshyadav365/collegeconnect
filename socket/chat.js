const cookie = require('cookie');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { COOKIE_NAME, userFromToken } = require('../middleware/auth');
const { isObjectId } = require('../utils/validate');
const { isParticipant, otherParticipantId } = require('../middleware/authorization');
const { createMessage, markConversationRead } = require('../services/messageService');

// userId -> number of open sockets (a student may have several tabs/devices)
const connections = new Map();

// Simple per-socket limiter: at most 20 events per 10 seconds.
function makeLimiter(max = 20, windowMs = 10000) {
  let hits = [];
  return () => {
    const now = Date.now();
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

const errorMessage = (err) =>
  err && err.status ? err.message : 'Something went wrong. Please try again.';

function initSocket(io) {
  // Authenticate every connection from the httpOnly session cookie.
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const token = cookie.parse(raw)[COOKIE_NAME];
      const user = await userFromToken(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId; // always from the verified token, never from the client
    const allowed = makeLimiter();
    socket.join(`user:${userId}`);

    const count = (connections.get(userId) || 0) + 1;
    connections.set(userId, count);
    if (count === 1) {
      await User.updateOne({ _id: userId }, { $set: { online: true } }).catch(() => {});
      io.emit('presence', { userId, online: true, lastSeen: null });
    }

    // Send a message. ack({ ok, message | error })
    socket.on('message:send', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!allowed()) return reply({ ok: false, error: 'You are sending messages too fast' });
        if (!payload || typeof payload !== 'object') return reply({ ok: false, error: 'Invalid request' });
        const { message, receiverId } = await createMessage({
          senderId: userId,
          conversationId: payload.conversationId,
          content: payload.content,
        });
        io.to(`user:${userId}`).to(`user:${receiverId}`).emit('message:new', message);
        reply({ ok: true, message });
      } catch (err) {
        reply({ ok: false, error: errorMessage(err), status: err.status || 500 });
      }
    });

    socket.on('typing', async (payload) => {
      try {
        if (!allowed() || !payload || !isObjectId(payload.conversationId)) return;
        const conv = await Conversation.findById(payload.conversationId).select('participants');
        if (!conv || !isParticipant(conv, userId)) return;
        io.to(`user:${otherParticipantId(conv, userId)}`).emit('typing', {
          conversationId: String(conv._id),
          userId,
          typing: !!payload.typing,
        });
      } catch {
        /* ignore */
      }
    });

    socket.on('messages:read', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!payload || !isObjectId(payload.conversationId)) return reply({ ok: false });
        const conv = await Conversation.findById(payload.conversationId);
        if (!conv || !isParticipant(conv, userId)) return reply({ ok: false, error: 'Forbidden' });
        const { updated, otherId } = await markConversationRead({ conversation: conv, readerId: userId });
        if (updated) {
          io.to(`user:${otherId}`).emit('messages:read', { conversationId: String(conv._id), readerId: userId });
        }
        reply({ ok: true, updated });
      } catch {
        reply({ ok: false });
      }
    });

    socket.on('disconnect', async () => {
      const left = (connections.get(userId) || 1) - 1;
      if (left > 0) return connections.set(userId, left);
      connections.delete(userId);
      const lastSeen = new Date();
      await User.updateOne({ _id: userId }, { $set: { online: false, lastSeen } }).catch(() => {});
      io.emit('presence', { userId, online: false, lastSeen });
    });
  });
}

module.exports = { initSocket };
