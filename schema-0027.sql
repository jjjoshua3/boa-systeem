-- schema-0027.sql — Agenda mag door een medewerker worden gelezen en gemaakt.
-- De vorige controle keek in een tabel waar een medewerker niet in mag lezen,
-- daardoor mislukte elke afspraak. Eenmalig draaien in de Supabase SQL-editor.

drop policy if exists "medewerkers lezen afspraken" on public.boa_afspraak;
create policy "medewerkers lezen afspraken" on public.boa_afspraak
  for select to authenticated
  using (public.boa_is_medewerker());

drop policy if exists "medewerkers maken afspraken" on public.boa_afspraak;
create policy "medewerkers maken afspraken" on public.boa_afspraak
  for insert to authenticated
  with check (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id());

drop policy if exists "maker past afspraak aan" on public.boa_afspraak;
create policy "maker past afspraak aan" on public.boa_afspraak
  for update to authenticated
  using (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id())
  with check (public.boa_is_medewerker() and gemaakt_door = public.boa_mijn_client_id());

grant select, insert, update on public.boa_afspraak to authenticated;

alter table public.boa_afspraak alter column invite_token set default replace(gen_random_uuid()::text, '-', '');
