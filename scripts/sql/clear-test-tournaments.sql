-- One-time manual cleanup for the Fischteich tournament test phase.
--
-- Run this file only in the Supabase SQL editor with a privileged database role.
-- It intentionally does not touch app_profiles, auth users, Roulette, Buffalo,
-- shortcut, push, friends, or any other non-tournament table.
--
-- Do not turn this into a migration and do not run it through `supabase db push`.

begin;

-- Keep the count and delete phases atomic: no tournament write can interleave.
lock table
  public.tournaments,
  public.tournament_entries,
  public.tournament_team_members,
  public.tournament_groups,
  public.tournament_group_entries,
  public.tournament_matches,
  public.tournament_placements,
  public.tournament_admin_audit
in access exclusive mode;

-- Pre-delete inventory. `deleted_at` is independent from lifecycle status.
select
  count(*) as tournaments_total,
  count(*) filter (where status = 'active') as tournaments_active,
  count(*) filter (where status = 'finished') as tournaments_finished,
  count(*) filter (where status = 'draft') as tournaments_draft,
  count(*) filter (where deleted_at is not null) as tournaments_soft_deleted,
  (select count(*) from public.tournament_entries) as tournament_entries,
  (select count(*) from public.tournament_team_members) as tournament_team_members,
  (select count(*) from public.tournament_groups) as tournament_groups,
  (select count(*) from public.tournament_group_entries) as tournament_group_entries,
  (select count(*) from public.tournament_matches) as tournament_matches,
  (select count(*) from public.tournament_matches where is_tiebreaker) as tournament_tiebreaker_matches,
  (select count(*) from public.tournament_matches where stage = 'winner_bracket') as tournament_winner_bracket_matches,
  (select count(*) from public.tournament_matches where stage = 'loser_bracket') as tournament_loser_bracket_matches,
  (select count(*) from public.tournament_placements) as tournament_placements_and_archive_snapshots,
  (select count(*) from public.tournament_admin_audit) as tournament_admin_audit
from public.tournaments;

-- Live FK evidence for the tables that this script is allowed to affect.
select
  child.relname as child_table,
  parent.relname as parent_table,
  constraint_row.conname as constraint_name,
  case constraint_row.confdeltype
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'd' then 'SET DEFAULT'
  end as on_delete,
  pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
from pg_catalog.pg_constraint as constraint_row
join pg_catalog.pg_class as child on child.oid = constraint_row.conrelid
join pg_catalog.pg_class as parent on parent.oid = constraint_row.confrelid
join pg_catalog.pg_namespace as child_schema on child_schema.oid = child.relnamespace
join pg_catalog.pg_namespace as parent_schema on parent_schema.oid = parent.relnamespace
where constraint_row.contype = 'f'
  and child_schema.nspname = 'public'
  and parent_schema.nspname = 'public'
  and child.relname in (
    'tournament_entries',
    'tournament_team_members',
    'tournament_groups',
    'tournament_group_entries',
    'tournament_matches',
    'tournament_placements',
    'tournament_admin_audit'
  )
order by child.relname, constraint_row.conname;

-- The audit intentionally has no FK to tournaments so hard-delete evidence
-- normally survives. This one-time test-data purge deliberately clears it.
delete from public.tournament_admin_audit;

-- Existing ON DELETE CASCADE relationships remove every tournament child row:
-- entries, team members, groups, group entries, matches (including all bracket
-- and tiebreaker stages), and placement/stat/archive snapshots.
delete from public.tournaments;

-- Post-delete verification: every explicitly tournament-scoped table is empty.
select
  (select count(*) from public.tournaments) as tournaments_total,
  (select count(*) from public.tournament_entries) as tournament_entries,
  (select count(*) from public.tournament_team_members) as tournament_team_members,
  (select count(*) from public.tournament_groups) as tournament_groups,
  (select count(*) from public.tournament_group_entries) as tournament_group_entries,
  (select count(*) from public.tournament_matches) as tournament_matches,
  (select count(*) from public.tournament_placements) as tournament_placements_and_archive_snapshots,
  (select count(*) from public.tournament_admin_audit) as tournament_admin_audit;

-- Fail closed: a residual tournament row rolls back the entire transaction.
do $$
begin
  if exists (
    select 1 from public.tournaments
    union all select 1 from public.tournament_entries
    union all select 1 from public.tournament_team_members
    union all select 1 from public.tournament_groups
    union all select 1 from public.tournament_group_entries
    union all select 1 from public.tournament_matches
    union all select 1 from public.tournament_placements
    union all select 1 from public.tournament_admin_audit
  ) then
    raise exception 'Tournament cleanup verification failed; rolling back';
  end if;
end;
$$;

-- All identifiers in the affected tournament tables are UUIDs; no sequence reset.
commit;
