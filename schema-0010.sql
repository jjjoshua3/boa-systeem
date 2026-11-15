alter table public.boa_medewerker
  add column if not exists whatsapp boolean not null default false;

create or replace function public.boa_ik()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  ident jsonb;
  wa boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('aangemeld', false);
  end if;
  ident := public.boa_mijn_identiteit();
  select * into actor from public.boa_actor();
  if actor.user_id is not null then
    select m.whatsapp into wa
    from public.boa_medewerker m
    where m.user_id = auth.uid() and m.actief;
  end if;
  return ident || jsonb_build_object(
    'aangemeld', true,
    'rol', coalesce(actor.rol, 'indiener'),
    'medewerker', actor.user_id is not null,
    'whatsapp', coalesce(wa, false)
  );
end;
$$;
