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
`server/` is a relay that stores nothing but the photos Inmovilla has to download.

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
- **Credentials belong to the user.** The login screen asks for the agency number, the apiweb password and
  the REST token (Inmovilla › Ajustes › Opciones › Token para API Rest). They are checked against Inmovilla
  and stored only in the browser.
- **Offline**: every edit is written to IndexedDB first and flagged as pending; when online the app replays
  the outbox against Inmovilla. Cards and detail screens show each record's state: pending, "En Inmovilla",
  or the error Inmovilla returned. A 408 (rate limit) pauses the outbox for a minute and retries.

### Inmovilla REST specifics the app follows

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

## Run locally

```bash
npm install
cp .env.example .env         # adjust if needed

# Development with sample data (no Inmovilla account required)
npm run dev:mock             # login with agency 1234 / key "demo" / REST token "demo-token"
                             # listings created through the fake REST show up in the fake apiweb listing

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
| `PUBLIC_URL` | request host | Public base URL of this server, used in the photo URLs Inmovilla downloads |
| `PHOTOS_DIR` | `./data/photos` | Where uploaded photos wait for Inmovilla (needs a persistent disk) |
| `PHOTO_TTL_DAYS` | `30` | Photos older than this are purged |
| `INMOVILLA_MOCK` | `0` | `1` serves sample listings and an in-memory fake REST API |

Whitelist the server's public IP in Inmovilla if the agency's account restricts API access by IP.

## New listings module

1. The form saves the draft to **IndexedDB** immediately; photos are resized to 1600 px JPEG on the device and
   stored as blobs next to it. Everything works offline. Type, city, zone, state, orientation and publication
   come from Inmovilla's enums (cached).
2. When online: photos without a public URL are uploaded to the relay; `POST /propiedades/` is sent with all
   fields and the photo URLs; the `cod_ofer` is looked up through apiweb; the owner is created with
   `POST /propietarios/`. Later edits repeat the POST (Inmovilla matches on `ref`).
3. A listing already in Inmovilla links to its published ficha in the Inmovilla tab and appears in the normal
   listing.

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
server/          index.js (apiweb relay, REST relay, photo hosting, static), inmovilla.js (apiweb param builder),
                 mock.js (sample listings), mockRest.js (fake REST following the documentation)
src/api/         inmovilla.js (apiweb client), inmovillaRest.js (REST client), inmovillaMapping.js (fields + enums)
src/db/          IndexedDB wrappers: clients cache, listing drafts + photo blobs
src/models/      Client and property models aligned with Inmovilla's fields
src/sync/        Outbox helpers
src/utils/       Formatting helpers and on-device image resizing
src/stores/      Pinia stores: auth, enums (cached Inmovilla lists), properties (apiweb listing), localProperties, clients
src/views/       Login, Properties, PropertyDetail, LocalPropertyForm, LocalPropertyDetail, Clients, ClientForm, ClientDetail
src/components/  AppHeader, BottomNav, FilterBar, PropertyCard, LocalPropertyCard, PhotoPicker, CityPicker, ClientCard,
                 ChipGroup, InmovillaState
```
