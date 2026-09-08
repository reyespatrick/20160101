# Immoba · Inmovilla mobile app (PWA)

Progressive Web App built with **Vue 3 + Vite + Pinia** that lets an agency log in with its
Inmovilla credentials and browse the properties published in the **Inmovilla CRM**.

- Login screen (agency number + API key, language, "remember me")
- Property list with search, sale/rent toggle, type filter, ordering and infinite scroll
- Property detail with photo gallery, description, features and agent contact
- **New listings ("Mis propiedades")**: create a property from the phone with photos (gallery or camera),
  price, location, rooms, surfaces, extras, energy rating, description and owner notes. Photos are resized on
  the device, stored offline and uploaded when there is a connection; edits, reordering and deletions sync
  across devices
- **Agenda (seguimientos)**: follow-ups linked to a listing and/or a client, list grouped by overdue / today /
  upcoming / closed or a month calendar, one-tap close, "add to the phone's calendar" (.ics / Google Calendar)
- **Owners (propietarios)**: read, create, edit and delete the owner of a listing from its ficha, with the
  owner's other listings
- **Accounts and roles**: each person signs in with their own email and password; an **admin** sets the agency's
  Inmovilla keys (stored encrypted on the server, never sent to phones) and manages users; **agents** create and
  edit; **read-only** users only consult. Rights are enforced by the relay, not just hidden in the UI
- **Profile**: language (Español / Français / English), light / dark / automatic theme, password, logout
- **Never blank**: a screen-level error boundary, global error handlers and toasts keep the shell alive; the
  worst case is a message with "Reintentar"
- **Over-the-air updates**: the service worker is checked on a timer, on focus and on reconnect; a banner
  announces the new version and the app reloads itself, with light transitions between screens
- **Clients**: create contacts, search them instantly (name, phone, email, notes, accent-insensitive),
  update their details and status, call / WhatsApp / email them in one tap
- **Offline-first clients**: everything is stored in the browser (IndexedDB) and synchronised with the
  server whenever there is a connection, so the app keeps working with no signal
- Installable PWA (manifest + service worker), offline fallback to the last loaded property list, cached photos
- Small Node/Express proxy that forwards requests to Inmovilla, stores clients and serves the built app

## Architecture: a thin gateway to Inmovilla

The app is a mobile front door to the Inmovilla CRM. **Inmovilla holds all the business data**; the Node process
in `server/` is a relay that stores only the accounts (users, roles, encrypted agency keys) and the photos
Inmovilla has to download.

```
 phone / PWA ─────► server/ (relay) ─────► Inmovilla apiweb   (read: listings, ficha, types)  — unlimited
   IndexedDB cache + outbox         ─────► Inmovilla REST v1 (write: clients, listings, owners) — rate limited
                                    ◄───── Inmovilla downloads listing photos from /photos/<id>.jpg
```

- **Reading** uses the legacy `apiweb` (fast, free-form `where` filters, no rate limit) through
  `POST /api/inmovilla`. The REST API only offers a bare listing plus one call per ficha at 10 calls/minute,
  so it is not usable for browsing.
- **Writing** uses the REST API v1 through `ANY /api/rest/*`. The relay forwards the request as is, adding
  the user's token from the `X-Inmovilla-Token` header as Inmovilla's `Token` header. Neither API sends CORS
  headers (verified), so a browser cannot call them directly; that is the only reason the relay exists.
- **Photos**: Inmovilla's REST API takes photo *URLs* and downloads them. The phone therefore uploads each
  resized photo to `PUT /api/photos` (token checked against Inmovilla, cached one hour) and receives a public
  URL under `/photos/<random>.jpg`, which is what gets sent in the listing. Files are purged after
  `PHOTO_TTL_DAYS`. `PUBLIC_URL` must be the address Inmovilla can reach.
