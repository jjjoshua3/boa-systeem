-- Nurse, Jurensly wordt Jurensly, N. Eenmalig draaien als schema-0021 al gedraaid is.

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
    if letters = '' then
      return upper(left(links, 1)) || lower(substring(links from 2));
    end if;
    if not exists (
      select 1 from unnest(regexp_split_to_array(rechts, '\s+')) as token
      where token <> '' and token !~ '^[A-Za-z]\.?$'
    ) then
      if links = upper(links) then
        for woord in select unnest(regexp_split_to_array(links, '\s+')) loop
          if woord <> '' then
            delen := delen || case when delen = '' then '' else ' ' end || upper(left(woord, 1));
          end if;
        end loop;
        return upper(left(letters, 1)) || '., ' || delen || '.';
      end if;
      delen := '';
      for woord in select unnest(regexp_split_to_array(rechts, '\s+')) loop
        if woord ~ '^[A-Za-z]\.?$' then
          delen := delen || case when delen = '' then '' else ' ' end || upper(left(woord, 1));
        end if;
      end loop;
      return upper(left(links, 1)) || lower(substring(links from 2)) || ', ' || delen || '.';
    end if;
    delen := '';
    for woord in select unnest(regexp_split_to_array(links, '\s+')) loop
      if regexp_replace(woord, '[^A-Za-z]', '', 'g') <> '' then
        delen := delen || case when delen = '' then '' else ' ' end || upper(left(regexp_replace(woord, '[^A-Za-z]', '', 'g'), 1));
      end if;
    end loop;
    voor := upper(left(rechts, 1)) || lower(substring(regexp_replace(rechts, '\.', '', 'g') from 2));
    if delen = '' then
      return voor;
    end if;
    return voor || ', ' || delen || '.';
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
