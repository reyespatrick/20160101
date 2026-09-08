-- Immoba on Supabase — schema, grants and row level security.
--
-- Run this once in the SQL editor of the project (Dashboard > SQL Editor > New query).
--
-- Security model
-- --------------
-- Nothing here is reachable from a browser. The `anon` and `authenticated` roles receive no
-- grant at all, and RLS is on with no policy, so even a mistake later cannot open a door.
-- Only `service_role` is granted access, and that key lives exclusively in the Cloudflare
-- Pages Function secrets — never in the PWA bundle.
--
-- The Inmovilla and Anthropic keys are stored already encrypted (AES-256-GCM, key derived
-- from APP_SECRET, held by the Pages Function). Supabase therefore never sees them in clear:
-- a compromise of the database alone does not expose an agency's credentials.

-- ---------------------------------------------------------------------------
-- Agencies: one row per Inmovilla account (the app is multi-agency)
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id               uuid primary key default gen_random_uuid(),
  name             text        not null,
  -- Full Inmovilla USUARIO_API; it may carry a suffix such as 123_244_ext
  numagencia       text        not null default '',
  apiweb_password  text        not null default '', -- ciphertext
  rest_token       text        not null default '', -- ciphertext
  anthropic_key    text        not null default '', -- ciphertext
  idioma           smallint    not null default 1,
  -- Agency-wide write lock. ON by default: nothing reaches Inmovilla until an admin lifts it.
  read_only        boolean     not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles: an auth.users row plus which agency it belongs to and what it may do
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  agency_id     uuid        not null references public.agencies (id) on delete restrict,
  email         text        not null,
  name          text        not null default '',
  role          text        not null default 'agent' check (role in ('admin', 'agent', 'readonly')),
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists profiles_agency_idx on public.profiles (agency_id);

-- An agency must keep at least one active administrator; the relay enforces this too,
-- but a partial index makes the invariant visible and cheap to query.
create index if not exists profiles_admin_idx on public.profiles (agency_id) where role = 'admin' and active;

-- ---------------------------------------------------------------------------
-- Row level security: on, with no policy — nothing is readable by anon or authenticated
-- ---------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.profiles enable row level security;

-- Since the project opts out of automatic grants, every role starts with nothing.
-- service_role bypasses RLS but still needs the grant to reach the table at all.
revoke all on public.agencies from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.agencies to service_role;
grant select, insert, update, delete on public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- Storage: listing photos, public because Inmovilla downloads them by URL
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

-- Uploads go through the Pages Function with service_role; browsers may only read.
