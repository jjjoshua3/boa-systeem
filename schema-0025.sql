-- schema-0025.sql — Gedeelde agenda voor overleg
create table if not exists public.boa_afspraak (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  omschrijving text,
  start timestamptz not null,
  einde timestamptz not null,
  gemaakt_door text not null,
  deelnemers text[] default '{}',
  invite_token text unique default encode(gen_random_bytes(12), 'hex'),
  kanaal_id text,
  status text not null default 'gepland',
  created_at timestamptz default now()
);

alter table public.boa_afspraak enable row level security;

drop policy if exists "medewerkers lezen afspraken" on public.boa_afspraak;
create policy "medewerkers lezen afspraken" on public.boa_afspraak
  for select to authenticated
  using (public.boa_is_medewerker());

drop policy if exists "medewerkers maken afspraken" on public.boa_afspraak;
create policy "medewerkers maken afspraken" on public.boa_afspraak
  for insert to authenticated
  with check (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id());

drop policy if exists "maker past afspraak aan" on public.boa_afspraak;
create policy "maker past afspraak aan" on public.boa_afspraak
  for update to authenticated
  using (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id())
  with check (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id());

grant select, insert, update on public.boa_afspraak to authenticated;

create index if not exists boa_afspraak_start on public.boa_afspraak (start);
create index if not exists boa_afspraak_token on public.boa_afspraak (invite_token);
