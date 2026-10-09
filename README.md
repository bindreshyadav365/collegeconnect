# CollegeConnect

A college-only student platform with **private one-to-one real-time chat**.
Node.js · Express · MongoDB (Mongoose) · Socket.IO · vanilla JS frontend.

## Quick start

Requirements: Node.js 18+ and a MongoDB instance.

```bash
cd collegeconnect
npm install
cp .env.example .env          # Windows: copy .env.example .env
```

Generate a JWT secret and paste it into `.env` as `JWT_SECRET=`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Start MongoDB (pick one), then run the app:

```bash
# Option A: Docker
docker run -d --name cc-mongo -p 27017:27017 mongo:7

# Option B: local install (macOS: brew services start mongodb-community, Ubuntu: sudo systemctl start mongod)

# Option C: MongoDB Atlas, put your connection string in MONGODB_URI in .env

npm run seed     # optional demo students, password: Password123
npm start        # or: npm run dev (auto-reload)
```

Open <http://localhost:3000>. To try chatting, log in as two different students in two different
browsers (or one normal window and one private window).
Demo accounts: `aarav@college.edu`, `diya@college.edu`, `kabir@college.edu`, `meera@college.edu`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | yes | 32+ characters. The server refuses to start without it. |
| `MONGODB_URI` | no | Defaults to `mongodb://127.0.0.1:27017/collegeconnect`. |
| `PORT` | no | Defaults to `3000`. |
| `CLIENT_ORIGIN` | no | Comma-separated allowed origins (CORS, sockets, CSRF check). Default `http://localhost:3000`. |
| `ALLOWED_EMAIL_DOMAINS` | no | e.g. `college.edu` to restrict sign-up to college emails. Empty = any email. |
| `NODE_ENV` | no | Set `production` behind HTTPS: enables `Secure` cookies, HSTS-friendly CSP, trust proxy. |

Database setup is automatic: collections and indexes are created on first start. No migrations.

## Project structure

```
server.js              app, security middleware, pages, startup/shutdown
config.js              env validation
models/                User, Conversation, Message (+ indexes)
middleware/auth.js     JWT cookie authentication
middleware/authorization.js   participant checks (the privacy boundary)
services/messageService.js    single send/read implementation used by REST and sockets
controllers/ routes/   REST API
socket/chat.js         Socket.IO: auth, rooms, presence, typing, read receipts
views/ public/         HTML pages, CSS, browser JS
scripts/seed.js        demo data
tests/authz.test.js    attack-scenario tests
```

## How private chat is protected

1. **Identity comes only from the signed JWT** (httpOnly, SameSite=Strict cookie). No route or socket event
   ever accepts a sender/user id from the client.
2. **Every conversation route** (`GET/POST /api/messages/:conversationId`, `/read`,
   `GET /api/conversations/:id`) runs `loadConversation`: valid id (400) → exists (404) →
   authenticated user is one of the two participants (**403**). Message queries are then scoped to the
   conversation that passed the check.
3. **Edit/delete** (`/api/messages/item/:id`) requires being a participant *and* the original sender.
4. **The receiver is derived on the server** from the conversation, so a client can't address a message to anyone else.
5. **Sockets** authenticate from the same cookie, join only their own `user:<id>` room, and every
   `message:send`, `typing`, `messages:read` event re-checks participation. Messages are delivered only
   to the two participants' rooms.
6. **One conversation per pair** is enforced by a unique index on a sorted `participantKey`.
7. Typing a URL like `/chat/<someone-else's-id>` only loads the page shell; the API returns 403 and the UI shows "no access".

Other protections: bcrypt (12 rounds) password hashing, generic login errors with timing equalization,
`express-mongo-sanitize` plus strict type checks on every input, regex-escaped search, HTML-tag stripping
plus `textContent`-only rendering and a strict CSP (no inline scripts/styles), Helmet headers, CORS
allow-list, Origin check on writes, rate limits (API, auth endpoints, per-socket), 10 KB JSON body limit,
avatar uploads limited to 2 MB with magic-byte verification and random filenames, no password/email in
other users' views.

## Edge cases

Self-message (400) · other person's chat (403) · editing another's message (403) · logged out (401, pages redirect)
· unknown user/conversation (404) · empty message (400) · duplicate conversation (same one returned) ·
blocking (neither side can send; hidden from search; unblock from chat or Profile) ·
socket reconnect (auto-reconnect, banner, missed messages re-fetched) · server restart (everyone reset to
offline on boot; JWTs are stateless so sessions survive) · invalid/expired JWT (401, cookie cleared) ·
direct API tampering (all covered above).

## Tests

```bash
npm test
```

Starts the app against an in-memory MongoDB (downloads a MongoDB binary the first time) and plays Student C
attacking Student A and B's conversation over REST and Socket.IO, plus auth, blocking and injection checks.

## Notes

- Uses `bcryptjs` (pure JavaScript bcrypt) so installation works everywhere without native compilation.
  To use the native `bcrypt` package instead, swap the `require` in `controllers/authController.js` and `scripts/seed.js`.
- Messages are stored in plain text in MongoDB (not end-to-end encrypted). Anyone with database access can read them.
- Online status is visible to all logged-in students, since search shows it.
- For production, serve over HTTPS, set `NODE_ENV=production`, and use a persistent store for uploads (they live in `public/uploads/avatars`).
