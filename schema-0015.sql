-- Overleg voor medewerkers. Eenmalig draaien in de Supabase SQL-editor.

create or replace function public.boa_is_medewerker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.boa_medewerker
    where user_id = auth.uid() and actief
  );
$$;

create or replace function public.boa_mijn_client_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.boa_medewerker
  where user_id = auth.uid() and actief;
$$;

create table if not exists public.boa_kanaal (
  id text primary key,
  naam text not null,
  omschrijving text not null default '',
  volgorde int not null default 0,
  call_room text not null default '',
  call_door text not null default '',
  call_sinds timestamptz
);

create table if not exists public.boa_onderwerp (
  id uuid primary key default gen_random_uuid(),
  kanaal_id text not null references public.boa_kanaal (id),
  titel text not null,
  label text not null default '',
  maker_id text not null,
  maker_naam text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.boa_bericht (
  id uuid primary key default gen_random_uuid(),
  onderwerp_id uuid not null references public.boa_onderwerp (id) on delete cascade,
  maker_id text not null,
  maker_naam text not null,
  tekst text not null default '',
  kaart jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.boa_stempel (
  bericht_id uuid not null references public.boa_bericht (id) on delete cascade,
  client_id text not null,
  pv_naam text not null default '',
  stempel text not null,
  created_at timestamptz not null default now(),
  primary key (bericht_id, client_id, stempel)
);

create table if not exists public.boa_overleg_status (
  client_id text primary key,
  status text not null default 'aanwezig',
  aanduiding text not null default ''
);

insert into public.boa_kanaal (id, naam, omschrijving, volgorde) values
  ('algemeen', 'Algemeen', 'Korte afstemming voor het hele team.', 1),
  ('feitcodes', 'Feitcodes', 'Voorstellen en controle voordat iets op de site komt.', 2),
  ('beslisbomen', 'Beslisbomen', 'Bomen en werkwijzen, ter controle.', 3),
  ('vakjargon', 'Vakjargon', 'Begrippen die een collega wil laten nakijken.', 4),
  ('trainer', 'Trainer', 'Oefenvragen en casussen.', 5),
  ('servicedesk', 'Servicedesk', 'Tickets waar support en beheer samen naar kijken.', 6)
on conflict (id) do nothing;

alter table public.boa_kanaal enable row level security;
alter table public.boa_onderwerp enable row level security;
alter table public.boa_bericht enable row level security;
alter table public.boa_stempel enable row level security;
alter table public.boa_overleg_status enable row level security;

drop policy if exists boa_kanaal_lezen on public.boa_kanaal;
create policy boa_kanaal_lezen on public.boa_kanaal for select to authenticated
  using (public.boa_is_medewerker());

drop policy if exists boa_onderwerp_lezen on public.boa_onderwerp;
create policy boa_onderwerp_lezen on public.boa_onderwerp for select to authenticated
  using (public.boa_is_medewerker());
drop policy if exists boa_onderwerp_plaatsen on public.boa_onderwerp;
create policy boa_onderwerp_plaatsen on public.boa_onderwerp for insert to authenticated
  with check (public.boa_is_medewerker() and maker_id = public.boa_mijn_client_id());

drop policy if exists boa_bericht_lezen on public.boa_bericht;
create policy boa_bericht_lezen on public.boa_bericht for select to authenticated
  using (public.boa_is_medewerker());
drop policy if exists boa_bericht_plaatsen on public.boa_bericht;
create policy boa_bericht_plaatsen on public.boa_bericht for insert to authenticated
  with check (public.boa_is_medewerker() and maker_id = public.boa_mijn_client_id());

drop policy if exists boa_stempel_lezen on public.boa_stempel;
create policy boa_stempel_lezen on public.boa_stempel for select to authenticated
  using (public.boa_is_medewerker());
drop policy if exists boa_stempel_zetten on public.boa_stempel;
create policy boa_stempel_zetten on public.boa_stempel for insert to authenticated
  with check (public.boa_is_medewerker() and client_id = public.boa_mijn_client_id());
drop policy if exists boa_stempel_weg on public.boa_stempel;
create policy boa_stempel_weg on public.boa_stempel for delete to authenticated
  using (public.boa_is_medewerker() and client_id = public.boa_mijn_client_id());

drop policy if exists boa_status_zelf on public.boa_overleg_status;
create policy boa_status_zelf on public.boa_overleg_status for all to authenticated
  using (public.boa_is_medewerker() and client_id = public.boa_mijn_client_id())
  with check (public.boa_is_medewerker() and client_id = public.boa_mijn_client_id());

grant select on public.boa_kanaal to authenticated;
grant select, insert on public.boa_onderwerp to authenticated;
grant select, insert on public.boa_bericht to authenticated;
grant select, insert, delete on public.boa_stempel to authenticated;
grant select, insert, update on public.boa_overleg_status to authenticated;

create or replace function public.boa_overleg_call(p_kanaal text, p_room text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.boa_is_medewerker() then
    raise exception 'Alleen voor medewerkers.';
  end if;
  update public.boa_kanaal
  set call_room = left(coalesce(p_room, ''), 80),
      call_door = case when coalesce(p_room, '') = '' then '' else public.boa_mijn_client_id() end,
      call_sinds = case when coalesce(p_room, '') = '' then null else now() end
  where id = p_kanaal;
end;
$$;

revoke all on function public.boa_overleg_call(text, text) from public, anon;
grant execute on function public.boa_overleg_call(text, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.boa_kanaal;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.boa_onderwerp;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.boa_bericht;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.boa_stempel;
exception when duplicate_object then null;
end $$;
