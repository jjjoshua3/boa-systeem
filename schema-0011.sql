-- Vergrendeling na foute wachtwoorden op boaportaal.nl.
-- Eén keer draaien in de Supabase SQL Editor.

alter table public.boa_identiteit
  add column if not exists mislukt smallint not null default 0,
  add column if not exists mislukt_sinds timestamptz,
  add column if not exists slot_tot timestamptz,
  add column if not exists slot_straf boolean not null default false;

create or replace function public.boa_account_locked(p_client_id text, p_locked boolean, p_reden text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
begin
  select * into actor from public.boa_actor();
  if actor.user_id is null then
    raise exception 'Alleen voor behandelaars.';
  end if;
  if p_locked and actor.rol is distinct from 'beheerder' then
    raise exception 'Handmatig vergrendelen is alleen voor de hoofdbeheerder.';
  end if;
  if not p_locked and actor.rol not in ('beheerder', 'support') then
    raise exception 'Ontgrendelen is voor support en de hoofdbeheerder.';
  end if;
  if length(trim(coalesce(p_reden, ''))) < 12 then
    raise exception 'Reden is verplicht (minimaal 12 tekens).';
  end if;
  update public.boa_identiteit
  set locked = p_locked,
      mislukt = 0,
      mislukt_sinds = null,
      slot_tot = null,
      slot_straf = false
  where client_id = upper(trim(p_client_id));
  if not found then
    raise exception 'Onbekende Client-ID.';
  end if;
  perform public.boa_audit_schrijf(
    'CRITICAL_AUTH_CHANGE', 'CRITICAL', trim(p_reden),
    upper(trim(p_client_id)),
    (select pv_naam from public.boa_identiteit where client_id = upper(trim(p_client_id))),
    ''
  );
  return public.boa_zoek_account(upper(trim(p_client_id)), trim(p_reden));
end;
$$;
