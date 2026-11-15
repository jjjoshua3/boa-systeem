-- IP-blokkade door het SOC. Eén keer draaien in de Supabase SQL Editor.

create table if not exists public.boa_ip_poging (
  id bigint generated always as identity primary key,
  ip text not null,
  bron text not null,
  moment timestamptz not null default now()
);

create index if not exists boa_ip_poging_ip on public.boa_ip_poging (ip, moment desc);

create table if not exists public.boa_ip_blok (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  referentie text not null unique,
  reden text not null,
  bron text not null default '',
  pogingen integer not null default 0,
  actief boolean not null default true,
  gemaakt timestamptz not null default now(),
  door text not null default 'SOC',
  opgeheven timestamptz,
  opgeheven_door text
);

create index if not exists boa_ip_blok_ip on public.boa_ip_blok (ip) where actief;

alter table public.boa_ip_poging enable row level security;
alter table public.boa_ip_blok enable row level security;
revoke all on public.boa_ip_poging from public, anon, authenticated;
revoke all on public.boa_ip_blok from public, anon, authenticated;
