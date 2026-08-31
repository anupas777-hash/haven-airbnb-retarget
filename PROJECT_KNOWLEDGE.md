# PROJECT KNOWLEDGE — Haven / Airbnb Retargeting

> Handoff for next chat. Last updated: 2026-08-27. Dev: http://localhost:5173 + http://localhost:3001 (dry-run). Repo: https://github.com/anupas777-hash/haven-airbnb-retarget `main` @ 91695ce (+ local 1d0d9d5 badge, plus uncommitted Haven hotel fixes).

## 1) What this is
**Haven — Airbnb re-engagement** — internal tool for Airbnb hosts (single sheet `1WzRK4mY`, 189 previous guests, 12 messages). Operator pastes Google Sheet → auto-maps columns (fuzzy, `key_attributes` for host judgment), scores sentiment, defines group in **Define** (date range Start/End + Stars/Tone/Search + hand-pick), sees **Audience** ledger (scrollable, virtualized, sortable), picks a **Message** (gallery shows every message rendered for one example guest, per-guest `{{name}} {{discount}} {{brand}}`), previews, and posts via WhatsApp with live `queued→sent→delivered→read/failed` + bulk `Retry failed`. Zero-config, sheet-only (mock purged).

**Single job:** write a personal retargeting message that feels hand-written for previous guests, not a blast.

## 2) Stack (pinned)
- Web: React 18.3 + TS 5.7 + Vite 6 + Tailwind 3.4 + TanStack Query 5.64 + React Router 6.28 + Radix + `@tanstack/react-virtual` (ledger)
- Server: Node 20 + Express 4.21 + Zod 3.23 + Prisma 5.22 SQLite `app/server/prisma/dev.db` (absolute `file:/.../prisma/dev.db`, synced to `prisma/prisma/dev.db`) + `p-queue` 8.1 + `googleapis` 144 + `libphonenumber-js` + `luxon` + `@types/luxon`
- Shared: `shared/src/index.ts` zod + `interpolateTemplate`
- Fonts: `Fraunces` display 600/700 italic, `DM Sans` body, `JetBrains Mono` utility (Haven ledger). Loaded via `index.html` Google Fonts.

## 3) Repo layout
```
/
├── package.json (workspaces app/web, app/server, shared; scripts dev/build/test)
├── .env.example / .gitignore (node_modules, dist, .env, *.db, .DS_Store)
├── PROJECT_KNOWLEDGE.md (this file) / README.md (Haven Airbnb badge)
├── app/web/
│   ├── index.html (Haven — Airbnb Re-engagement, Fraunces/DM Sans/JetBrains)
│   ├── tailwind.config.js (ink #121A2B, paper #F7F3E9, fog #E7E0D1, brass #C8A96A, moss #5B6B53, signal #C53A2E, stone #8A8278)
│   ├── src/index.css (linen grain, .ticket-perf, .ticket-staple, .paper, .display/.mono)
│   ├── src/components/ui.tsx (Button brass/ink/outline/ghost, Card paper, Stepper, StatusPill, PreviewBubble ticket)
│   ├── src/lib/api.ts (ingest, sources, bulkOptIn, customers, campaigns, selection, preview, send/deliveries/retry, templates, deleteTemplate)
│   ├── src/lib/format.ts (sentimentColor moss/signal, fmtDate, mask -)
│   └── src/App.tsx (Shell: Ink binding sidebar, Stepper Define→Audience→Compose→Review, lifted filter+selection state, Define holds Sift + Pull a name, Audience is pure table)
│       └── src/features/
│           ├── onboarding/Onboarding.tsx (real sheet URL default, no mock)
│           ├── cohort/Cohort.tsx (Start/End date only, customRange)
│           ├── audience/Audience.tsx (virtualized 50/page, sortable Guest/Phone/First stay/Stars via ?sort=, Stays circle repeatCount, Your notes keyAttributes, Reviews, no Tone/OPT, banner hiddenByCohort)
│           ├── composer/Composer.tsx (gallery every message preview as example guest, + New message, delete ×, discount)
│           └── review/Review.tsx (summary, bulk retry)
├── app/server/
│   ├── prisma/schema.prisma (Customer.keyAttributes String?, sheetRowKey unique, absolute DATABASE_URL)
│   ├── prisma/migrations/20260827112605_add_key_attributes/
│   ├── src/domain/(E164Phone libphonenumber-js IN default, CohortRule luxon Asia/Kolkata, ColumnMapping key_attributes, Sentiment)
│   ├── src/services/ingestService (stableRowKey phone:date:rowIndex per stay, keyAttributes ingest, repeatMap)
│   ├── src/http/routes.ts (normalizeSheetUrl canonical, GET /customers Prisma where cohort/rating/sentiment, repeatCount, stats badPhone/badDate, DELETE /templates/:id)
│   └── src/__tests__/ (domain.test +91, api.test)
└── shared/src/index.ts (LogicalField + key_attributes, CustomerQuerySchema optedInOnly default false, sort)
```

