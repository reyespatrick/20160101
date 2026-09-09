# Using a Windows/IIS server with a fixed IP

Immoba's production target is Cloudflare Pages + Supabase (see `supabase/README.md`). One thing may not
run there: Inmovilla's **apiweb** (the listing/ficha read API) has refused calls from Cloudflare with
`xIP NO VALIDADA`. A server you control with a fixed public IP, such as `projects.digitalpencorp.ch`, solves
that in one of two ways.

| | Option A — apiweb hop (recommended) | Option B — whole relay on IIS |
| --- | --- | --- |
| What runs on IIS | one `.ashx` handler, ~120 lines of C# | the Node relay as a Windows service behind IIS |
| What stays on Pages/Supabase | everything: PWA, accounts, REST writes, photos, valuations | nothing (SQLite + local photos instead of Supabase) |
| Needs on the server | .NET Framework 4.6+, already part of IIS | Node.js 22, NSSM, URL Rewrite + ARR |
| Inmovilla sees | the IIS server's IP for apiweb only | the IIS server's IP for everything |

---

## Option A — the apiweb hop (`deploy/iis-hop/`)

The Pages Function keeps building the apiweb form body itself; it just POSTs it to the hop instead of to
`apiweb.inmovilla.com`. The hop checks a shared secret, caps the rate at 60 calls/minute (Inmovilla blocks
an IP at 70), forwards the body unchanged and returns Inmovilla's answer. Credentials pass through, nothing
is stored or logged.

1. On the server, create a folder, e.g. `C:\inetpub\immoba`, and copy into it
   `deploy/iis-hop/apiweb.ashx` and `deploy/iis-hop/web.config`.
2. In `web.config` set `HopSecret` to a long random value (for example 48 characters from a password
   manager). Leave `MaxPerMinute` at 60.
3. IIS Manager › your site (`projects.digitalpencorp.ch`) › **Add Application**: alias `immoba`, physical
   path the folder above, application pool on **.NET CLR v4.0, integrated** (the default `DefaultAppPool`
   is fine). No compilation: IIS compiles the `.ashx` on the first request.
4. Check `https://projects.digitalpencorp.ch/immoba/apiweb.ashx` in a browser: it answers
   `{"ok":true,"hop":"apiweb"}`.
5. In the Cloudflare Pages project › Settings › Variables and secrets, for Production:
   - `INMOVILLA_API_URL` = `https://projects.digitalpencorp.ch/immoba/apiweb.ashx`
   - `APIWEB_HOP_SECRET` = the same value as `HopSecret` (as a **secret**)
   then redeploy (or trigger a new build) so the functions pick them up.
6. In the app, as admin, save the apiweb key again in *Perfil › Claves*: the verification call now goes
   through the hop. If Inmovilla answers, the listing works; if it still says `IP NO VALIDADA`, the answer
   is about the credentials, not the IP, and Inmovilla support is the next step.

The Node relay honours the same two variables (`INMOVILLA_API_URL`, `APIWEB_HOP_SECRET`), so a relay
hosted elsewhere can use the hop too.

**If a call answers a bare `403 Forbidden` HTML page**: that is the handler rejecting the shared secret,
with IIS replacing its JSON explanation. The shipped `web.config` sets `httpErrors existingResponse="PassThrough"`
so the real message comes through — if you deployed an earlier copy, add that line and the response becomes
`{"error":"hop secret missing or wrong"}`. Then compare `HopSecret` in `web.config` with the value sent as
`X-Hop-Secret`; a leftover `CHANGE_ME_LONG_RANDOM` rejects every call.

**If IIS shows "Server Error in '/immoba' Application · Runtime Error"**: the shipped `web.config` has
`customErrors mode="Off"`, so the real message appears in the browser; if you had changed it, set it back
while setting up. The usual causes: the folder is not an *Application* in IIS (only a virtual directory), the
application pool is not .NET CLR v4.0 / integrated, or `targetFramework` in `web.config` is newer than the
.NET Framework installed (lower it, e.g. to 4.6.1). Put `customErrors` back to `On` once the GET answers.

