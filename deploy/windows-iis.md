# Hosting Immoba on a Windows server with IIS

Use this when you already have a Windows server with a fixed public IP and IIS (for example
`projets.digitalpencorp.ch`). The Node relay runs as a Windows service on `localhost:3000`; IIS terminates
HTTPS and reverse-proxies to it. Inmovilla's apiweb is called from the server's fixed IP.

## 0. Choose the address

Give the app its **own host name**, e.g. `immoba.digitalpencorp.ch` (a DNS `A` or `CNAME` record pointing to
the server), and its own IIS site with that host header. The PWA is built for the root path (`/`); hosting
it under a sub-folder of an existing site (`projets.digitalpencorp.ch/immoba`) would need a rebuild with a
base path and is not covered here.

## 1. Install the relay service

In an elevated PowerShell on the server:

```powershell
# prerequisites once: Node.js 22 LTS (nodejs.org) and Git for Windows
git clone -b <branch> https://github.com/reyespatrick/20160101.git C:\immoba
powershell -ExecutionPolicy Bypass -File C:\immoba\deploy\install-windows.ps1 -Domain immoba.digitalpencorp.ch -Branch <branch>
```

The script installs the NSSM service wrapper (through winget), builds the PWA, creates `C:\immoba-data`
(accounts database, secret, photos), writes `C:\immoba\.env` with a random `APP_SECRET`, registers the
Windows service **immoba** (automatic start, log in `C:\immoba-data\immoba.log`) and checks
`http://localhost:3000/api/health`.

## 2. IIS reverse proxy

1. Install two IIS modules if they are not there yet (Microsoft downloads, or `winget install
   Microsoft.UrlRewrite` / the *Application Request Routing 3.0* installer):
   - **URL Rewrite**
   - **Application Request Routing (ARR)**
2. Enable the proxy once, at server level: IIS Manager › *server node* › **Application Request Routing
   Cache** › *Server Proxy Settings…* › tick **Enable proxy** › Apply.
   Also set *Preserve client IP in the following header: X-Forwarded-For* (default).
3. Create the site: **Sites › Add Website**
   - Site name `Immoba`, physical path `C:\inetpub\immoba` (an empty folder)
   - Binding **https**, host name `immoba.digitalpencorp.ch`, your certificate (the server's wildcard one,
     or a Let's Encrypt certificate obtained with *win-acme*); add an **http** binding too and let it redirect.
   - Application pool: *No Managed Code* is fine, nothing runs in .NET.
4. Copy `C:\immoba\deploy\web.config` into `C:\inetpub\immoba\`. It rewrites every request to
   `http://localhost:3000`, forwards `X-Forwarded-Proto/Host`, raises the upload limit to 16 MB for photos,
   and disables IIS compression/caching of API responses.
5. Open `https://immoba.digitalpencorp.ch/api/health` in a browser: it must answer JSON from the relay.

Windows Firewall: only 80/443 need to be open (they already are for IIS). Port 3000 stays local.

## 3. First start

1. Whitelist the server's public IP in Inmovilla for the apiweb, and note the agency number, web key and
   REST token (*Ajustes › Opciones › Token para API Rest*).
2. Open the site on a phone: create the agency and its administrator.
3. *Perfil › Claves*: Inmovilla keys (checked live) and, for valuations, the Anthropic key.
4. Add users in *Perfil › Usuarios*; each installs the PWA from the browser ("Add to home screen").

## 4. Day to day

| Task | How |
| --- | --- |
| Deploy a new version | re-run `install-windows.ps1` with the same arguments (pull, build, restart); phones show the update banner |
| Logs | `C:\immoba-data\immoba.log` (rotated at 10 MB) |
| Restart / stop | `nssm restart immoba`, `nssm stop immoba`, or Services.msc › *Immoba relay* |
| Settings | edit `C:\immoba\.env`, then `nssm restart immoba` |
| Backup | copy `C:\immoba-data\immoba.sqlite` and the `APP_SECRET` line of `C:\immoba\.env` (nightly task) |

What must survive: the SQLite file (accounts, roles, encrypted keys) and `APP_SECRET`. Losing the secret
makes the stored keys unreadable; an admin would simply enter them again. Photos are temporary.

## Troubleshooting

- **502.3 / 502.4 from IIS**: the relay is not running, check `nssm status immoba` and the log.
- **Photos never appear in Inmovilla**: Inmovilla could not download them; check that
  `https://immoba.digitalpencorp.ch/photos/<id>.jpg` opens from outside and that `PUBLIC_URL` is right.
- **Listing empty, "Inmovilla rechazó las claves"**: the server's IP is not whitelisted for apiweb.
- **Uploads fail with 413**: raise `maxAllowedContentLength` in `web.config`.
