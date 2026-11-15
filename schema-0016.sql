-- Zichtbare naam in het overleg, gelijk aan de mail.
-- Eenmalig draaien in de Supabase SQL-editor.

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
      'naam', case
        when a.zoek_naam then btrim(concat_ws(' ', nullif(btrim(a.voornaam), ''), nullif(btrim(a.achternaam), '')))
        else ''
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

revoke all on function public.boa_overleg_team() from public, anon;
grant execute on function public.boa_overleg_team() to authenticated;
