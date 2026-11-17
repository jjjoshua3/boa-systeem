-- Zelfde bestand als in de ambassadeur-repo: schema.sql
-- Eenmalig draaien in de Supabase SQL-editor.

create table if not exists public.boa_organisatie (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  slug text not null unique,
  domein text not null default '',
  mail_geheim text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.boa_ambassadeur (
  id uuid primary key default gen_random_uuid(),
  organisatie_id uuid not null references public.boa_organisatie (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  voornaam text not null,
  achternaam text not null,
  email text not null,
  mail_local text not null,
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisatie_id, email)
);

create table if not exists public.boa_org_lid (
  id uuid primary key default gen_random_uuid(),
  organisatie_id uuid not null references public.boa_organisatie (id) on delete cascade,
  voornaam text not null,
  achternaam text not null,
  email text not null,
  rol text not null default 'gebruiker' check (rol in ('gebruiker', 'beheerder')),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'uitgenodigd' check (status in ('uitgenodigd', 'aangemaakt', 'gekoppeld')),
  token text not null unique,
  verloopt timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists boa_org_lid_org on public.boa_org_lid (organisatie_id, email);
create index if not exists boa_ambassadeur_user on public.boa_ambassadeur (user_id);

alter table public.boa_organisatie enable row level security;
alter table public.boa_ambassadeur enable row level security;
alter table public.boa_org_lid enable row level security;
revoke all on public.boa_organisatie from anon, authenticated;
revoke all on public.boa_ambassadeur from anon, authenticated;
revoke all on public.boa_org_lid from anon, authenticated;
