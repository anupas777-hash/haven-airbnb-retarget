# PROJECT KNOWLEDGE — Corner / Retargeting App

> Handoff doc for next chat when context fills. Last updated: 2026-08-25 21:51 IST. Dev running at `http://localhost:5173` (Vite) + `http://localhost:3001` (Express, dry-run).

## 1) What this is
**Corner — The Regulars' Table** — internal tool to win back lapsed guests of a 46-seat neighbourhood bistro (Panama Lane). Operator pastes a Google Sheet of guests, app auto-maps columns, scores sentiment, lets manager define a group (lapse window + sift + hand-pull), pick a WhatsApp ticket (templated, per-guest variables `{{name}} {{discount}} {{brand}}` → `{{1}} {{2}} {{3}}`), preview per guest, and post with live `queued→sent→delivered→read/failed` + retry. Zero-config: public sheet + `mock` fallback, dry-run via `ConsoleProvider`, live via `CloudApiProvider`.

**Single job:** write a note that feels hand-set, like a saved table — not a blast.

## 2) Stack (pinned)
- **Web:** React 18.3 + TS 5.7 + Vite 6.0 + Tailwind 3.4 + TanStack Query 5.64 + React Router 6.28 + Radix/shadcn
- **Server:** Node 20 + TS 5.7 + Express 4.21 + Zod 3.23 + Prisma 5.22 (SQLite `app/server/prisma/dev.db`, Postgres swap-ready) + `p-queue` 8.1 (swappable to BullMQ) + `googleapis` 144
- **Shared:** `shared/src/index.ts` zod schemas + `interpolateTemplate`
- **Fonts:** `Fraunces` (display, 600/700 italic), `DM Sans` (body), `JetBrains Mono` (utility), loaded via `index.html` Google Fonts.

## 3) Repo layout
```
/
├── package.json (workspaces: app/web, app/server, shared; scripts: dev (concurrently), build, test)
├── .env.example (PORT=3001, DATABASE_URL, GOOGLE_*, WHATSAPP_*, BRAND_NAME, CORS_ORIGIN)
├── PROJECT_KNOWLEDGE.md (this file)
├── README.md (product + setup + verification 2025-08-21 Graph v21.0)
├── app/web/
│   ├── index.html (title: Corner — The Regulars' Table)
│   ├── tailwind.config.js (colors: ink #121A2B, paper #F7F3E9, fog #E7E0D1, brass #C8A96A, moss #5B6B53, signal #C53A2E, stone #8A8278)
│   ├── vite.config.ts (proxy /api → 3001, alias @ → src, shared)
│   ├── src/index.css (linen grain ::before, .ticket-perf perforation, .ticket-staple brass, .stamp, .paper, .display/.mono)
│   ├── src/components/ui.tsx (Button variants: default/ink/brass/outline/ghost, Card .paper, Stepper, StatusPill, PreviewBubble ticket)
│   ├── src/lib/api.ts (BASE /api, ingest, sources, customers, campaigns, selection, preview, send, deliveries, retry, templates, bulkOptIn, setup)
│   ├── src/lib/format.ts (sentimentColor moss/signal, fmtDate)
│   └── src/App.tsx (Shell: left Ink binding, top Stepper Define→Audience→Compose→Review, lifted filter+selection state, cohort, sources/templates/settings panes)
│       └── src/features/
│           ├── onboarding/Onboarding.tsx (ticket “Lend the ledger”, default URL now real sheet, no mock mention)
│           ├── cohort/Cohort.tsx (simple Start/End date only, customRange; was Lapse window toggle 37→30)
│           ├── audience/Audience.tsx (controlled via App props: search, stars, tone, selectedIds, deselected, selectedMap; table 7 cols (Guest Phone First visit Stars Tone Marginalia), no OPT column, banner hiddenByCohort + Show all, no opt-in)
│           ├── composer/Composer.tsx (gallery: every ticket shows rendered preview for exampleGuest (first selected or first customers-preview), localRender, discount, variable map, + New ticket inline)
│           └── review/Review.tsx (Summary 3-col, per-guest live table, bulk Retry failed, idempotent)
├── app/server/
│   ├── prisma/schema.prisma (Customer, SheetSource, Campaign, MessageTemplate, Delivery; Json → String for SQLite, absolute DATABASE_URL)
│   ├── prisma/dev.db (real) + prisma/prisma/dev.db (symlinked/copied)
│   ├── src/config/index.ts (PORT, DATABASE_URL absolute, isDryRun, queue)
│   ├── src/domain/ (E164Phone.ts (+91 for 10-digit 6-9), CohortRule.ts (parseDateLenient strips st/nd/rd/th), Sentiment.ts, ColumnMapping.ts fuzzy)
│   ├── src/services/ (ingestService.ts stableRowKey normalized E164+name+email, fallback by phone/email/name, migrates sheetRowKey), sentimentService, campaignService (ids/allMatching), messagingService (renderBody, queue, idempotent, retry, no opt-in gate now))
│   ├── src/integrations/sheets/ (SheetsClient, PublicCsvSheetsClient CSV parser + gviz, ServiceAccountSheetsClient, MockSheetsClient (15), Composite + normalizeSheetUrl canonical .../d/{id}/edit)
│   ├── src/integrations/whatsapp/ (WhatsAppProvider, ConsoleProvider dry-run, CloudApiProvider v21.0)
│   ├── src/queue/index.ts (PQueue)
│   ├── src/http/routes.ts (normalizeSheetUrl, parseMaybeJson, mapCampaign/Template/Source, POST /sources (ingest), GET /sources, PUT mapping, POST /sync, POST /sources/:id/bulk-opt-in, GET /customers (cohort), POST /campaigns, PATCH, POST selection, GET preview, POST send, GET deliveries, POST retry, GET/POST templates, GET /setup/status, POST test-sheet/whatsapp, GET/POST webhooks, GET health)
│   ├── src/http/middleware.ts (requestId, cors, accessGate)
│   ├── src/index.ts (express, ensureSeed 11 tickets, start only if !test)
│   └── src/__tests__/ (domain.test.ts 13, api.test.ts 4)
└── shared/src/index.ts (CustomerQuerySchema optedInOnly default false (was true, fixed coerce), CohortRuleSchema, etc.)
```