## 4) Data model
- `Customer(id, name, phoneRaw, phoneE164, phoneValid, acquiredAt, acquiredAtRaw, rating, comment, sentimentLabel/Score/Hash, optInWhatsApp, email, keyAttributes, sheetRowKey unique, sourceId FK)` indexes `acquiredAt, rating, sentimentLabel, phoneE164`
- `SheetSource(id, url canonical .../d/{id}/edit, title Sheet 1WzRK4mY, confirmedMapping String JSON incl. key_attributes, lastSyncedAt)` — 1 row `cmt8r7bur000j1u747wcmampm`
- `Campaign(id, name Stay for 26 Aug, cohortRule String JSON customRange, discountPercent, templateId FK, status, selection  ids/allMatching)`
- `MessageTemplate(id, name unique, body, variables JSON 1:name 2:discount 3:brand, whatsappTemplateName, locale, status approved)` — 12 (11 Haven hotel copy + 1 custom), `New Listing / New Property` not `New Menu`
- `Delivery(unique campaignId+customerId)`

Current DB: 189 guests (mock 15 purged), 12 messages, 0 mock.

## 5) API surface
```
POST   /api/sources {url,mapping?} (normalizeSheetUrl)
GET    /api/sources / PUT /:id/mapping
POST   /api/sources/:id/bulk-opt-in (hidden, kept for Sheets without opt-in)
POST   /api/sync {sourceId|url}
GET    /api/customers?search&minRating&maxRating&sentiment&page&pageSize&sort&campaignId&from&to (cohort pushed to SQL, repeatCount, keyAttributes, no opt-in filter)
POST   /api/campaigns {cohortRule customRange, discountPercent} → GET/PATCH
POST   /api/campaigns/:id/selection {customerIds|selectAllMatching}
GET    /api/campaigns/:id/preview?customerId&discountPercent&templateId
POST   /api/campaigns/:id/send (idempotent)
GET    /api/campaigns/:id/deliveries / POST :customerId/retry
GET    /api/templates | POST | DELETE /:id
GET    /api/setup/status | POST test-sheet/whatsapp | GET/POST webhooks | GET health
```