**Security notes.** The secret is the only thing standing between the internet and your IP's apiweb
reputation, so keep it long and rotate it if it leaks. The hop accepts at most 64 KB per request and never
returns anything but Inmovilla's own answer. If you prefer, also restrict the IIS application to
Cloudflare's IP ranges with *IP Address and Domain Restrictions*.

---

## Option B — the whole relay on IIS

Use this only if you do not want Cloudflare Pages and Supabase at all. The Node relay runs as a Windows
service on `localhost:3000` with SQLite and local photo storage; IIS terminates HTTPS and proxies to it.

### 0. Address

Give the app its **own host name**, e.g. `immoba.digitalpencorp.ch` (DNS `A`/`CNAME` to the server), and
its own IIS site with that host header. The PWA is built for the root path; a sub-folder of an existing
site would need a rebuild with a base path.

### 1. Install the relay service

In an elevated PowerShell:

```powershell
# prerequisites once: Node.js 22 LTS (nodejs.org) and Git for Windows
git clone -b <branch> https://github.com/reyespatrick/20160101.git C:\immoba
powershell -ExecutionPolicy Bypass -File C:\immoba\deploy\install-windows.ps1 -Domain immoba.digitalpencorp.ch -Branch <branch>
```

The script installs NSSM (through winget), builds the PWA, creates `C:\immoba-data` (database, secret,
photos), writes `C:\immoba\.env` with a random `APP_SECRET`, registers the Windows service **immoba**
(automatic start, log in `C:\immoba-data\immoba.log`) and checks `http://localhost:3000/api/health`.

### 2. IIS reverse proxy

1. Install the IIS modules **URL Rewrite** and **Application Request Routing (ARR)** if missing.
2. Enable the proxy once at server level: IIS Manager › *server node* › **Application Request Routing
   Cache** › *Server Proxy Settings…* › **Enable proxy**.
3. **Sites › Add Website**: name `Immoba`, physical path `C:\inetpub\immoba` (empty folder), binding
   **https** with host name `immoba.digitalpencorp.ch` and your certificate, plus an **http** binding.
   Application pool *No Managed Code*.
4. Copy `C:\immoba\deploy\web.config` into `C:\inetpub\immoba\`: it rewrites every request to
   `http://localhost:3000`, forwards `X-Forwarded-Proto/Host`, allows 16 MB uploads for photos and
   disables IIS compression/caching of API responses.
5. `https://immoba.digitalpencorp.ch/api/health` must answer JSON from the relay.

### 3. First start

Open the site on a phone, create the agency and its administrator, enter the Inmovilla keys and the
Anthropic key in *Perfil › Claves*, add users in *Perfil › Usuarios*. Stay under 70 apiweb calls a minute
per IP (the relay caps itself at 60).

### 4. Day to day

| Task | How |
| --- | --- |
| Deploy a new version | re-run `install-windows.ps1` with the same arguments; phones show the update banner |
| Logs | `C:\immoba-data\immoba.log` (rotated at 10 MB) |
| Restart / stop | `nssm restart immoba`, `nssm stop immoba`, or Services.msc |
| Settings | edit `C:\immoba\.env`, then `nssm restart immoba` |
| Backup | copy `C:\immoba-data\immoba.sqlite` and the `APP_SECRET` line of `C:\immoba\.env` nightly |

### Troubleshooting

- **502.3 / 502.4 from IIS**: the relay is not running; `nssm status immoba` and the log.
- **Photos never appear in Inmovilla**: `https://<domain>/photos/<id>.jpg` must open from outside and
  `PUBLIC_URL` must match.
- **Uploads fail with 413**: raise `maxAllowedContentLength` in `web.config`.
