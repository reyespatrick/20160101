# ALMA · Inmovilla properties PWA

Progressive Web App built with **Vue 3 + Vite + Pinia** that lets an agency log in with its
Inmovilla credentials and browse the properties published in the **Inmovilla CRM**.

- Login screen (agency number + API key, language, "remember me")
- Property list with search, sale/rent toggle, type filter, ordering and infinite scroll
- Property detail with photo gallery, description, features and agent contact
- **New listings ("Mis propiedades")**: create a property from the phone with photos (gallery or camera),
  price, location, rooms, surfaces, extras, energy rating, description and owner notes. Photos are resized on
  the device, stored offline and uploaded when there is a connection; edits, reordering and deletions sync
  across devices
- **Clients**: create contacts, search them instantly (name, phone, email, notes, accent-insensitive),
  update their details and status, call / WhatsApp / email them in one tap
- **Offline-first clients**: everything is stored in the browser (IndexedDB) and synchronised with the
  server whenever there is a connection, so the app keeps working with no signal
- Installable PWA (manifest + service worker), offline fallback to the last loaded property list, cached photos
- Small Node/Express proxy that forwards requests to Inmovilla, stores clients and serves the built app

## Why a proxy?

The Inmovilla API (`https://apiweb.inmovilla.com/apiweb/apiweb.php`) has no CORS headers and
only accepts requests coming from the **server IP that Inmovilla has authorised for your agency**.
A browser can't call it directly, so `server/index.js` exposes `POST /api/inmovilla` and relays the
request. Credentials are supplied by the user on the login screen and are **never stored on the
server**: they travel with each request and live only in the user's browser storage.

Make sure the public IP of the machine running the proxy is whitelisted in Inmovilla, and set
`INMOVILLA_DOMAIN` to the domain registered there.

## Run locally

```bash
npm install
cp .env.example .env         # adjust if needed

# Development with sample data (no Inmovilla account required)
npm run dev:mock             # login with agency 1234 / key "demo"

# Development against the real API
npm run dev                  # Vite on :5173, proxy on :3000
```

## Production

```bash
npm run build                # outputs dist/
npm start                    # Express serves dist/ and /api on $PORT (default 3000)
```

Deploy `server/` + `dist/` to any Node host (Render, Railway, Fly, a VPS…). Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `INMOVILLA_API_URL` | `https://apiweb.inmovilla.com/apiweb/apiweb.php` | Upstream endpoint |
| `INMOVILLA_DOMAIN` | *(empty)* | Sent as `elDominio` |
| `INMOVILLA_MOCK` | `0` | `1` serves sample data instead of calling Inmovilla |
| `APP_SECRET` | random per start | Secret for signing session tokens. **Set it in production** |
| `DATA_DIR` | `./data` | Where `clients.json`, `properties.json` and `photos/` are stored (mount a persistent volume) |

## New listings module

Inmovilla's web API is read-only, so properties created in the app are kept in this app's own store,
ready to be copied into the CRM (or pushed automatically once Inmovilla's write API token is available):

1. The form saves the listing to **IndexedDB** immediately; photos are resized to 1600 px JPEG on the device
   and stored as blobs next to it. Everything works offline.
2. `POST /api/properties/sync` exchanges listing metadata exactly like clients (last write wins, tombstones)
   and returns which photo ids the server already holds.
3. Missing photos are then uploaded one by one with `PUT /api/properties/:id/photos/:photoId` (binary body);
   other devices download them on demand with the matching `GET`. Files live in `DATA_DIR/photos/<agency>/<id>/`
   and are pruned when removed from the listing or when the listing is deleted.
4. Only photos referenced by a listing the server knows can be uploaded or read, and every call needs the
   session token.

## Clients module

Clients are not part of Inmovilla's public web API, so the app keeps its own client list:

1. Every create / edit / delete is written to **IndexedDB** on the device first and flagged as pending.
   The UI never waits for the network.
2. `POST /api/clients/sync` pushes pending changes and pulls everything that changed on the server since
   the last sync (edits made on other devices included). Conflicts are resolved by **last write wins**
   on `updatedAt`; deletions are kept as tombstones so other devices learn about them.
3. Sync runs after each edit, when the browser fires `online`, when the app becomes visible again, and
   when the clients screen is opened. Pending changes are shown with an orange dot and a badge on the
   Clients tab.
4. Server-side data lives in `DATA_DIR/clients.json`, one bucket per agency number, written atomically.
   Access requires the session token issued by `POST /api/login` (signed with `APP_SECRET`).

The login screen validates the agency number + API key against Inmovilla and receives that token.
If the token expires (30 days, or a server restart without `APP_SECRET`), the app refreshes it silently
with the stored credentials; local data is never lost.

## Tests

```bash
npm test
```

## Inmovilla API notes

Every call is a form POST with `param` and `json=1`. `param` is a semicolon separated string:

```
numagencia;password;idioma;lostipos;<type>;<pos>;<num>;<where>;<order>[;<type>;...]
```

Supported `type`s: `paginacion` (list), `ficha` (detail, `where=cod_ofer=123`), `destacados`,
`lostipos`, `ciudades`, `zonas`, `provincias`. Each response key is an array whose first element is
`{ posicion, elementos, total }` followed by the items.

## Project layout

```
server/          Express app (index.js), Inmovilla param builder (inmovilla.js), sample data (mock.js),
                 session tokens (auth.js), generic per-agency sync store (syncStore.js),
                 clients store (clientsStore.js), listings + photo files store (propertiesStore.js)
src/api/         Browser clients for /api/inmovilla, /api/login, /api/clients/sync, /api/properties/*
src/db/          IndexedDB wrappers: clients, local properties + photo blobs
src/models/      Client and property models: options, validation, search matching
src/sync/        Pure merge rules shared conceptually with the server
src/utils/       Formatting helpers and on-device image resizing
src/stores/      Pinia stores: auth, properties (Inmovilla), localProperties, clients (offline-first)
src/views/       Login, Properties, PropertyDetail, LocalPropertyForm, LocalPropertyDetail,
                 Clients, ClientForm, ClientDetail
src/components/  AppHeader, BottomNav, FilterBar, PropertyCard, LocalPropertyCard, PhotoPicker,
                 ClientCard, ChipGroup
scripts/         generate-icons.mjs (PWA icons from screen/splash.png)
```