## 6) Frontend flow
- **Onboarding**: ticket `Lend the ledger` real URL default, no mock, no pantry.
- **Shell**: lifted `search/minRating/maxRating/sentiment/selectedIds` etc., auto-heal `sourceId` → real sheet, `campaignId` `Stay for …`, left Ink binding, top Stepper.
- **Define (01)**: `Date range` (Start/End only) + `Sift stays` (search, Stars min/max, Tone chips, `n matching` bad phone only) + `Pull a name` typeahead (`from 1970` finds anyone, chip set). No `Lapse + sift` note, no opt-in.
- **Audience (02)**: virtualized ledger `Stays | Guest | Phone | First stay | Stars | Your notes | Reviews` (no Tone/OPT), `Stays` repeatCount brass, `Your notes` keyAttributes, sortable headers (Guest→name, Phone→phoneE164, First stay→acquiredAt, Stars→rating) via `?sort=`, `max-h-[68vh] overflow-auto`, `Page/All matching`, cohort banner `Previous guests · n shown · hidden by date range` + `Show all`.
- **Composer (03)**: `Choose a message` gallery, each card shows `Preview as {exampleName} · {discount}%` via `localRender` (Haven brand), heading only (no `en_US` code), `×` delete per message (confirm → DELETE), `+ New` inline, discount, `Save message → Review`.
- **Review (04)**: `Ready to post?` summary, bulk `Retry failed`.

## 7) Design system (Haven ledger, hotel)
- **Palette:** Ink #121A2B, Paper #F7F3E9, Fog #E7E0D1, Brass #C8A96A, Moss #5B6B53, Signal #C53A2E, Stone #8A8278 (kept warm ledger, not slate+red minimal — reverted per “wack” feedback).
- **Type:** Fraunces 600/700 italic display, DM Sans body, JetBrains Mono utility.
- **Layout:** Desk fog/20 + floating Paper, Ink binding, perforation, brass staple, linen grain, paper shadow.
- **Hotel copy:** `Haven`, `Stay for`, `Sift stays`, `Your notes`, `Reviews`, `Previous guests`, `Message` (was `Corner/Table for/guest book/marginalia/lapsed/ticket`).

## 8) Key fixes
- DB absolute path + `prisma/prisma/dev.db` sync, `staleRowKey` per stay `phone:date:rowIndex` with fallback by `phoneE164`, `repeatCount` via `phone` group.
- Cohort pushed to Prisma `where.acquiredAt/rating/sentimentLabel`, no JS OOM.
- `libphonenumber-js` IN default + `luxon` `Asia/Kolkata` `en-IN` `25th` strip → `+9196…` + `2025-10-24`.
- `CustomerQuerySchema` `optedInOnly` default `false` + `ON` removed in UI/`isExcluded`/`messagingService`.
- Mock purged (`cmt8ocr...`), `normalizeSheetUrl` dedupes double paste, `Onboarding` default real sheet.
- Virtualized 50/page, sortable `?sort=`.

## 9) How to run
```bash
npm install
npm run prisma:generate --workspace=app/server
npm run prisma:migrate --workspace=app/server # uses absolute
npm run dev # 5173 + 3001 health
curl -X POST http://localhost:3001/api/sources -d '{"url":"https://docs.google.com/spreadsheets/d/1WzRK4mYfI_e3io3wDZJttPxaecNU9lh-GkO0ILcsoTU/edit"}'
```
`http://localhost:5173` → Define (Start/End) → Audience (sortable, scrollable) → Compose (per-message preview) → Review.

## 10) Quirks / TODO
- `CohortPanel` now only `customRange`; old `lastNDays` still in `CohortRule` type but not UI.
- `selectedIds` lifted to App, `onSelectionChange` derived; could simplify to derived only.
- `totalAll` still via `from/to` large; `isExcluded` now phone-only.
- `SourcesPane` placeholder updated, but no `mock://demo` in prod.
- Tests `mock://demo` will re-add mock if run — clean after.
- No `localStorage.clear` helper for stale `campaignId`.

## 11) Next entry points
- Filter/sort: `Audience.tsx:47` `handleSort`, `GET /customers?sort=`
- New notes: `ingestService` `keyAttributes` → `Customer.keyAttributes`
- Stays: `routes.ts` `repeatMap`
- Messages: `Composer.tsx` `localRender`, `DELETE /templates/:id`
- Git: `main` 94462f8 → 1d0d9d5 badge → 91695ce hotel/scrollable (local unpushed after that). Push via `ghp_0Ey9…` (repo scope).

---
*Haven — Airbnb stays. Keep messages warm.*
