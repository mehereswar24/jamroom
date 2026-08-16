# Deploying JamRoom on Vercel

JamRoom now runs 100% serverless: standard Next.js on Vercel, realtime via
**Ably**, and state via **Upstash Redis**. No custom server, no WebSocket
server to host.

## 1. Create the two free services

### Ably (realtime)
1. Sign up at https://ably.com → create an app.
2. **API Keys** → copy the root key (needs Publish, Subscribe, Presence — the
   default key has all three). It looks like `xxxx.yyyy:zzzz`.

### Upstash Redis (state)
1. Sign up at https://upstash.com → **Create Database** (Redis, pick a region
   near your users).
2. Open the database → **REST API** section → copy `UPSTASH_REDIS_REST_URL`
   and `UPSTASH_REDIS_REST_TOKEN`.

### Spotify (playlist import — optional)
- https://developer.spotify.com/dashboard → Create app → copy Client ID/Secret.

## 2. Set environment variables on Vercel

Project → Settings → Environment Variables (Production + Preview):

| Variable | From |
|----------|------|
| `ABLY_API_KEY` | Ably API key |
| `ROOM_IDENTITY_SECRET` | **Required.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |
| `SPOTIFY_CLIENT_ID` | Spotify app (optional) |
| `SPOTIFY_CLIENT_SECRET` | Spotify app (optional) |
| `NEXT_PUBLIC_TURN_URL` / `_USERNAME` / `_CREDENTIAL` | optional TURN for calls on strict NATs |

## 3. Deploy

> **If room creation returns "Could not create room. Please try again."**, the
> deployment is missing `ROOM_IDENTITY_SECRET`. `/api/rooms` mints a signed
> identity cookie as its last step, and `mintToken` throws when the secret is
> absent or under 32 chars — so the room is created in Redis but the request
> still 500s. Set the variable and redeploy.

Push to GitHub and import the repo in Vercel (framework auto-detected as
Next.js), or run `vercel --prod`. That's it — no special build settings.

## Local dev

Copy `.env.example` → `.env.local`, fill the same keys, then `npm run dev`.
(Ably + Upstash work identically from localhost.)

## How it works / limits

- **Realtime**: each room is an Ably channel `room:{CODE}`; membership is Ably
  presence. The call feature uses a second channel `room:{CODE}:call` for
  WebRTC signaling (media is still peer-to-peer).
- **State**: rooms, queue, chat, and playback live in Upstash Redis, auto-
  expiring 24h after the last activity.
- **Host handoff** is client-driven via presence (the earliest-joined member
  claims host when the host leaves; the server verifies).
- **Import**: a 500-track playlist is fetched instantly, then matched to
  YouTube in small chunks (each a short serverless call) driven by the
  importer's browser — so it stays under Vercel's function time limit. Large
  imports take a few minutes; progress streams to everyone.
- **Free-tier scale**: Ably free = 200 concurrent connections / 6M msgs a
  month; Upstash free = 10k commands/day. Fine for friends; watch the Upstash
  command count if you run many big imports (each match is a few commands).
