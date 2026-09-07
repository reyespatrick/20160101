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

## Architecture: a thin gateway to Inmovilla

The app is a mobile front door to the Inmovilla CRM. **Inmovilla is the only database**; the Node process in
`server/` is a stateless relay that keeps nothing.

```
 phone / PWA ─────► server/ (relay, no storage) ─────► Inmovilla apiweb   (read: listings, ficha, types)
   IndexedDB cache + outbox                      ─────► Inmovilla REST v1 (write: clients, listings, photos)
```

- **Reading** uses the legacy `apiweb` (fast, rich `where` filters) through `POST /api/inmovilla`. The
  browser cannot call it directly: no CORS, and Inmovilla only accepts whitelisted server IPs.
- **Writing** uses the REST API v1 through `ANY /api/rest/*`. The relay forwards the request as is, adding
  the user's token from the `X-Inmovilla-Token` header as Inmovilla's `Token` header.
- **Credentials belong to the user.** The login screen asks for the agency number, the apiweb password and
  the REST token. They are checked against Inmovilla and stored only in the browser, never on the server.
- **Offline**: every edit is written to IndexedDB first and flagged as pending; when online the app replays
  the outbox against Inmovilla (create → update with the returned id → upload photos → delete). Cards and
  detail screens show each record's state: pending, "En Inmovilla · ref. …", or the error Inmovilla returned.

Why keep a server at all: only for apiweb's CORS/IP restrictions. If Inmovilla enables CORS on the REST API
the `/api/rest` relay could be bypassed, but routing both through the same origin keeps one deployment and
one IP to whitelist.

### Confirming the REST contract

The REST v1 endpoint paths and payload field names live in **one file**, `src/api/inmovillaMapping.js`.
They mirror the field names of the read API (`keyacci`, `precioinmo`, `habitaciones`, `m_cons`…) and must
be checked against the official documentation (`https://procesos.inmovilla.com/api/v1/apidoc/`). The
in-memory fake REST used by `npm run dev:mock` (`server/mockRest.js`) follows the same shapes; adjust both
together.

## Run locally

```bash
npm install
cp .env.example .env         # adjust if needed

# Development with sample data (no Inmovilla account required)
npm run dev:mock             # login with agency 1234 / key "demo" / REST token "demo-token"

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
| `INMOVILLA_API_URL` | `https://apiweb.inmovilla.com/apiweb/apiweb.php` | Legacy read endpoint |
| `INMOVILLA_DOMAIN` | *(empty)* | Sent as `elDominio` |
| `INMOVILLA_REST_URL` | `https://procesos.inmovilla.com/api/v1` | REST API v1 base URL |
| `INMOVILLA_MOCK` | `0` | `1` serves sample listings and an in-memory fake REST API |

No secrets and no data directory: the server holds nothing.

## New listings module

1. The form saves the draft to **IndexedDB** immediately; photos are resized to 1600 px JPEG on the device
   and stored as blobs next to it. Everything works offline.
2. When online, the app creates the listing in Inmovilla (`POST /propiedades`), keeps the returned
   `cod_ofer` as `remoteId`, then uploads each photo (`POST /propiedades/{id}/fotos`). Later edits become
   `PUT`, deletions `DELETE`.
3. A listing already in Inmovilla shows a link to its published ficha in the Inmovilla tab.

## Clients module

1. Clients are read from Inmovilla (`GET /clientes`) and cached in IndexedDB so search works offline.
2. Creating, editing or deleting a client writes the cache first and flags the record; the outbox is replayed
   against Inmovilla (`POST` / `PUT` / `DELETE /clientes`) after each edit, on reconnect, when the app becomes
   visible and when the Clients screen opens.
3. After the replay the list is refreshed from Inmovilla; unsent local edits always win over the fetched copy.
   If Inmovilla rejects a record the error is shown on it and the data stays on the device.

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
server/          Stateless relay: index.js (apiweb + REST relay + static), inmovilla.js (apiweb param builder),
                 mock.js (sample listings), mockRest.js (in-memory fake REST for development)
src/api/         inmovilla.js (apiweb client), inmovillaRest.js (REST client), inmovillaMapping.js (paths + field
                 mapping to confirm against the REST documentation)
src/db/          IndexedDB wrappers: clients cache, local listing drafts + photo blobs
src/models/      Client and property models: options, validation, search matching
src/sync/        Outbox helpers (plan, merge of the Inmovilla list into the cache)
src/utils/       Formatting helpers and on-device image resizing
src/stores/      Pinia stores: auth (credentials on device), properties (Inmovilla listing), localProperties, clients
src/views/       Login, Properties, PropertyDetail, LocalPropertyForm, LocalPropertyDetail, Clients, ClientForm, ClientDetail
src/components/  AppHeader, BottomNav, FilterBar, PropertyCard, LocalPropertyCard, PhotoPicker, ClientCard, ChipGroup, InmovillaState
```
