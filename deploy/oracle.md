# Hosting Immoba on Oracle Cloud (Always Free)

The relay needs one small always-on VM. Oracle's Always Free tier provides one at no cost, and its fixed
public IP is useful here: Inmovilla does **not** keep an allow list, but it blocks a caller's IP for 10
minutes at 70 apiweb requests per minute (permanently after 10 blocks), so an IP you control and do not
share with other tenants keeps that reputation predictable. The relay also caps its own rate
(`APIWEB_MAX_PER_MIN`, 60 by default). Everything below takes about 30 minutes the first time.

> An earlier version of this guide said Inmovilla required whitelisted IPs. That was wrong — see
> [the apiweb documentation](https://procesos.inmovilla.com/apiweb/doc/index.html). A fixed IP is a
> convenience here, not a requirement, so serverless hosting is also on the table.

## 1. Create the VM

1. Sign up at cloud.oracle.com (a card is required for identity, the Always Free resources are never billed).
2. **Compute › Instances › Create instance**
   - Image: **Ubuntu 24.04** (or 22.04).
   - Shape: **VM.Standard.A1.Flex** (Ampere, up to 4 OCPU / 24 GB free) or, if the region says
     "out of capacity", **VM.Standard.E2.1.Micro** (AMD, 1 GB, also free and enough for this relay).
   - Networking: create a new VCN with a public subnet, **assign a public IPv4**.
   - Add your SSH public key, then Create.
3. Make the IP permanent: **Networking › IP management › Reserved public IPs › Reserve**, then on the
   instance go to *Attached VNICs › IPv4 addresses › Edit* and switch the ephemeral IP to the reserved
   one. Without this step a stop/start can change the IP, losing the reputation you built with Inmovilla.
4. Open the web ports: **Networking › Virtual cloud networks › your VCN › Security lists › Default**,
   add two ingress rules: source `0.0.0.0/0`, TCP, destination port `80` and `443`.

## 2. Point a domain at it

Caddy obtains the HTTPS certificate automatically, but it needs a host name. Either an `A` record on your
own domain (`immoba.your-agency.com → <reserved IP>`) or a free subdomain from DuckDNS
(`your-name.duckdns.org`). Wait until `ping <domain>` resolves to the VM.

## 3. Install

```bash
ssh ubuntu@<reserved IP>
sudo -i
curl -fsSL https://raw.githubusercontent.com/reyespatrick/20160101/main/deploy/setup.sh -o setup.sh
bash setup.sh immoba.your-agency.com            # add the repo URL and branch as 2nd/3rd args if needed
```

The script installs Node 22 and Caddy, clones the repo to `/opt/immoba`, builds the PWA, creates the
`immoba` system user, `/var/lib/immoba` (database, secret, photos) and `/etc/immoba/env` with a random
`APP_SECRET`, opens ports 80/443 in the VM's own firewall and starts the `immoba` service behind Caddy.
It ends by printing the public IP.

## 4. First start

1. Note your Inmovilla credentials: the full `USUARIO_API` (it may look like `123_244_ext`), the apiweb key,
   and the REST token (*Ajustes › Opciones › Token para API Rest*). Ask support@inmovilla.com for the apiweb
   credentials if you do not have them.
2. Open `https://<domain>` on a phone: create the agency and its administrator.
3. *Perfil › Claves*: enter the Inmovilla keys (they are checked live) and, for valuations, the Anthropic key.
4. Add users in *Perfil › Usuarios*. Each installs the PWA from the browser ("Add to home screen").

Multi-agency: set `SIGNUP_CODE=` in `/etc/immoba/env` and `systemctl restart immoba`; further agencies are
created from the login screen with that code.

## 5. Day to day

| Task | Command (as root) |
| --- | --- |
| Deploy a new version | `/opt/immoba/deploy/update.sh` (phones show the update banner within a minute) |
| Logs | `journalctl -u immoba -f` and `journalctl -u caddy -f` |
| Restart | `systemctl restart immoba` |
| Backup (nightly cron) | `/opt/immoba/deploy/backup.sh` keeps 30 days in `/var/backups/immoba` |
| Change settings | edit `/etc/immoba/env`, then `systemctl restart immoba` |

What must survive: `/var/lib/immoba/immoba.sqlite` (accounts, roles, encrypted keys) and the `APP_SECRET`
line in `/etc/immoba/env`. Losing the secret makes every stored key unreadable; the admin would simply enter
them again. Photos in `/var/lib/immoba/photos` are temporary (Inmovilla downloads them, purge after
`PHOTO_TTL_DAYS`).

## Capacity

The relay does almost nothing itself: it forwards requests to Inmovilla and Anthropic and serves static
files. The 1 GB micro shape comfortably serves several agencies with dozens of phones each; the practical
limits are Inmovilla's rate limits per agency, not the VM.
