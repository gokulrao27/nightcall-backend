# NightCall Backend

Node.js 20 / TypeScript backend for the NightCall anonymous voice call app.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript (strict) |
| HTTP | Express 5 |
| WebSocket | ws |
| Database | PostgreSQL 16 via pg |
| Cache / Queue | Redis 7 via ioredis |
| Auth | Anonymous UUID + JWT |
| Payments | Stripe |
| Push | web-push (VAPID) |
| Moderation | bad-words (local) |

## Local Development

```bash
cp .env.example .env
# fill in .env values

npm install
npm run db:migrate   # run against a local PostgreSQL database
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon + ts-node |
| `npm run check` | TypeScript strict type check |
| `npm test` | Vitest unit tests |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run db:migrate` | Apply `src/db/schema.sql` to the database |

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/init | — | Create anonymous user + issue JWT |
| POST | /auth/refresh | — | Refresh JWT |
| GET | /me | JWT | Get profile + stats |
| PUT | /me | JWT | Update pseudonym / avatar / timezone |
| DELETE | /me | JWT | Delete account (GDPR) |
| GET | /call/history | JWT | Paginated call history with saved words |
| POST | /call/end | JWT | Manually end active call |
| GET | /call/ice-config | JWT | TURN/STUN server credentials |
| POST | /word | JWT | Save a word after a call |
| GET | /wall | — | Paginated Wall posts |
| POST | /wall | JWT | Post to The Wall |
| POST | /report | JWT | Report a user |
| POST | /push/subscribe | JWT | Register push subscription |
| DELETE | /push/subscribe | JWT | Unregister push subscription |
| POST | /subscription/checkout | JWT | Create Stripe Checkout session |
| POST | /webhook | — | Stripe webhook (raw body) |
| GET | /health | — | Liveness check |

## WebSocket (`/ws?token=<jwt>`)

| Message type | Direction | Description |
|---|---|---|
| `queue:join` | C→S | Join the matchmaking queue |
| `queue:leave` | C→S | Leave the queue |
| `queue:pass` | C→S | Use a pass to skip current match |
| `queue:waiting` | S→C | Placed in queue |
| `queue:matched` | S→C | Match found — roomId + prompt |
| `queue:closed` | S→C | Line is not open |
| `queue:limit_reached` | S→C | Daily call limit hit |
| `sdp:offer` | C→S | WebRTC SDP offer (relayed to peer) |
| `sdp:answer` | C→S | WebRTC SDP answer (relayed to peer) |
| `ice` | C→S | ICE candidate (relayed to peer) |
| `call:ended` | S→C | Call ended (timer / user / system) |

## Deploy to Railway

1. Push this repo to GitHub
2. Railway → New Project → Deploy from GitHub
3. Add PostgreSQL and Redis plugins
4. Set all env vars from `.env.example`
5. Set start command: `npm start`
