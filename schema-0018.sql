-- Hoelang een gebruiker mag inloggen zonder tweede stap.
-- Eenmalig draaien in de Supabase SQL-editor.

alter table public.boa_identiteit
  add column if not exists mfa_uren int not null default 8;

alter table public.boa_identiteit
  add column if not exists mfa_ok_tot timestamptz;

update public.boa_identiteit
set mfa_uren = 8
where mfa_uren not in (8, 24, 48, 72);

alter table public.boa_identiteit
  drop constraint if exists boa_identiteit_mfa_uren;

alter table public.boa_identiteit
  add constraint boa_identiteit_mfa_uren check (mfa_uren in (8, 24, 48, 72));

create or replace function public.boa_mfa_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select mfa_ok_tot > now()
    from public.boa_identiteit
    where user_id = auth.uid()
  ), false);
$$;

create or replace function public.boa_mfa_stempel()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  tot timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Niet aangemeld.';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Eerst de code.';
  end if;
  update public.boa_identiteit
  set mfa_ok_tot = now() + make_interval(hours => mfa_uren)
  where user_id = auth.uid()
  returning mfa_ok_tot into tot;
  return tot;
end;
$$;

create or replace function public.boa_mfa_van(p_client_id text)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor record;
  uren int;
begin
  select * into actor from public.boa_actor();
  if actor.user_id is null then
    raise exception 'Alleen voor medewerkers.';
  end if;
  select mfa_uren into uren
  from public.boa_identiteit
  where client_id = upper(trim(p_client_id));
  return coalesce(uren, 8);
end;
$$;

create or replace function public.boa_zet_mfa_uren(p_client_id text, p_uren int, p_reden text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  naam text;
begin
  select * into actor from public.boa_actor();
  if actor.rol is distinct from 'beheerder' then
    raise exception 'Alleen de hoofdbeheerder.';
  end if;
  if p_uren not in (8, 24, 48, 72) then
    raise exception 'Kies 8, 24, 48 of 72 uur.';
  end if;
  if length(trim(coalesce(p_reden, ''))) < 12 then
    raise exception 'De reden is te kort.';
  end if;
  update public.boa_identiteit
  set mfa_uren = p_uren
  where client_id = upper(trim(p_client_id))
  returning pv_naam into naam;
  if naam is null then
    raise exception 'Geen account met die Client-ID.';
  end if;
  perform public.boa_audit_schrijf(
    'CRITICAL_AUTH_CHANGE',
    'CRITICAL',
    left(trim(p_reden), 240),
    upper(trim(p_client_id)),
    naam,
    ''
  );
  return p_uren;
end;
$$;

revoke all on function public.boa_mfa_open() from public, anon;
revoke all on function public.boa_mfa_stempel() from public, anon;
revoke all on function public.boa_mfa_van(text) from public, anon;
revoke all on function public.boa_zet_mfa_uren(text, int, text) from public, anon;
grant execute on function public.boa_mfa_open() to authenticated;
grant execute on function public.boa_mfa_stempel() to authenticated;
grant execute on function public.boa_mfa_van(text) to authenticated;
grant execute on function public.boa_zet_mfa_uren(text, int, text) to authenticated;
