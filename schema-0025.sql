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
  using (exists (select 1 from public.boa_medewerker m where m.user_id = auth.uid() and m.actief));

drop policy if exists "medewerkers maken afspraken" on public.boa_afspraak;
create policy "medewerkers maken afspraken" on public.boa_afspraak
  for insert to authenticated
  with check (exists (select 1 from public.boa_medewerker m where m.user_id = auth.uid() and m.actief and m.client_id = gemaakt_door));

drop policy if exists "maker past afspraak aan" on public.boa_afspraak;
create policy "maker past afspraak aan" on public.boa_afspraak
  for update to authenticated
  using (exists (select 1 from public.boa_medewerker m where m.user_id = auth.uid() and m.actief and m.client_id = gemaakt_door));

create index if not exists boa_afspraak_start on public.boa_afspraak (start);
create index if not exists boa_afspraak_token on public.boa_afspraak (invite_token);
