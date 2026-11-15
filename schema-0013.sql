-- Namen bij een mislukte aanmelding. Eén keer draaien na schema-0012.sql.

alter table public.boa_ip_poging add column if not exists naam text not null default '';
alter table public.boa_ip_poging add column if not exists bekend boolean;
