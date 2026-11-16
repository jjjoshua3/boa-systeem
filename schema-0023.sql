-- PV-naam blijft de officiële naam.
-- Voornaam en achternaam bepalen wat collega's zien: Bas, J.
-- Eenmalig draaien in de Supabase SQL-editor.

create or replace function public.boa_collega_naam(p_voor text, p_achter text)
returns text
language plpgsql
immutable
as $$
declare
  voor text := trim(coalesce(p_voor, ''));
  parts text[];
  i int;
  woord text;
  letter text := '';
  particles text[] := array['de','van','der','den','ten','ter','het','t'];
begin
  if voor = '' then
    return '';
  end if;
  voor := upper(left(voor, 1)) || lower(substring(voor from 2));
  parts := regexp_split_to_array(trim(coalesce(p_achter, '')), '\s+');
  for i in reverse coalesce(array_length(parts, 1), 0)..1 loop
    woord := parts[i];
    if woord <> '' and lower(woord) <> all (particles) then
      letter := upper(left(regexp_replace(woord, '[^A-Za-z]', '', 'g'), 1));
      exit;
    end if;
  end loop;
  if letter = '' then
    return voor;
  end if;
  return voor || ', ' || letter || '.';
end;
$$;

create or replace function public.boa_zet_pv_naam(p_naam text, p_organisatie text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  schoon text := trim(coalesce(p_naam, ''));
begin
  if uid is null then
    raise exception 'niet aangemeld';
  end if;
  if length(schoon) < 3 then
    raise exception 'PV-naam is te kort.';
  end if;
  perform public.boa_mijn_identiteit();
  update public.boa_identiteit
    set pv_naam = left(schoon, 80),
        organisatie = coalesce(p_organisatie, organisatie)
    where user_id = uid;
  return public.boa_mijn_identiteit();
end;
$$;

create or replace function public.boa_community_plaats(
  p_parent uuid,
  p_soort text,
  p_domein text,
  p_titel text,
  p_tekst text,
  p_anoniem boolean
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  parent public.boa_community%rowtype;
  root public.boa_community%rowtype;
  ident public.boa_identiteit%rowtype;
  anoniem boolean := coalesce(p_anoniem, false);
  code text;
  naam text;
  org text;
  soort text;
  nieuw uuid;
  voor text := '';
  achter text := '';
begin
  if uid is null then
    raise exception 'niet aangemeld';
  end if;
  if p_titel is null or length(trim(p_titel)) < 3 or length(trim(p_titel)) > 120
     or p_tekst is null or length(trim(p_tekst)) < 5 or length(trim(p_tekst)) > 1200 then
    raise exception 'Titel en tekst kloppen niet.';
  end if;
  if p_domein not in ('algemeen', 'I', 'II', 'III', 'IV', 'V', 'VI') then
    raise exception 'Kies een domein.';
  end if;
  if p_soort not in ('overleg', 'correctie') then
    raise exception 'Soort klopt niet.';
  end if;

  if p_parent is not null then
    select * into parent from public.boa_community where id = p_parent;
    if not found then
      raise exception 'Het bericht bestaat niet meer.';
    end if;
    root := parent;
    while root.parent_id is not null loop
      select * into root from public.boa_community where id = root.parent_id;
      if not found then
        raise exception 'Het bericht bestaat niet meer.';
      end if;
    end loop;
    if root.anoniem and root.user_id = uid then
      anoniem := true;
      code := root.anon_code;
    else
      anoniem := false;
      code := null;
    end if;
    soort := 'correctie';
  else
    soort := p_soort;
    if anoniem then
      code := public.boa_anon_code();
    end if;
  end if;

  if anoniem then
    naam := 'Anoniem';
    org := coalesce(code, 'Anoniem');
  else
    select coalesce(raw_user_meta_data->>'voornaam', ''), coalesce(raw_user_meta_data->>'achternaam', '')
      into voor, achter
      from auth.users
      where id = uid;
    select * into ident from public.boa_identiteit where user_id = uid;
    naam := coalesce(nullif(public.boa_collega_naam(voor, achter), ''), nullif(ident.pv_naam, ''), 'collega');
    org := coalesce(nullif(ident.client_id, ''), '');
  end if;

  insert into public.boa_community (
    user_id, parent_id, soort, domein, titel, tekst, weergave, organisatie, anoniem, anon_code
  ) values (
    uid, p_parent, soort, p_domein, trim(p_titel), trim(p_tekst), naam, org, anoniem, code
  )
  returning id into nieuw;
  return nieuw;
end;
$$;