## 4) Data model (Prisma)
- `Customer(id, name, phoneRaw, phoneE164, phoneValid, acquiredAt, acquiredAtRaw, rating, comment, sentimentLabel/Score/Hash, optInWhatsApp, email, sheetRowKey unique, sourceId FK)` indexes on `acquiredAt, rating, sentimentLabel`
- `SheetSource(id, url unique canonical, sheetId, title, confirmedMapping String?, detectedMapping String?, lastSyncedAt)` — url normalized via `normalizeSheetUrl` to avoid double-paste dupes (`…/d/{id}/edit`)
- `Campaign(id, name, cohortRule String JSON, discountPercent, templateId FK, status, filtersSnapshot, selectionMode none|ids|allMatching, selectedIds String?, deselectedIds String?, selectionFilters String?)`
- `MessageTemplate(id, name unique, channel whatsapp, whatsappTemplateName, locale en_US, body String, variables String JSON, status draft/approved)`
- `Delivery(id, campaignId FK cascade, customerId FK cascade, status queued|sent|delivered|read|failed, providerMessageId, error, attempt, unique(campaignId,customerId))`

**Current DB (after mock purge 2026-08-25):**
- `SheetSource`: 1 row `cmt8r7bur000j1u747wcmampm` → `https://docs.google.com/spreadsheets/d/1WzRK4mYfI_e3io3wDZJttPxaecNU9lh-GkO0ILcsoTU/edit` (normalized from `…/edit?usp=drive_link`), title `Sheet 1WzRK4mY`, mapping `Customer Name→Phone Number→Date of 1st Booking` etc., `opt_in null` (sheet has no column)
- `Customer`: 189 rows (was 15 mock + 188 real → mock deleted). Example: `Divya R +919606448030 25th Oct 2025`
- `MessageTemplate`: 11 (+1 custom) — Warm Return, Short Nudge, VIP 20, New Menu, Feedback+Offer, Last Chance, Refer a Friend, Birthday, Festive, Review Request, Abandoned Browse (+ Custom Test 25)
- `DATABASE_URL` absolute `file:/Users/axsh/Desktop/Air BnB/Customer Base Usage/retargeting app - 2/app/server/prisma/dev.db` (was relative `file:./prisma/dev.db` causing `prisma/prisma/dev.db` drift, now copied/synced)

