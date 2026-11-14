# Systeembeheer & audit | BOA Portaal

IAM voor [systeem.boaportaal.nl](https://systeem.boaportaal.nl). De hoofdbeheerder maakt hier medewerkers aan. Die kunnen daarna inloggen op de servicedesk.

## Publiceren

1. Draai `schema.sql` eenmalig in de Supabase SQL Editor.
2. Nieuwe Netlify-site op deze repository.
3. Environment, alleen op de server, nooit in de browser:
   - `SUPABASE_URL` = de project-URL
   - `SUPABASE_SERVICE_ROLE_KEY` = de service-role sleutel
4. Domein `systeem.boaportaal.nl`.

Zoeken kan op ticketnummer of Client-ID, en alleen met een verplichte reden. Die reden komt in het auditlog. Zoeken op e-mail staat uit, behalve de nood-opvraag van een hoofdbeheerder. Die actie wordt als HIGH gelogd en het adres komt niet terug op het scherm.

De kluis toont alleen tellers. De inhoud blijft versleuteld.

De eerste hoofdbeheerder koppel je eenmalig, nadat het account op het portaal bestaat:

```sql
insert into public.boa_medewerker (user_id, client_id, pv_naam, rol)
select user_id, client_id, pv_naam, 'beheerder'
from public.boa_identiteit
where user_id = (select id from auth.users where email = 'jouw-zakelijke-adres')
on conflict (user_id) do update set rol = 'beheerder', actief = true;
```

Log daarna één keer in op het portaal, zodat de Client-ID bestaat, en voer de insert uit.
