begin;

alter table public.roulette_stats enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'roulette_stats'
      and policyname = 'roulette_stats_public_read'
  ) then
    create policy roulette_stats_public_read
      on public.roulette_stats
      for select
      to anon, authenticated
      using (true);
  end if;
end;
$$;

alter policy roulette_stats_public_read
  on public.roulette_stats
  to anon, authenticated
  using (true);

grant select on table public.roulette_stats to anon, authenticated;

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