## 5) API surface (zod)
```
POST   /api/sources            {url, mapping?} → ingest (normalizeSheetUrl, detectColumnMapping, needsConfirmation)
GET    /api/sources
GET    /api/sources/:id/mapping | PUT
POST   /api/sources/:id/bulk-opt-in {value:boolean} → updateMany optInWhatsApp
POST   /api/sync               {sourceId|url}
GET    /api/customers?search&minRating&maxRating&sentiment&optedInOnly&page&pageSize&sort&campaignId&from&to&acquiredFromDays&acquiredToDays
POST   /api/campaigns {cohortRule, discountPercent, templateId?} → 201
GET    /api/campaigns | GET /:id | PATCH :id
POST   /api/campaigns/:id/selection {customerIds|selectAllMatching+filters+deselectedIds}
GET    /api/campaigns/:id/preview?customerId&discountPercent&templateId
POST   /api/campaigns/:id/send (idempotent)
GET    /api/campaigns/:id/deliveries (poll 2s)
POST   /api/campaigns/:id/deliveries/:customerId/retry
GET    /api/templates | POST /templates
GET    /api/setup/status (mode dry-run/live, sheet.serviceAccountEmail, whatsapp.phoneNumberId)
POST   /api/setup/test-sheet {url} | POST /test-whatsapp
GET/POST /api/webhooks/whatsapp (verify token, HMAC)
GET    /api/health
```
Errors: `{error:{code,message,details?}}` (`SHEET_NOT_READABLE`, `VALIDATION_ERROR`).

## 6) Frontend flow (post-rework)
- **Onboarding**: centered ticket `Lend the ledger`, input default real sheet URL, `Sync →`, result `Laid · n new`, no mock mention.
- **Shell**: `Shell` holds lifted state `search/minRating/maxRating/sentiment/manualQuery/selectedIds/selectAllMatching/deselected/selectedMap/cohortRule` (`App.tsx:32`), `sourceId/campaignId` in localStorage with auto-heal (if mock id gone → switch to first source). Left `Ink` binding shows Workflow sub-steps (Define 1, Audience 2, Compose 3, Review 4) + House (Sources, Tickets, Pantry).
- **Define (01)**: now the *only* place for group definition — `CohortPanel` (Start/End date only, `customRange`), `Filter · Ledger` (search, Stars 1-5 min/max, Tone chips, `n matching`), `Add · By hand` (typeahead `search≥2` → `GET /customers?search&from=1970` finds anyone across lapse, chip set). No `Lapse + sift + hand-pull` note, no `Opted-in only` checkbox, no `Excl` opt-in line (removed per request).
- **Audience (02)**: pure ledger table (7 cols, no `OPT`), sticky header, `Lapse · … · n shown · n hidden` banner with `Show all` (patches campaign to `1970→2100`) + `Adjust in Define`, selected set preview, `Page / All matching` + bottom `Set ticket →`. Filtered via lifted props, `isExcluded` now `!phoneValid || !acquiredAt` only (opt-in removed). `colSpan 7`.
- **Composer (03)**: gallery shows **every ticket with its preview for one example guest** (first `selectedMap` or first `customers-preview` via `localRender`), `discount%` variable, `+ New` inline, edit selected body → creates `Custom — YYYY-MM-DD` on save. Right `Live ticket — {name}` `PreviewBubble` (ticket-perf + brass staple + vermilion `Posted` stamp).
- **Review (04)**: `Ready to post?` summary 3-col (Campaign, Ticket, Recipients · queued/sent/delivered/read/failed), `Confirm & post →`, `Refresh`, **`Retry N failed →`** bulk (was per-row only), per-guest table 5 cols, live.

## 7) Design system (Corner)
- **Palette:** Ink #121A2B, Paper #F7F3E9, Fog #E7E0D1, Brass #C8A96A, Moss #5B6B53, Signal #C53A2E, Stone #8A8278. Tailwind extended in `tailwind.config.js`.
- **Type:** Fraunces 600/700 italic for display (`display` class), DM Sans 400/500/600 body, JetBrains Mono utility. Loaded in `index.html`.
- **Layout:** Desk (`fog/20`) + floating Paper sheet, left Ink binding, ticket perforation (`.ticket-perf::before` radial holes + dashed), brass staple (`.ticket-staple`), linen grain (`body::before` radial), paper cards (`.paper` shadow), brass rule, stamp (`.stamp`).
- **Risk:** Paper ephemera for SaaS — justified as hospitality tactility vs blast.

