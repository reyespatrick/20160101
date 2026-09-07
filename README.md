# ALMA · Inmovilla properties PWA

Progressive Web App built with **Vue 3 + Vite + Pinia** that lets an agency log in with its
Inmovilla credentials and browse the properties published in the **Inmovilla CRM**.

- Login screen (agency number + API key, language, "remember me")
- Property list with search, sale/rent toggle, type filter, ordering and infinite scroll
- Property detail with photo gallery, description, features and agent contact
- Installable PWA (manifest + service worker), offline fallback to the last loaded list, cached photos
- Small Node/Express proxy that forwards requests to Inmovilla and serves the built app

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
server/          Express proxy (index.js), param builder (inmovilla.js), sample data (mock.js)
src/api/         Browser client for /api/inmovilla
src/stores/      Pinia stores: auth (credentials) and properties (list, filters, detail cache)
src/views/       LoginView, PropertiesView, PropertyDetailView
src/components/  AppHeader, FilterBar, PropertyCard
scripts/         generate-icons.mjs (PWA icons from screen/splash.png)
```
