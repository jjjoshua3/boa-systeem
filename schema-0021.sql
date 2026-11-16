-- Zichtbare naam: eerst de voornaam, daarna de beginletters.
-- Jasper de Graaff wordt Jasper, D G.
-- Eenmalig draaien in de Supabase SQL-editor.

create or replace function public.boa_weergave(raw text)
returns text
language plpgsql
immutable
as $$
declare
  t text := trim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g'));
  links text;
  rechts text;
  letters text;
  delen text := '';
  woord text;
  parts text[];
  i int;
  voor text;
begin
  if t = '' or t in ('Anoniem', 'collega') then
    return t;
  end if;
  if position(',' in t) > 0 then
    links := trim(split_part(t, ',', 1));
    rechts := trim(split_part(t, ',', 2));
    letters := regexp_replace(rechts, '[^A-Za-z]', '', 'g');
    if letters <> '' and rechts ~ '^[A-Za-z]([.\s]*[A-Za-z])*\.?$' then
      if links = upper(links) then
        for woord in select unnest(regexp_split_to_array(links, '\s+')) loop
          if woord <> '' then
            delen := delen || case when delen = '' then '' else ' ' end || upper(left(woord, 1));
          end if;
        end loop;
        return upper(left(letters, 1)) || '., ' || delen || '.';
      end if;
      delen := '';
      for i in 1..length(letters) loop
        delen := delen || case when delen = '' then '' else ' ' end || upper(substring(letters from i for 1));
      end loop;
      return upper(left(links, 1)) || lower(substring(links from 2)) || ', ' || delen || '.';
    end if;
  end if;
  parts := regexp_split_to_array(t, '\s+');
  woord := regexp_replace(parts[1], '\.', '', 'g');
  voor := upper(left(woord, 1)) || lower(substring(woord from 2));
  delen := '';
  if coalesce(array_length(parts, 1), 1) > 1 then
    for i in 2..array_length(parts, 1) loop
      letters := upper(left(regexp_replace(parts[i], '[^A-Za-z]', '', 'g'), 1));
      if letters <> '' then
        delen := delen || case when delen = '' then '' else ' ' end || letters;
      end if;
    end loop;
  end if;
  if delen = '' then
    return voor;
  end if;
  return voor || ', ' || delen || '.';
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
begin
  if uid is null then
    raise exception 'niet aangemeld';
  end if;
  perform public.boa_mijn_identiteit();
  update public.boa_identiteit
    set pv_naam = public.boa_weergave(p_naam),
        organisatie = coalesce(p_organisatie, organisatie)
    where user_id = uid;
  return public.boa_mijn_identiteit();
end;
$$;

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
  select coalesce(nullif(raw_user_meta_data->>'roep', ''), nullif(raw_user_meta_data->>'naam', ''), '')
    into meta
    from auth.users
    where id = uid;
  select * into rij from public.boa_identiteit where user_id = uid;
  if not found then
    insert into public.boa_identiteit (user_id, client_id, pv_naam)
    values (uid, public.boa_nieuwe_client_id(), public.boa_weergave(meta))
    returning * into rij;
  elsif rij.pv_naam in ('ONBEKEND, .', '') and public.boa_weergave(meta) not in ('', 'ONBEKEND, .') then
    update public.boa_identiteit
      set pv_naam = public.boa_weergave(meta)
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
