// End-to-end authorization tests using an in-memory MongoDB. Run: npm test
// Simulates Student C attacking the private A<->B conversation over REST and Socket.IO.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123456';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { io: ioClient } = require('socket.io-client');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ✓', name); };

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('collegeconnect_test');
  const { start, server, io } = require('../server');
  await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, cookie, headers } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null };
  }

  async function register(name, email) {
    const r = await call('POST', '/api/auth/register', {
      body: { name, email, password: 'Password123', college: 'Test College', branch: 'CSE', year: 2 },
    });
    assert.strictEqual(r.status, 201, `register ${email}: ${JSON.stringify(r.data)}`);
    return { cookie: r.cookie, user: r.data.user };
  }

  console.log('Auth');
  const A = await register('Alice A', 'a@test.edu');
  const B = await register('Bob B', 'b@test.edu');
  const C = await register('Carol C', 'c@test.edu');
  ok('three students registered');

  assert.ok(!('password' in A.user), 'password leaked');
  ok('password is never returned');

  let r = await call('POST', '/api/auth/register', {
    body: { name: 'Dup', email: 'A@test.edu', password: 'Password123', college: 'X1', branch: 'CSE', year: 1 },
  });
  assert.strictEqual(r.status, 409);
  ok('duplicate email rejected (409)');

  r = await call('POST', '/api/auth/login', { body: { email: { $gt: '' }, password: { $gt: '' } } });
  assert.strictEqual(r.status, 400);
  ok('NoSQL operator injection in login rejected');

  r = await call('POST', '/api/auth/login', { body: { email: 'a@test.edu', password: 'wrong-password1' } });
  assert.strictEqual(r.status, 401);
  ok('wrong password -> 401');

  r = await call('GET', '/api/conversations');
  assert.strictEqual(r.status, 401);
  ok('not logged in -> 401');

  r = await call('GET', '/api/conversations', { cookie: 'token=not-a-jwt' });
  assert.strictEqual(r.status, 401);
  ok('invalid JWT -> 401');

  r = await call('GET', '/chat', {});
  assert.strictEqual(r.status, 302);
  ok('protected page redirects when logged out');

  console.log('Conversations');
  r = await call('POST', '/api/conversations', { cookie: A.cookie, body: { userId: A.user.id } });
  assert.strictEqual(r.status, 400);
  ok('conversation with yourself rejected');

  r = await call('POST', '/api/conversations', { cookie: A.cookie, body: { userId: '507f1f77bcf86cd799439011' } });
  assert.strictEqual(r.status, 404);
  ok('unknown user -> 404');

  r = await call('POST', '/api/conversations', { cookie: A.cookie, body: { userId: { $ne: null } } });
  assert.strictEqual(r.status, 400);
  ok('operator object as userId rejected');

  r = await call('POST', '/api/conversations', { cookie: A.cookie, body: { userId: B.user.id } });
  assert.strictEqual(r.status, 201);
  const convId = r.data.conversation.id;
  const r2 = await call('POST', '/api/conversations', { cookie: A.cookie, body: { userId: B.user.id } });
  const r3 = await call('POST', '/api/conversations', { cookie: B.cookie, body: { userId: A.user.id } });
  assert.strictEqual(r2.data.conversation.id, convId);
  assert.strictEqual(r3.data.conversation.id, convId);
  ok('duplicate conversation (either direction) returns the same one');

  const [p, q] = await Promise.all(
    [0, 1].map(() => call('POST', '/api/conversations', { cookie: C.cookie, body: { userId: A.user.id } }))
  );
  assert.strictEqual(p.data.conversation.id, q.data.conversation.id);
  ok('concurrent creation does not duplicate');

  console.log('Messaging (A <-> B)');
  r = await call('POST', `/api/messages/${convId}`, { cookie: A.cookie, body: { content: 'secret hello <script>alert(1)</script>' } });
  assert.strictEqual(r.status, 201);
  assert.ok(!r.data.message.content.includes('<script>'), 'HTML tags should be stripped');
  const msgId = r.data.message.id;
  ok('A can send; HTML tags stripped');

  r = await call('POST', `/api/messages/${convId}`, { cookie: A.cookie, body: { content: '   ' } });
  assert.strictEqual(r.status, 400);
  ok('empty message rejected');

  r = await call('GET', `/api/messages/${convId}`, { cookie: B.cookie });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.messages.length, 1);
  ok('B can read the conversation');

  console.log('Attacks by Student C');
  r = await call('GET', `/api/messages/${convId}`, { cookie: C.cookie });
  assert.strictEqual(r.status, 403);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
  ok('C cannot read A-B messages (403, no content leaked)');

  r = await call('GET', `/api/conversations/${convId}`, { cookie: C.cookie });
  assert.strictEqual(r.status, 403);
  ok('C cannot open the conversation (403)');

  r = await call('POST', `/api/messages/${convId}`, { cookie: C.cookie, body: { content: 'injected' } });
  assert.strictEqual(r.status, 403);
  ok('C cannot post into the conversation (403)');

  r = await call('POST', `/api/messages/${convId}`, {
    cookie: C.cookie, body: { content: 'injected', senderId: A.user.id, receiverId: B.user.id, conversationId: convId },
  });
  assert.strictEqual(r.status, 403);
  ok('spoofed senderId/receiverId in body ignored (403)');

  r = await call('POST', `/api/messages/${convId}/read`, { cookie: C.cookie });
  assert.strictEqual(r.status, 403);
  ok('C cannot mark messages read (403)');

  r = await call('PATCH', `/api/messages/item/${msgId}`, { cookie: C.cookie, body: { content: 'hacked' } });
  assert.strictEqual(r.status, 403);
  r = await call('DELETE', `/api/messages/item/${msgId}`, { cookie: C.cookie });
  assert.strictEqual(r.status, 403);
  ok('C cannot edit or delete A\'s message (403)');

  r = await call('PATCH', `/api/messages/item/${msgId}`, { cookie: B.cookie, body: { content: 'hacked' } });
  assert.strictEqual(r.status, 403);
  ok('B (a participant, but not the sender) cannot edit A\'s message (403)');

  r = await call('GET', '/api/messages/not-an-id', { cookie: C.cookie });
  assert.strictEqual(r.status, 400);
  r = await call('GET', '/api/messages/507f1f77bcf86cd799439011', { cookie: C.cookie });
  assert.strictEqual(r.status, 404);
  r = await call('GET', '/api/messages/%7B%22%24ne%22%3Anull%7D', { cookie: C.cookie });
  assert.strictEqual(r.status, 400);
  ok('malformed / unknown / operator conversation ids -> 400/404');

  r = await call('GET', '/api/conversations', { cookie: C.cookie });
  assert.ok(r.data.conversations.every((c) => c.id !== convId));
  ok('C\'s conversation list never includes A-B');

  r = await call('POST', `/api/messages/${convId}`, { cookie: A.cookie, headers: { Origin: 'https://evil.example' }, body: { content: 'x' } });
  assert.strictEqual(r.status, 403);
  ok('cross-origin write rejected');

  console.log('Sockets');
  const connect = (cookie) =>
    new Promise((resolve, reject) => {
      const s = ioClient(base, { extraHeaders: { Cookie: cookie }, reconnection: false, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  await assert.rejects(
    new Promise((resolve, reject) => {
      const s = ioClient(base, { reconnection: false, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    })
  );
  ok('socket without a session is refused');

  const sA = await connect(A.cookie);
  const sB = await connect(B.cookie);
  const sC = await connect(C.cookie);
  const cSeen = [];
  sC.on('message:new', (m) => cSeen.push(m));

  const gotB = new Promise((resolve) => sB.once('message:new', resolve));
  const ack = await new Promise((resolve) => sA.emit('message:send', { conversationId: convId, content: 'realtime hi' }, resolve));
  assert.strictEqual(ack.ok, true);
  const received = await gotB;
  assert.strictEqual(received.content, 'realtime hi');
  ok('B receives A\'s message in real time');

  const evil = await new Promise((resolve) => sC.emit('message:send', { conversationId: convId, content: 'sneaky' }, resolve));
  assert.strictEqual(evil.ok, false);
  assert.strictEqual(evil.status, 403);
  ok('C cannot send via socket (403)');

  const evilRead = await new Promise((resolve) => sC.emit('messages:read', { conversationId: convId }, resolve));
  assert.strictEqual(evilRead.ok, false);
  ok('C cannot mark read via socket');

  await new Promise((r2) => setTimeout(r2, 300));
  assert.strictEqual(cSeen.length, 0, 'C received a private message');
  ok('C never receives A-B messages on its socket');

  console.log('Blocking');
  r = await call('POST', `/api/users/${B.user.id}/block`, { cookie: A.cookie });
  assert.strictEqual(r.status, 200);
  r = await call('POST', `/api/messages/${convId}`, { cookie: A.cookie, body: { content: 'blocked?' } });
  assert.strictEqual(r.status, 403);
  r = await call('POST', `/api/messages/${convId}`, { cookie: B.cookie, body: { content: 'blocked?' } });
  assert.strictEqual(r.status, 403);
  ok('neither side can send after A blocks B');

  r = await call('GET', '/api/users?q=Bob', { cookie: A.cookie });
  assert.ok(!r.data.users.some((u) => u.id === B.user.id));
  r = await call('GET', '/api/users?q=Alice', { cookie: B.cookie });
  assert.ok(!r.data.users.some((u) => u.id === A.user.id));
  ok('blocked users disappear from each other\'s search');

  r = await call('GET', '/api/users?q=Carol', { cookie: A.cookie });
  assert.strictEqual(r.data.users.length, 1);
  assert.ok(!('email' in r.data.users[0]));
  ok('search works and never exposes email');

  console.log('Logout');
  const drop = new Promise((resolve) => sA.once('disconnect', resolve));
  r = await call('POST', '/api/auth/logout', { cookie: A.cookie });
  assert.strictEqual(r.status, 200);
  await drop;
  ok('logout disconnects live sockets');

  [sA, sB, sC].forEach((s) => s.close());
  io.close();
  await require('mongoose').disconnect();
  await mongod.stop();
  console.log(`\nAll ${passed} checks passed.`);
  process.exit(0);
})().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
