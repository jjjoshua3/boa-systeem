-- Redactierecht en voorstellen. Eén keer draaien in de Supabase SQL Editor.

alter table public.boa_medewerker
  add column if not exists mag_feit boolean not null default false,
  add column if not exists mag_boom boolean not null default false,
  add column if not exists mag_jargon boolean not null default false,
  add column if not exists mag_trainer boolean not null default false;

create table if not exists public.boa_voorstel (
  id uuid primary key default gen_random_uuid(),
  soort text not null check (soort in ('feit', 'boom', 'jargon', 'vraag', 'beginsel', 'casus')),
  sleutel text not null,
  titel text not null default '',
  payload jsonb not null,
  basis jsonb,
  status text not null default 'wacht' check (status in ('wacht', 'goed', 'af')),
  indiener text not null,
  gemaakt timestamptz not null default now(),
  beoordeeld_door text,
  beoordeeld_op timestamptz,
  notitie text not null default ''
);

create table if not exists public.boa_inhoud (
  soort text not null,
  sleutel text not null,
  payload jsonb not null,
  sinds timestamptz not null default now(),
  door text not null,
  primary key (soort, sleutel)
);

alter table public.boa_voorstel enable row level security;
alter table public.boa_inhoud enable row level security;
revoke all on public.boa_voorstel from public, anon, authenticated;
revoke all on public.boa_inhoud from public, anon, authenticated;
