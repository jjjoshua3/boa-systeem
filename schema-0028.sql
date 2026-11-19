-- Redactierecht voor de hele site domein2.boaportaal.nl.
-- Eén keer draaien in de Supabase SQL-editor.

alter table public.boa_medewerker
  add column if not exists mag_domein2 boolean not null default false;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.boa_voorstel'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%soort%'
  loop
    execute format('alter table public.boa_voorstel drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.boa_voorstel
  add constraint boa_voorstel_soort_check
  check (soort in ('feit', 'boom', 'jargon', 'vraag', 'beginsel', 'casus', 'domein2'));
