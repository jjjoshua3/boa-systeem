-- schema-0026.sql — Mailadressen bij een agenda-afspraak, ook extern.
-- Eenmalig draaien in de Supabase SQL-editor.
alter table public.boa_afspraak add column if not exists gasten text[] default '{}';
