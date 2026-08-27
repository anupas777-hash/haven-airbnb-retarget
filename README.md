# Haven — Airbnb Re-engagement

[![Live at haven-airbnb-retarget](https://img.shields.io/badge/Live-haven--airbnb--retarget-FF385C?logo=github)](https://github.com/anupas777-hash/haven-airbnb-retarget)

Internal tool for Airbnb hosts to win back lapsed guests via WhatsApp. Paste a Google Sheet, auto-map columns, score sentiment, define a group (date range + stars + tone + hand-picked), pick a ticket template with per-guest variables `{{name}} {{discount}} {{brand}}`, preview per guest, and post with live `queued → sent → delivered → read/failed` + retry. Dry-run by default, live via one-time Go-live wizard.

![Haven ledger](app/web/dist/assets/index-BapRHdIg.css)

**Design:** Haven ledger — paper + brass + ink, Fraunces/DM Sans/JetBrains Mono, ticket perforation + brass staple, calm and editorial. No opt-in gate (removed per request), simple Start/End dates.

## Stack
- Web: React 18 + TS 5.7 + Vite 6 + Tailwind 3.4 + TanStack Query 5 + Radix
- Server: Node 20 + Express 4 + Zod 3 + Prisma 5 (SQLite, Postgres-ready) + p-queue + googleapis
- Shared: zod schemas

## Quick start (sheet-only, no mock)
```bash
npm install
npm run prisma:generate --workspace=app/server
npm run prisma:migrate --workspace=app/server # DATABASE_URL already set to absolute file:./prisma/dev.db
npm run dev # web http://localhost:5173 + api http://localhost:3001
```
- Paste your sheet: `https://docs.google.com/spreadsheets/d/1WzRK4mY.../edit` (Any viewer) → Define (Start/End + Sift + Pull a name) → Audience (book) → Compose (gallery shows every ticket rendered for one example guest) → Review (bulk retry).
- Current sheet: `1WzRK4mY` (189 guests, 12 tickets). No mock data.

## Env
Copy `.env.example` → `app/server/.env` / `.env`:
```
PORT=3001
DATABASE_URL="file:/absolute/path/prisma/dev.db"
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
BRAND_NAME=Haven
CORS_ORIGIN=http://localhost:5173
```

## Scripts
```bash
npm run build # shared → server → web
npm run test --workspace=app/server # 17 tests (domain + api)
npm run dev # concurrently
```

## Project knowledge
See `PROJECT_KNOWLEDGE.md` for handoff, data model, API, and recent fixes (date `25th` parse, +91 phones, lapse banner).

## License
Private — internal tool.
