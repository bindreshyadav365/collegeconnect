const router = require('express').Router();
const ctrl = require('../controllers/messageController');
const { authenticate } = require('../middleware/auth');
const { loadConversation, loadOwnMessage } = require('../middleware/authorization');

router.use(authenticate);

// Single-message routes (declared first so "item" is never read as a conversation id)
router.patch('/item/:messageId', loadOwnMessage, ctrl.edit);
router.delete('/item/:messageId', loadOwnMessage, ctrl.remove);

// Conversation-scoped routes: every one passes through the participant check.
router.get('/:conversationId', loadConversation, ctrl.list);
router.post('/:conversationId', loadConversation, ctrl.send);
router.post('/:conversationId/read', loadConversation, ctrl.markRead);

module.exports = router;