- **Accounts.** Users sign in with email + password (`/api/account/*`). The agency's Inmovilla keys and its
  Anthropic key are set once by an administrator in the profile, verified against their provider, encrypted
  with `APP_SECRET` and stored in `DATA_DIR/immoba.sqlite` (SQLite through `node:sqlite`, no native
  dependency). The relay injects them; the phone only knows whether they exist.
- **Valuations.** `POST /api/estimate` gathers comparables through apiweb, computes peer statistics and asks
  Claude for a structured estimate with the agency's Anthropic key (see *Valuation module*).
- **Offline**: every edit is written to IndexedDB first and flagged as pending; when online the app replays
  the outbox against Inmovilla. Cards and detail screens show each record's state: pending, "En Inmovilla",
  or the error Inmovilla returned. A 408 (rate limit) pauses the outbox for a minute and retries.

#### What is stored where

| Data | Where | How |
| --- | --- | --- |
| Users: email, name, role, active flag | `DATA_DIR/immoba.sqlite`, table `users` | plain columns; passwords as **scrypt** hashes with a random salt (never recoverable) |
| Agency: name, agency number, apiweb key, REST token, Anthropic key, write lock | `DATA_DIR/immoba.sqlite`, table `agencies` | keys **AES-256-GCM encrypted** with a key derived from `APP_SECRET` (or `DATA_DIR/secret.key`) |
| Session | phone `localStorage` (`immoba.session`) | HMAC-signed token (30 days) + public user/agency info (role, `hasKeys`, `hasAnthropic`); never a key |
| Business data (listings, clients, owners, follow-ups) | Inmovilla | the phone keeps an IndexedDB cache + outbox |
| Photos waiting for Inmovilla | `PHOTOS_DIR` | purged after `PHOTO_TTL_DAYS` |
| Last valuations | phone `localStorage` (`immoba.estimates`) | so the page reopens instantly, even offline |

#### Write lock (read-only mode)

Every agency starts **locked**: the relay refuses every call that would create, modify or delete anything in
Inmovilla (`POST`/`PUT`/`DELETE` on `/api/rest/*`, and photo upload), for **every user including
administrators**, answering `403 code=locked`. Only an administrator can lift it, in *Perfil › Claves*.
Reading and valuations keep working, because neither writes to Inmovilla.

The check sits in the relay, before the role checks, and an agency the server cannot resolve counts as
locked — so a write can never slip through by accident. The app mirrors the state (`auth.writesLocked`):
while it is on, every create/edit/delete control is hidden, the outbox stops pushing, and a banner says why.
An old session that predates the flag also counts as locked until it refreshes.

#### Roles

| Role | Inmovilla reads | Create / edit | Delete | Valuations | Keys & users |
| --- | --- | --- | --- | --- | --- |
| `admin` | yes | yes | yes | yes | yes |
| `agent` | yes | yes | no (`DELETE` refused by the relay) | yes | no |
| `readonly` | yes | no (any non-GET refused, photo upload refused) | no | no | no |

The relay checks the session on every call (`Authorization: Bearer`), reloads the user from the database so a
deactivation or a role change applies immediately, and answers `401 code=session`, `403 code=role` or
`409 code=keys`. The app reacts: back to login, a toast, or the "configure keys" banner.

### First start and multi-agency

On an empty database the app shows **Crear la agencia**: agency name + first administrator. The admin is then
taken to the keys screen. Further agencies can be created from the login screen; set `SIGNUP_CODE` to require a
code for that. Everything is per agency: users, keys, quotas.

## Inmovilla REST specifics the app follows

