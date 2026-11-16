-- Naam van het account als de Client-ID nog op ONBEKEND staat.
-- Eenmalig draaien in de Supabase SQL-editor.

create or replace function public.boa_mijn_identiteit()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  rij public.boa_identiteit%rowtype;
  meta text := '';
begin
  if uid is null then
    raise exception 'niet aangemeld';
  end if;
  meta := coalesce(auth.jwt() -> 'user_metadata' ->> 'naam', '');
  if meta = '' then
    select coalesce(raw_user_meta_data->>'naam', '') into meta from auth.users where id = uid;
  end if;
  select * into rij from public.boa_identiteit where user_id = uid;
  if not found then
    insert into public.boa_identiteit (user_id, client_id, pv_naam)
    values (uid, public.boa_nieuwe_client_id(), public.boa_naar_pv(meta))
    returning * into rij;
  elsif rij.pv_naam = 'ONBEKEND, .' and public.boa_naar_pv(meta) <> 'ONBEKEND, .' then
    update public.boa_identiteit
      set pv_naam = public.boa_naar_pv(meta)
      where user_id = uid
      returning * into rij;
  end if;
  return jsonb_build_object(
    'client_id', rij.client_id,
    'pv_naam', rij.pv_naam,
    'organisatie', rij.organisatie,
    'locked', rij.locked
  );
end;
$$;

update public.boa_identiteit i
set pv_naam = public.boa_naar_pv(u.raw_user_meta_data->>'naam')
from auth.users u
where u.id = i.user_id
  and i.pv_naam = 'ONBEKEND, .'
  and public.boa_naar_pv(coalesce(u.raw_user_meta_data->>'naam', '')) <> 'ONBEKEND, .';

update public.boa_medewerker m
set pv_naam = i.pv_naam
from public.boa_identiteit i
where i.user_id = m.user_id
  and m.pv_naam = 'ONBEKEND, .'
  and i.pv_naam <> 'ONBEKEND, .';
