# Immoba — project guide for Claude Code

Read this first. It is the hand-off from the cloud session that built the app (Sept 2026) so a local
session can continue without the conversation history. `README.md` has the full architecture and API notes;
`deploy/oracle.md` the hosting runbook.

## What this is

A Vue 3 PWA that is a mobile gateway to the **Inmovilla** real-estate CRM, plus a small Node relay.
Inmovilla holds all business data. The relay (`server/`) stores only accounts, roles, encrypted keys and
temporary photos. The phone works offline (IndexedDB caches + outbox replayed against Inmovilla).

Owner: preyes@dpcsolutions.com (writes in French/English/Spanish; the app's UI is es/fr/en).

## Commands

```bash
npm install
npm run dev:mock      # sample data, fake Inmovilla; open http://localhost:5173
npm run dev           # real Inmovilla (server IP must be whitelisted for apiweb)
npm test              # vitest (55 tests)
npm run build && npm start   # production: Express serves dist/ + /api on :3000
```

Mock credentials entered in Perfil › Claves after creating the agency: agency `1234`, web key `demo`,
REST token `demo-token`, any text as Anthropic key (valuations are simulated in mock mode).

## Non-negotiable decisions (from the owner)

- Inmovilla **REST API v1** is used for every write (clients, listings, owners, follow-ups); the legacy
  **apiweb** is used for reading because it is fast and supports rich `where` filters. Both lack CORS and
  apiweb is IP-whitelisted, hence the relay.
- Inmovilla and Anthropic keys belong to the **agency**, are entered **only by an admin** in the profile,
  verified live, encrypted at rest (`APP_SECRET`) and never sent to phones.
- Roles: `admin` (everything), `agent` (create/edit, no delete), `readonly` (GET only). Enforced by the relay.
- **Write lock**: `agencies.read_only`, on by default. While on, the relay refuses every non-GET to
  `/api/rest/*` and every photo upload with `403 code=locked`, for everyone including admins; only an admin
  can lift it in the profile. Valuations and reads are unaffected. Client mirror: `auth.writesLocked`, and
  `canWrite` / `canDelete` already fold it in — gate write UI on those, never on the role alone.
- The app must **never crash**: ErrorBoundary per screen, global handlers → toast; OTA updates with a banner.
- Multi-agency on one server (one row in `agencies` per Inmovilla account).

## Layout (short)

- `server/index.js` relay: `/api/account/*` (accounts.js), `POST /api/inmovilla` (apiweb), `ANY /api/rest/*`
  (REST relay + role checks), `POST /api/estimate` (Claude valuation, estimate.js), `PUT /api/photos`.
  `db.js` SQLite via `node:sqlite`, `auth.js` HMAC sessions, `mock.js` + `mockRest.js` fakes.
- `src/stores/` Pinia: auth, settings (locale/theme), enums (throttled, 2 calls/min limit), properties
  (apiweb listing), localProperties (drafts + photos), clients, followUps, owners, estimates, notifications.
- `src/views/` one file per screen; `src/components/charts/` SVG charts for the valuation page.
- `src/i18n/locales/{es,fr,en}.js` — every user-facing string goes through `t()`; add keys to all three.
- `tests/` vitest, node environment. Playwright flows lived in the cloud session's scratchpad (not in repo);
  `playwright-core` + Chromium drive the mock server on :3000 when re-created.

## Conventions

- Plain JS, no TypeScript. Vue `<script setup>`. No semicolons, single quotes, 2 spaces.
- Inmovilla field names are kept as-is in mapping code (`inmovillaMapping.js`); app models use camelCase.
- REST rate limits: 408 = rate limited → outbox pauses 65 s. Enums: 2 calls/min → cached 7 days.
- Photos: resized to 1600 px JPEG on device, uploaded to the relay, public URL sent to Inmovilla.
- Claude: `claude-opus-5`, structured output via `betaZodOutputFormat`, `fallbacks: 'default'` with beta
  `server-side-fallback-2026-07-01`; errors mapped to `{status, code:'anthropic'}`.
- Commit messages: imperative, describe the user-visible change; no model names in committed files.

## Open topics discussed with the owner (not implemented)

- Hosting: Oracle Always Free VM (fixed IP for the apiweb whitelist) — runbook in `deploy/`.
  Alternative considered: Cloudflare Pages + Supabase, but apiweb needs a fixed egress IP, so a small
  relay stays; Supabase could replace SQLite (accounts) and photo hosting. Not started.
- Native app not possible from the cloud session; PWA installs from the browser.
- Native calendar sync is done via `.ics` / Google Calendar links (no CalDAV).