| Topic | What Inmovilla does | What the app does |
| --- | --- | --- |
| Listing identity | `POST /propiedades/` creates **or updates** by `ref`, all fields every time | Ref is required, suggested as `APP-yymmdd-xxx`, checked against apiweb before the first send; read-only once sent |
| Required fields | `ref`, `keyacci`, `key_tipo`, `key_loca` | Type and city are chosen from the enum lists; free text is never sent as a code |
| Enums | `/enums/?tipos`, `?ciudades`, `?zonas=key_loca`, **2 calls/min** | Cached a week in localStorage, calls spaced 31 s apart, warmed right after login |
| Delete | none for listings | "Dar de baja" sends `nodisponible: true`; drafts are deleted locally |
| cod_ofer | not returned by the POST | Resolved through apiweb by `ref` to link the ficha and create the owner |
| Owner | `POST /propietarios/` needs `cod_ofer` | Created/updated after the listing exists |
| Clients | no list, search by phone/email only, `telefono*` numeric | Device cache of clients created or looked up here; phone/email queries also search Inmovilla; phones sent as digits with `prefijotel*` |
| Client fields | nombre, apellidos, nif, email, teléfonos, dirección, observacion | Form limited to those fields (no invented status/budget) |
| Follow-ups | `POST /seguimientos/` creates, same call with `codseg` updates, no delete; `/seguimientos/search/` by creation date; types per agency in `/enums/?tiposeguimiento` | Outbox + cache; pull of the last 120 days at most every 5 min; close = `tareacerrada: 1` + `fechafin`; property labels resolved through apiweb |
| Owners | `GET /propietarios/?cod_ofer=` (404 when none), `POST` needs `cod_ofer`, `PUT` by `cod_cli`, `DELETE` refused while linked | Owner card on every Inmovilla ficha, looked up at most hourly per listing; cached and editable offline |

## Run locally

Requirements: Node 22.5 or newer (the accounts database uses `node:sqlite`).

```bash
git clone https://github.com/reyespatrick/20160101.git immoba && cd immoba
npm install
cp .env.example .env         # optional; loaded by the server when present

# Development with sample data (no Inmovilla account required)
npm run dev:mock             # http://localhost:5173 — first start: create the agency + admin, then set the
                             # mock keys in Perfil › Claves: agency 1234 / web key "demo" / REST token "demo-token"
                             # (any value works as Anthropic key: valuations are simulated in mock mode)

# Development against the real Inmovilla API (your machine's IP must be whitelisted by Inmovilla)
npm run dev                  # Vite on :5173 with hot reload, relay on :3000

# Production-like run (single process serving the built app)
npm run build && npm start   # http://localhost:3000
```

The dev server listens on all interfaces, so a phone on the same Wi-Fi can open `http://<your-pc-ip>:5173`.
Browsers only allow installing a PWA and the service worker over HTTPS or `localhost`, so on the phone the app
runs as a normal web page; installation and offline mode are tested on `localhost` or on the deployed HTTPS server.

## Production

```bash
npm run build                # outputs dist/
npm start                    # Express serves dist/ and /api on $PORT (default 3000)
```

Deploy `server/` + `dist/` to any Node host (Render, Railway, Fly, a VPS…). Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `INMOVILLA_API_URL` | `https://apiweb.inmovilla.com/apiweb/apiweb.php` | Legacy read endpoint |
| `INMOVILLA_DOMAIN` | *(empty)* | Sent as `elDominio` |
| `INMOVILLA_REST_URL` | `https://procesos.inmovilla.com/api/v1` | REST API v1 base URL |
| `PUBLIC_URL` | request host | Public base URL of this server, used in the photo URLs Inmovilla downloads |
| `PHOTOS_DIR` | `./data/photos` | Where uploaded photos wait for Inmovilla (needs a persistent disk) |
| `PHOTO_TTL_DAYS` | `30` | Photos older than this are purged |
| `INMOVILLA_MOCK` | `0` | `1` serves sample listings and an in-memory fake REST API (keys: agency `1234`, web `demo`, REST `demo-token`) |
| `DATA_DIR` | `./data` | Accounts database (`immoba.sqlite`) and, by default, photos |
| `APP_SECRET` | generated into `DATA_DIR/secret.key` | Signs sessions and encrypts the Inmovilla keys. **Set it in production** |
| `SIGNUP_CODE` | *(empty)* | When set, creating a second agency requires this code |

Whitelist the server's public IP in Inmovilla if the agency's account restricts API access by IP.

