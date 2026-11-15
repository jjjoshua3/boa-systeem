-- 1-op-1-gesprekken in het overleg. Eenmalig draaien in de Supabase SQL-editor.

create table if not exists public.boa_dm (
  id text primary key,
  a text not null,
  b text not null,
  created_at timestamptz not null default now(),
  check (a < b and a <> b)
);

create table if not exists public.boa_dm_bericht (
  id uuid primary key default gen_random_uuid(),
  dm_id text not null references public.boa_dm (id) on delete cascade,
  maker_id text not null,
  tekst text not null,
  created_at timestamptz not null default now()
);

create index if not exists boa_dm_bericht_dm on public.boa_dm_bericht (dm_id, created_at);

alter table public.boa_dm enable row level security;
alter table public.boa_dm_bericht enable row level security;

drop policy if exists boa_dm_lezen on public.boa_dm;
create policy boa_dm_lezen on public.boa_dm for select to authenticated
  using (public.boa_is_medewerker() and (a = public.boa_mijn_client_id() or b = public.boa_mijn_client_id()));

drop policy if exists boa_dm_bericht_lezen on public.boa_dm_bericht;
create policy boa_dm_bericht_lezen on public.boa_dm_bericht for select to authenticated
  using (
    public.boa_is_medewerker()
    and exists (
      select 1 from public.boa_dm d
      where d.id = dm_id and (d.a = public.boa_mijn_client_id() or d.b = public.boa_mijn_client_id())
    )
  );

drop policy if exists boa_dm_bericht_plaatsen on public.boa_dm_bericht;
create policy boa_dm_bericht_plaatsen on public.boa_dm_bericht for insert to authenticated
  with check (
    public.boa_is_medewerker()
    and maker_id = public.boa_mijn_client_id()
    and exists (
      select 1 from public.boa_dm d
      where d.id = dm_id and (d.a = public.boa_mijn_client_id() or d.b = public.boa_mijn_client_id())
    )
  );

grant select on public.boa_dm to authenticated;
grant select, insert on public.boa_dm_bericht to authenticated;

create or replace function public.boa_dm_open(p_ander text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ik text := public.boa_mijn_client_id();
  x text;
  y text;
  nieuw text;
begin
  if ik is null or p_ander is null or btrim(p_ander) = '' or ik = p_ander then
    raise exception 'Geen geldig gesprek.';
  end if;
  if not exists (select 1 from public.boa_medewerker where client_id = p_ander and actief) then
    raise exception 'Die collega is geen medewerker.';
  end if;
  if ik < p_ander then x := ik; y := p_ander; else x := p_ander; y := ik; end if;
  nieuw := x || '|' || y;
  insert into public.boa_dm (id, a, b) values (nieuw, x, y) on conflict (id) do nothing;
  return nieuw;
end;
$$;

revoke all on function public.boa_dm_open(text) from public, anon;
grant execute on function public.boa_dm_open(text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.boa_dm;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.boa_dm_bericht;
exception when duplicate_object then null;
end $$;
