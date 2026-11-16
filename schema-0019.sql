-- Zichtbare naam: voornaam plus de eerste letter van de achternaam.
-- ACCOUNT, T. wordt T. A. Een ingevulde voornaam wordt Thomas A.
-- Eenmalig draaien in de Supabase SQL-editor.

create or replace function public.boa_zichtbare_naam(p_naam text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_naam), '') = '' then ''
    when position(',' in p_naam) = 0 then btrim(p_naam)
    else
      upper(substring(ltrim(split_part(p_naam, ',', 2)) from 1 for 1))
      || '. '
      || upper(substring(regexp_replace(ltrim(split_part(p_naam, ',', 1)), '^(de|van|der|den|ten|ter|het)\s+', '', 'i') from 1 for 1))
      || '.'
  end;
$$;

create or replace function public.boa_overleg_team()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.boa_is_medewerker() then
    raise exception 'Alleen voor medewerkers.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', m.client_id,
      'rol', m.rol,
      'postbus', coalesce(nullif(u.raw_user_meta_data->>'mail_local', ''), ''),
      'pv_naam', m.pv_naam,
      'naam', case
        when nullif(btrim(a.voornaam), '') is not null then
          btrim(a.voornaam) || case
            when nullif(regexp_replace(btrim(a.achternaam), '^(de|van|der|den|ten|ter|het)\s+', '', 'i'), '') is not null
              then ' ' || upper(substring(regexp_replace(btrim(a.achternaam), '^(de|van|der|den|ten|ter|het)\s+', '', 'i') from 1 for 1)) || '.'
            else ''
          end
        else public.boa_zichtbare_naam(m.pv_naam)
      end
    ))
    from public.boa_medewerker m
    left join auth.users u on u.id = m.user_id
    left join public.boa_mail_adres a
      on a.local = coalesce(nullif(u.raw_user_meta_data->>'mail_local', ''), lower(m.client_id))
    where m.actief
  ), '[]'::jsonb);
end;
$$;

update public.boa_community
set weergave = public.boa_zichtbare_naam(weergave)
where anoniem = false and position(',' in weergave) > 0;