**Oracle Cloud (free, fixed IP):** see [`deploy/oracle.md`](deploy/oracle.md). `deploy/setup.sh` installs Node,
Caddy (automatic HTTPS), the systemd service and the data directory on a fresh Ubuntu VM in one go;
`deploy/update.sh` redeploys and `deploy/backup.sh` backs up the accounts database.

## New listings module

1. The form saves the draft to **IndexedDB** immediately; photos are resized to 1600 px JPEG on the device and
   stored as blobs next to it. Everything works offline. Type, city, zone, state, orientation and publication
   come from Inmovilla's enums (cached).
2. When online: photos without a public URL are uploaded to the relay; `POST /propiedades/` is sent with all
   fields and the photo URLs; the `cod_ofer` is looked up through apiweb; the owner is created with
   `POST /propietarios/`. Later edits repeat the POST (Inmovilla matches on `ref`).
3. A listing already in Inmovilla links to its published ficha in the Inmovilla tab and appears in the normal
   listing.

## Valuation module (Claude)

Every property (Inmovilla ficha or listing created in the app) has an **Estimar valor** button for `admin`
and `agent` users. It needs an **Anthropic API key**, added by an administrator in *Perfil › Claves* next to
the Inmovilla keys (verified with a free `models.list` call, encrypted at rest, billed to the agency's account).

`POST /api/estimate` (`server/estimate.js`):

1. the phone sends the normalised property (`src/utils/estimateInput.js`: price, type, city, surfaces, extras,
   description…);
2. the relay fetches **comparables** through apiweb: same operation and type in the same city, or across the
   agency when the city has fewer than 5; computes price-per-m² statistics (min, quartiles, median, max, the
   property's percentile);
3. Claude (`claude-opus-5`, structured output validated with zod, server-side refusal fallbacks) returns the
   estimated value, a range, confidence, verdict, summary, strengths, weaknesses, adjustments and a suggested
   price, in the user's language.

The result page shows the hero value and range, asking vs recommended price, the €/m² meter, a range chart
(estimate band + asking / median / recommended markers) and a dot histogram of the comparables with hover
tooltips and a table view. Chart colours were validated for colour-blind separation and contrast in both
themes. The last result is cached on the device; *Recalcular* asks again. In `INMOVILLA_MOCK=1` mode any key
is accepted and the estimate is simulated from the statistics, so the flow works without network.

## Agenda module

1. Follow-ups are cached in IndexedDB and edited offline; the outbox replays `POST /seguimientos/`.
2. On open (and at most every 5 minutes) the app pulls the follow-ups created in the last 120 days and merges
   them, keeping unsent local edits. Property labels come from apiweb (`cod_ofer=`), client labels from the
   local client cache.
3. List view groups by overdue / today / upcoming / closed; calendar view shows a month with dots per day
   (red overdue, orange today, blue upcoming, grey closed) and the selected day's items.
4. "Añadir al calendario" hands the event to the phone's calendar as an `.ics` with a 15-minute alarm, or opens
   Google Calendar. The PWA cannot write into the native calendar silently; this is the closest the platform allows.

## Owners module

The ficha of any Inmovilla listing shows its owner (`GET /propietarios/?cod_ofer=`), with call / WhatsApp /
email shortcuts and links to the owner's other listings. Add (`POST` with `cod_ofer`), edit (`PUT`) and delete
(`DELETE`) go through the same outbox pattern. The quick owner fields of the new-listing form still create the
propietario right after the listing exists.

## Robustness and updates

- `ErrorBoundary` wraps the current screen: a render or lifecycle error shows a panel with the message and
  Reintentar / Inicio / Recargar, the header and navigation stay alive.
- Global `errorHandler`, `window.error` and `unhandledrejection` handlers log and show a toast instead of
  crashing; a failed lazy chunk after a deployment reloads the route.
- Every store action is guarded; network failures keep data on the device; a 408 pauses the outbox a minute.
- The service worker uses `registerType: 'prompt'`: `UpdateBanner` checks for a new version every 30 min, on
  focus and on reconnect, shows "Nueva versión disponible · actualizando" and reloads once the new worker is
  active. Old caches are cleaned up.

## Clients module

1. Clients created or looked up on the device are cached in IndexedDB so search works offline by any field.
2. Typing a phone or an email also searches Inmovilla (`/clientes/buscar/`); results join the cache.
3. Creating, editing or deleting writes the cache first and flags the record; the outbox is replayed with
   `POST` / `PUT` / `DELETE /clientes` after each edit, on reconnect, when the app becomes visible and when the
   Clients screen opens. Opening a client refreshes it from Inmovilla when online.

## Tests

```bash
npm test
```

## Inmovilla API notes

**apiweb (read)**: form POST with `param` and `json=1`; `param` is `numagencia;password;idioma;lostipos;<type>;<pos>;<num>;<where>;<order>`.
Types: `paginacion` (list), `ficha` (detail, `where=cod_ofer=123`), `destacados`, `lostipos`, `ciudades`, `zonas`, `provincias`.
Each response key is an array whose first element is `{ posicion, elementos, total }` followed by the items.

**REST v1 (write)**: base `https://procesos.inmovilla.com/api/v1`, headers `Token` and `Content-Type: application/json`.
Endpoints used: `/enums/`, `/clientes/` (+ `/clientes/buscar/`), `/propiedades/`, `/propietarios/`. Errors come as
`{ codigo, mensaje }`; 408 means the per-minute limit was hit. The full mapping is in `src/api/inmovillaMapping.js`
and the fake server in `server/mockRest.js` follows the same contract.

## Project layout

```
server/          index.js (relay: apiweb + REST with the agency keys, roles, photo hosting, valuations, static), db.js (SQLite
                 accounts, encryption, password hashing), auth.js (sessions, roles), accounts.js (setup, login, keys, users),
                 estimate.js (comparables, statistics, Claude structured output, mock), inmovilla.js (apiweb param builder),
                 mock.js (sample listings), mockRest.js (fake REST)
src/api/         inmovilla.js (apiweb client), inmovillaRest.js (REST client), inmovillaMapping.js (fields + enums), estimate.js
src/db/          IndexedDB wrappers: clients cache, listing drafts + photo blobs
src/models/      Client, property, follow-up and owner models aligned with Inmovilla's fields
src/sync/        Outbox helpers
src/utils/       Formatting helpers and on-device image resizing
src/stores/      Pinia stores: auth (session, role, agency), settings (language, theme), enums, properties (apiweb listing),
                 localProperties, clients, followUps, owners, estimates (last valuations), notifications
src/i18n/        vue-i18n setup and the es / fr / en dictionaries
src/views/       Login, Setup, Profile, AgencyKeys (admin), Users (admin), Properties, PropertyDetail, LocalPropertyForm,
                 LocalPropertyDetail, Estimate (valuation), Clients, ClientForm, ClientDetail, FollowUps (list/calendar),
                 FollowUpForm, OwnerForm
src/components/  AppHeader, BottomNav, FilterBar, PropertyCard, LocalPropertyCard, PhotoPicker, CityPicker, ClientCard,
                 ChipGroup, InmovillaState, FollowUpCard, MonthCalendar, PropertyPicker, ClientPicker, OwnerCard,
                 ErrorBoundary, UpdateBanner, Toasts, charts/ (ValueRangeChart, PeerDistributionChart — plain SVG)
src/utils/       format, image (resize), calendar (.ics / Google Calendar), estimateInput (property → valuation payload)
```

## Branding

The name "Immoba" lives in `index.html`, `vite.config.js` (manifest), `src/components/AppHeader.vue` and the
storage keys (`immoba.*`, IndexedDB `immoba-*`). The logo is rendered from an SVG by
`node scripts/generate-logo.mjs` into `screen/splash.png`, and `node scripts/generate-icons.mjs` derives the PWA
icons from it. The original ALMA artwork is kept as `screen/splash-alma-original.png`.