## 8) Key recent fixes (chronological)
1. **DB drift:** `DATABASE_URL` relative → absolute, copied `prisma/prisma/dev.db` → `prisma/dev.db`, synced.
2. **Dates:** `CohortRule.parseDateLenient` strips `st/nd/rd/th`, handles `25th Oct 2025` → `2025-10-24T18:30:00.000Z` (was null → hidden).
3. **Phones:** `E164Phone.normalizePhone` handles Indian 10-digit `6-9` → `+91` (was `+1` → 29 bad → 14 bad).
4. **Opt-in:** `shared CustomerQuerySchema` coerce `"false"` → `true` bug → transform; default now `false` (was `true`); UI removed (`Audience`/`App` no `optedInOnly` checkbox, `OPT` column, `isExcluded` optIn, `messagingService` optIn gate commented, bulk-opt-in added but hidden per request).
5. **Cohort visibility:** `Audience` banner `hiddenByCohort = totalAll - total` (`GET /customers?from=1970&to=2100`), `Show all` patches campaign; `CohortPanel` simplified to Start/End only.
6. **Filter moved:** Lifted `search/minRating/maxRating/sentiment/selectedIds` etc. to `App`, `Define` now holds `Filter · Ledger` + `Pull a name`, `Audience` is table-only.
7. **Composer preview:** Was blank (customers-preview empty due to default cohort, no exampleGuest). Now `exampleGuest` prop from `selectedMap[0]` or first `customers-preview` (large range), gallery shows per-template `localRender` for that guest, right `Live ticket`.
8. **Review:** Added bulk `Retry failed` + updated summary.
9. **Mock purge:** Deleted `cmt8ocr330001mb2zkowzz11a` (15 rows), `App` default URL now real sheet, auto-heal to real source. DB now 189 real + 0 mock.
10. **URL normalize:** `normalizeSheetUrl` canonical `…/d/{id}/edit` prevents double-paste `…/edithttps://…` dupes.

## 9) How to run
```bash
npm install
# DB already migrated; if fresh:
npm run prisma:generate --workspace=app/server
npm run prisma:migrate --workspace=app/server # DATABASE_URL absolute
npm run dev # concurrently server 3001 + web 5173
# health
curl http://localhost:3001/api/health
# ingest real sheet (already done)
curl -X POST http://localhost:3001/api/sources -H "Content-Type: application/json" -d '{"url":"https://docs.google.com/spreadsheets/d/1WzRK4mYfI_e3io3wDZJttPxaecNU9lh-GkO0ILcsoTU/edit"}'
# Show all (if hidden)
curl -X PATCH http://localhost:3001/api/campaigns/:id -H "Content-Type: application/json" -d '{"cohortRule":{"type":"customRange","from":"1970-01-01T00:00:00.000Z","to":"2100-01-01T00:00:00.000Z"}}'
```
Web: `http://localhost:5173` → Define shows Start/End + Sift + Pull a name → Audience shows ledger (after `Show all` → 186) → Compose shows every ticket with example guest preview → Review shows summary + live + bulk retry.

Logs: `/tmp/retarget-define.log`, `/tmp/retarget-live2.log`, `/tmp/retarget-final*.log`.

## 10) Current quirks / TODO for next chat
- `CohortPanel` now only `customRange` (no `lastNDays`); `App` initial `cohortRule` is `{type:'customRange'}` (empty) → shows all. If spec requires `37→30` default, need to reconcile.
- `selectedIds` lifted to `App` but `onSelectionChange` still called from `Audience` to update `selectionCount` (derived). Could simplify to derived only.
- `totalAll` query in `Audience` still fetches with `from/to` large but without `campaignId`; if campaign cohort is custom, `totalAll` approximates. Works.
- `isExcluded` now ignores opt-in; if opt-in later required, re-enable in `messagingService` + re-add `OPT` column.
- `SourcesPane` still has placeholder `mock://demo` in some builds — already changed to real URL in `Onboarding`, but `SourcesPane` placeholder updated to `…/edit` (no mock).
- `prisma/prisma/dev.db` vs `prisma/dev.db` — kept synced via `cp`; absolute URL prevents drift but `prisma migrate` still writes to `prisma/dev.db` (top) — keep `cp` after migrate.
- Tests: `api.test.ts` still uses `mock://demo` (4 tests). They will re-create mock source if run — consider skipping or cleaning after test, or change test to use real sheet mock.
- No `localStorage.clear()` helper for stale `campaignId` with old `lastNDays` — user must `Show all` or clear storage.

## 11) Next chat entry points
- If preview still blank: check `exampleGuest` prop — ensure `selectedMap` has entry (pick in Define) or `customers-preview` returns valid phone.
- If filter not in Define: check `App.tsx` `step===1` block — filter cards must stay there, not in `Audience`.
- If opt-in reappears: `shared` default is now `false`, `Audience` has no `OPT` — verify `grep -rn optedIn`.
- To add new sheet: `POST /api/sources {url: canonical}` → `GET /customers?from=1970` should show new rows.

---
*Teams: Corner bistro, Panama Lane. Keep tickets warm.*
