# Immoba on Supabase + Cloudflare Pages

Target architecture, replacing the single Node relay:

```
 phone / PWA ──► Cloudflare Pages          (static PWA + Pages Functions, same domain)
                   │  Functions:  /api/inmovilla   apiweb proxy (read)
                   │              /api/rest/*      Inmovilla REST proxy (write, roles + lock)
                   │              /api/estimate    comparables + Claude
                   │              /api/photos      upload to Storage
                   ├──► Supabase Auth      sign-in, password reset (the PWA talks to it directly)
                   ├──► Supabase Postgres  agencies (encrypted keys, write lock) + profiles (agency, role)
                   └──► Supabase Storage   listing photos Inmovilla downloads by URL
```

## Project settings

Create the project in the **Europe** region, then:

| Setting | Value | Why |
| --- | --- | --- |
| Enable Data API | **on** | Pages Functions run on Workers, which cannot open a TCP connection to Postgres, so they reach it over the Data API with `supabase-js`. |
| Automatically expose new tables | **off** | No role gets a grant by default; the migration grants `service_role` only. |
| Enable automatic RLS | **on** | Every new table is locked from the start. |

With that combination the browser can reach **Auth and nothing else**: `anon` and `authenticated`
hold no grant on any table, and RLS is on with no policy.

## Install

1. SQL Editor → run [`migrations/0001_immoba.sql`](migrations/0001_immoba.sql).
2. Settings → API: copy the **Project URL** and the **`service_role`** key.
3. Put them in the Pages Function secrets, never in the PWA build:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side database and storage access |
| `APP_SECRET` | encrypts the Inmovilla and Anthropic keys before they are stored |
| `APIWEB_MAX_PER_MIN` | cap on apiweb calls (60; Inmovilla blocks an IP at 70/min) |

The PWA itself only ever receives the project URL and the **anon** key, which grant access to
Auth alone.

## Local development

```bash
npm run build            # the functions are served next to the built PWA
npm run dev:pages        # fake Inmovilla on :3001 + wrangler pages dev on :8788
```

`.dev.vars` (gitignored) carries the secrets and points `INMOVILLA_API_URL` / `INMOVILLA_REST_URL`
at `scripts/mock-inmovilla.mjs`. The functions therefore contain **no mock branch at all**: the code
path exercised in development is the one production takes, only the upstream URL differs. Demo
credentials stay the same as before — agency `1234`, web key `demo`, REST token `demo-token`.

The functions talk to the real Supabase project even in development. That is deliberate: it is the
part worth exercising for real, and nothing there is destructive.

## Known open point: apiweb and the caller's IP

Everything except the apiweb read path is verified in production. apiweb itself refuses calls coming from a
Cloudflare Worker with `xIP NO VALIDADA`, naming the egress IP. If Inmovilla really validates caller IPs — the
documentation says it does not — the listing has to be fetched through a host with a fixed, authorised IP
(the `deploy/` folder still describes one), while writes, photos, valuations and accounts stay on Pages, since
the REST API authenticates by token alone. Confirm with Inmovilla before rebuilding anything around it.

## Why the keys stay encrypted in the application layer

The Inmovilla and Anthropic keys are encrypted with `APP_SECRET` before they are written, and
decrypted only inside a Pages Function. Supabase stores ciphertext it cannot read, so losing the
database does not lose the agencies' credentials. Keep `APP_SECRET` safe: without it those keys
are unrecoverable and an admin has to enter them again.
