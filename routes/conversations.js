const router = require('express').Router();
const ctrl = require('../controllers/conversationController');
const { authenticate } = require('../middleware/auth');
const { loadConversation } = require('../middleware/authorization');

router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', ctrl.start);
router.get('/:conversationId', loadConversation, ctrl.get);

module.exports = router;
