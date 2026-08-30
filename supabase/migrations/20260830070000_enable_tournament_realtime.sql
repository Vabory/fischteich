begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime
      add table public.tournaments;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_matches'
  ) then
    alter publication supabase_realtime
      add table public.tournament_matches;
  end if;
end;
$$;

-- Required so filtered tournament_id subscriptions also receive DELETE events.
alter table public.tournament_matches replica identity full;

commit;
