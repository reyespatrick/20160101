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
npm run dev           # real Inmovilla (stay under 70 apiweb calls/min per IP)
npm test              # vitest (82 tests)
npm run build && npm start   # production: Express serves dist/ + /api on :3000
```

Mock credentials entered in Perfil › Claves after creating the agency: agency `1234`, web key `demo`,
REST token `demo-token`, any text as Anthropic key (valuations are simulated in mock mode).

## Non-negotiable decisions (from the owner)

- Inmovilla **REST API v1** is used for every write (clients, listings, owners, follow-ups); the legacy
  **apiweb** is used for reading because it is fast and supports rich `where` filters. Both lack CORS,
  hence a server-side hop (Pages Functions or the Node relay).
- Inmovilla and Anthropic keys belong to the **agency**, are entered **only by an admin** in the profile,
  verified live, encrypted at rest (`APP_SECRET`) and never sent to phones.
- Roles: `admin` (everything), `agent` (create/edit, no delete), `readonly` (GET only). Enforced by the relay.
- **Write lock**: `agencies.read_only`, on by default. While on, the relay refuses every non-GET to
  `/api/rest/*` and every photo upload with `403 code=locked`, for everyone including admins; only an admin
  can lift it in the profile. Valuations and reads are unaffected. Client mirror: `auth.writesLocked`, and
  `canWrite` / `canDelete` already fold it in — gate write UI on those, never on the role alone.
- The app must **never crash**: ErrorBoundary per screen, global handlers → toast; OTA updates with a banner.
- Multi-agency on one server (one row in `agencies` per Inmovilla account).

## Where to deploy — the owner's rule

**Every change goes to `immoba-demo` and stops there.** Production (`immoba.pages.dev`, the real
agency) is only ever deployed when the owner asks for it, in that message, by name. Working on the
demo is free to be wrong; production is an agency's working tool.

```bash
npx wrangler pages deploy dist --project-name immoba-demo --branch main --commit-dirty=true
```

The two are separate Cloudflare projects, so the demo can run ahead for days without touching the
agency — which is the point. Expect production to look older; that is not a bug to fix on impulse.

## Cloudflare Pages Functions (the target runtime)

`functions/` holds the production API: `_shared/` (supabase client, data layer, auth guards, http
helpers, Inmovilla upstream) and `api/` (account, inmovilla, rest, estimate, photos). They run on
Workers, so **no `node:crypto` and no Express** — use `shared/crypto.js` (Web Crypto) and plain fetch.
`server/` stays as the local Node relay and now also hosts `scripts/mock-inmovilla.mjs`, a standalone
fake Inmovilla the functions call over HTTP in dev (`npm run dev:pages`), which is why the functions
carry no mock branch.

Pure modules shared by both runtimes: `server/inmovilla.js`, `server/estimate.js`, `server/mock.js`.

## Demo instance

`immoba-demo.pages.dev` (Pages project `immoba-demo`) serves the same build against
`functions/api/_mock/[[path]].js`, a fake Inmovilla reached over HTTP like any other upstream — the app
still has no mock branch. Account `demo@immoba.app` / `Immoba2026!`, agency keys `1234`/`demo`/
`demo-token`, write lock off, `ESTIMATE_MOCK=1`. Use it to work on screens without a real agency.
It also carries `GEOCODE_DEMO_POSITION=36.5957,-4.6377` (Plaza Virgen de la Peña, Mijas Pueblo): the
GPS button reads from there whatever the phone's real position, so the address chain can be tested
from outside Andalusia. Unset in production, where it changes nothing.

**Trailing slashes matter.** Every Inmovilla REST route carries one (`/clientes/`, `/enums/`) and the
real API rejects the stripped form. Cloudflare's `[[path]]` parameter drops it, so both the REST relay
and the mock derive the path from `url.pathname`, never from `context.params`. Express hid this locally.

**Reading is real, writing is not.** `immoba-demo` sends apiweb (reads) to the IIS hop and REST
(writes) to the in-app fake. Sign in as **demo@immoba.es** — the `DEMO INMOVILLA_` account, agency
`2`, the same row production uses, since both projects share one Supabase — and the catalogue is
Inmovilla's real public demo agency: 1281 listings with their real photographs, while every write
still lands on the fake. There is one demo account, and it is that one: the
fictitious agency `1234` was folded into it, and a device still holding records under the old
number is offered them back on sign-in (`src/db/adopt.js`).

Inmovilla's own documented demo user (`2_000_ext` / `11111`) is refused from the hop's address —
the allow list is per API user, and only the owner's was authorised.

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
- apiweb: 70 requests/minute **per IP** or Inmovilla blocks it (10 min, permanent after 10 blocks). The relay
  caps itself via `createRateLimiter` at `APIWEB_MAX_PER_MIN` (60).
- **apiweb validates the caller's IP — settled, and the IP is now authorised.** The published documentation
  denies the allow list; the live endpoint enforces it. Inmovilla authorised the hop's address
  (195.15.213.10) on 10 Sept 2026 and a `paginacion` call from it returns real data (1341 listings on the
  public demo agency). apiweb still cannot be called straight from Pages Functions — no stable egress IP — so
  it goes through the hop. The REST write path is unaffected, it authenticates by token alone.
- **`ia` must be a *visitor's* IP, public and different from the caller's own.** Sending the calling server's
  own address is refused with `NECESITAMOS RECIBIR LA IP`, exactly like sending nothing — this cost hours of
  wrong guesses (body field order, User-Agent, content type: none of them mattered). `visitorIp()` in
  `server/inmovilla.js` therefore substitutes a public fallback (`INMOVILLA_VISITOR_IP`, default 8.8.8.8)
  whenever the caller is missing, loopback or private, which is the case for every server-to-server call such
  as verifying an admin's keys.
- **The fixed-IP hop:** `deploy/iis-hop/apiweb.ashx` (C# WebHandler on the owner's IIS,
  https://projects.digitalpencorp.ch/immoba/apiweb.ashx). Both runtimes point `INMOVILLA_API_URL` at it and
  send `APIWEB_HOP_SECRET` as `X-Hop-Secret`. The handler is compiled in place by ASP.NET's in-box C# 5
  compiler, so it uses `HttpWebRequest` (`System.Net.Http` is not referenced by dynamic compilation) and no
  C# 6+ syntax. Header values are bytes: `headerValue()` in `server/inmovilla.js` re-encodes a non-ASCII
  secret to its UTF-8 bytes, because a runtime would otherwise emit Latin-1 and IIS reads headers as UTF-8
  (verified: UTF-8 passes, Latin-1 gives 403). Prefer an ASCII-only secret anyway.
- `ia` (the visitor IP) is **required** by apiweb; forgetting it on the key-verification call made verification
  fail every time against the real API.
- The apiweb credential is the full `USUARIO_API` and may carry a suffix (`123_244_ext`); it goes in the first
  `param` field as-is. Docs: https://procesos.inmovilla.com/apiweb/doc/index.html
- Photos: resized to 1600 px JPEG on device, uploaded to the relay, public URL sent to Inmovilla.
- Claude: `claude-opus-5`, structured output via `betaZodOutputFormat`, `fallbacks: 'default'` with beta
  `server-side-fallback-2026-07-01`; errors mapped to `{status, code:'anthropic'}`.
- Commit messages: imperative, describe the user-visible change; no model names in committed files.

## Note from the cloud session (9 Sept 2026) — what it changed and why

Two sessions worked on this branch in parallel: a **local** one (Supabase Auth, Cloudflare Pages Functions,
the write lock, the apiweb facts) and this **cloud** one (session_01BXvRDE61EvG37LF9eu1GyQ). Everything below
is already merged and pushed; nothing is pending on the cloud side.

1. **Valuation with Claude** (`server/estimate.js`, `src/views/EstimateView.vue`, `src/components/charts/`,
   `src/stores/estimates.js`, `POST /api/estimate` in both runtimes). "Estimar valor" on a ficha or an app
   listing; comparables from apiweb (same operation/type/city), €/m² stats, `claude-opus-5` structured output.
   The Anthropic key is an agency key, admin-only, encrypted like the Inmovilla ones. Mock mode simulates it.
2. **The apiweb hop for the owner's IIS server** (`deploy/iis-hop/apiweb.ashx` + `web.config`). Inmovilla's
   apiweb refused calls from Cloudflare ("IP NO VALIDADA"); the owner has a fixed IP at
   `projects.digitalpencorp.ch`. The hop is a single C# `.ashx` (HttpWebRequest, C# 5 syntax on purpose: ASP.NET
   compiles it in place without extra assembly references) that checks `X-Hop-Secret`, caps at 60 calls/min and
   forwards the apiweb form body unchanged. Both runtimes send the secret when `APIWEB_HOP_SECRET` is set and
   reach the hop through `INMOVILLA_API_URL`. Live at `https://projects.digitalpencorp.ch/immoba/apiweb.ashx`
   (GET answers `{"ok":true,"hop":"apiweb"}`). The local session then verified it end to end and made the
   secret UTF-8 safe. Runbook: `deploy/windows-iis.md` (option A = hop only, option B = whole relay on IIS).
3. **Other deployment material**, all optional fallbacks: `deploy/oracle.md` + `setup.sh` (Ubuntu VM),
   `deploy/install-windows.ps1` + `deploy/web.config` (Node relay as a Windows service behind IIS ARR).
4. **Local run made self-contained**: `.env` is loaded by `node --env-file-if-exists`, mock photos are
   generated on `npm run dev:mock`, the Vite dev proxy forwards `/photos` and `/mock-photos`.
5. **Mock data** now spreads listings across all types and cities (they were all "Piso" before), so the
   comparables logic is visible in demo mode; `mock.js` also filters `ciudad='…'`.

Still to do by the owner, not by code: set `INMOVILLA_API_URL` and `APIWEB_HOP_SECRET` in the Pages project
(done if the local session verified the hop), and have Inmovilla authorise 195.15.213.10 for the agency.

## Open topics discussed with the owner (not implemented)

- Hosting: production is Cloudflare Pages + Supabase (`supabase/README.md`, deployed at immoba.pages.dev).
  The owner's Windows/IIS server with a fixed IP (projects.digitalpencorp.ch) hosts the apiweb hop
  (`deploy/windows-iis.md`, option A); running the whole Node relay there (option B) or on an Oracle VM
  (`deploy/oracle.md`) are the fallbacks.
  Alternative considered: Cloudflare Pages + Supabase, but apiweb needs a fixed egress IP, so a small
  relay stays; Supabase could replace SQLite (accounts) and photo hosting. Not started.
- Native app not possible from the cloud session; PWA installs from the browser.
- Native calendar sync is done via `.ics` / Google Calendar links (no CalDAV).
