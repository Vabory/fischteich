begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'roulette_stats'
  ) then
    alter publication supabase_realtime
      add table public.roulette_stats;
  end if;
end;
$$;

commit;
