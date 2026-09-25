-- Fischteich production cutover: ONE-TIME DESTRUCTIVE RESET.
-- Run manually in the Supabase SQL editor only after reviewing
-- scripts/pre-release-reset-audit.sql. This is deliberately not a migration.
-- Any failed guard/assertion rolls the complete transaction back.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set constraints all deferred;

-- Freeze every mutable table involved in the cutover so the admin guard and
-- post-reset assertions describe one consistent transaction.
lock table
  auth.users,
  public.app_profiles,
  public.roulette_stats,
  public.roulette_gold_events,
  public.roulette_spin_events,
  public.tournaments,
  public.tournament_entries,
  public.tournament_team_members,
  public.tournament_groups,
  public.tournament_group_entries,
  public.tournament_matches,
  public.tournament_placements,
  public.tournament_admin_audit,
  public.buffalo_events,
  public.push_subscriptions,
  public.buffalo_push_jobs,
  public.buffalo_push_deliveries,
  public.buffalo_shortcut_devices,
  public.buffalo_shortcut_targets,
  public.trottl_classic_sessions,
  public.trottl_classic_players,
  public.trottl_special_sessions,
  public.trottl_special_players,
  public.trottl_special_spectators,
  public.trottl_special_panic_submissions,
  public.trottl_special_reaction_runs,
  public.trottl_special_color_chaos_runs,
  public.trottl_special_fish_memory_rounds,
  public.trottl_special_fish_memory_runs,
  public.trottl_special_stop_fish_runs,
  public.trottl_special_poison_fish_runs,
  public.trottl_special_fish_count_rounds,
  public.trottl_special_fish_count_runs,
  public.trottl_special_catch_me_rounds,
  public.trottl_special_catch_me_runs,
  public.trottl_special_minigame_registry
in access exclusive mode;

do $$
declare
  v_admin_count integer;
  v_admin_user_id uuid;
  v_admin_display_name text;
  v_admin_email text;
begin
  select
    count(*),
    (array_agg(profile.user_id order by profile.created_at))[1],
    (array_agg(profile.display_name order by profile.created_at))[1],
    (array_agg(app_user.email order by profile.created_at))[1]
  into v_admin_count, v_admin_user_id, v_admin_display_name, v_admin_email
  from public.app_profiles as profile
  join auth.users as app_user on app_user.id = profile.user_id
  where profile.app_role = 'admin';

  if (select count(*) from public.app_profiles where app_role = 'admin') <> 1
    or v_admin_count <> 1 then
    raise exception 'RESET ABORTED: expected exactly one app_profiles admin with an auth.users row';
  end if;

  raise notice 'Preserving admin user_id=%, display_name=%, email=%',
    v_admin_user_id, v_admin_display_name, v_admin_email;
end;
$$;

create temporary table pre_release_reference_counts on commit drop as
select 'buffalo_shortcut_targets'::text as table_name, count(*)::bigint as row_count
from public.buffalo_shortcut_targets
union all
select 'trottl_special_minigame_registry', count(*)::bigint
from public.trottl_special_minigame_registry;

-- Special minigame runtime rows, then their parent rounds/sessions.
delete from public.trottl_special_fish_memory_runs;
delete from public.trottl_special_fish_memory_rounds;
delete from public.trottl_special_fish_count_runs;
delete from public.trottl_special_fish_count_rounds;
delete from public.trottl_special_catch_me_runs;
delete from public.trottl_special_catch_me_rounds;
delete from public.trottl_special_reaction_runs;
delete from public.trottl_special_color_chaos_runs;
delete from public.trottl_special_stop_fish_runs;
delete from public.trottl_special_poison_fish_runs;
delete from public.trottl_special_panic_submissions;
delete from public.trottl_special_spectators;
delete from public.trottl_special_players;
delete from public.trottl_special_sessions;

delete from public.trottl_classic_players;
delete from public.trottl_classic_sessions;

-- Tournament match/entry references are deferrable; explicit child-first
-- deletion keeps the operation understandable and independent of cascades.
delete from public.tournament_placements;
delete from public.tournament_group_entries;
delete from public.tournament_matches;
delete from public.tournament_team_members;
delete from public.tournament_groups;
delete from public.tournament_entries;
delete from public.tournaments;
delete from public.tournament_admin_audit;

delete from public.buffalo_push_deliveries;
delete from public.buffalo_push_jobs;
delete from public.push_subscriptions;
delete from public.buffalo_events;
delete from public.buffalo_shortcut_devices;

delete from public.roulette_spin_events;
delete from public.roulette_gold_events;
delete from public.roulette_stats;

-- app_profiles rows cascade from auth.users. All runtime rows that used
-- RESTRICT references have already been removed. The one admin is excluded.
delete from auth.users as app_user
where app_user.id <> (
  select profile.user_id
  from public.app_profiles as profile
  where profile.app_role = 'admin'
);

do $$
declare
  v_table text;
  v_has_rows boolean;
begin
  foreach v_table in array array[
    'roulette_stats', 'roulette_gold_events', 'roulette_spin_events',
    'tournaments', 'tournament_entries', 'tournament_team_members',
    'tournament_groups', 'tournament_group_entries', 'tournament_matches',
    'tournament_placements', 'tournament_admin_audit',
    'buffalo_events', 'push_subscriptions', 'buffalo_push_jobs',
    'buffalo_push_deliveries', 'buffalo_shortcut_devices',
    'trottl_classic_sessions', 'trottl_classic_players',
    'trottl_special_sessions', 'trottl_special_players',
    'trottl_special_spectators', 'trottl_special_panic_submissions',
    'trottl_special_reaction_runs', 'trottl_special_color_chaos_runs',
    'trottl_special_fish_memory_rounds', 'trottl_special_fish_memory_runs',
    'trottl_special_stop_fish_runs', 'trottl_special_poison_fish_runs',
    'trottl_special_fish_count_rounds', 'trottl_special_fish_count_runs',
    'trottl_special_catch_me_rounds', 'trottl_special_catch_me_runs'
  ] loop
    execute format('select exists (select 1 from public.%I)', v_table) into v_has_rows;
    if v_has_rows then
      raise exception 'RESET ABORTED: public.% is not empty after reset', v_table;
    end if;
  end loop;

  if (select count(*) from public.app_profiles) <> 1
    or (select count(*) from public.app_profiles where app_role = 'admin') <> 1
    or (select count(*) from auth.users) <> 1 then
    raise exception 'RESET ABORTED: exactly one admin auth user/profile must remain';
  end if;

  if exists (
    select 1
    from pre_release_reference_counts as before_reset
    join (
      select 'buffalo_shortcut_targets'::text as table_name, count(*)::bigint as row_count
      from public.buffalo_shortcut_targets
      union all
      select 'trottl_special_minigame_registry', count(*)::bigint
      from public.trottl_special_minigame_registry
    ) as after_reset using (table_name)
    where before_reset.row_count <> after_reset.row_count
  ) then
    raise exception 'RESET ABORTED: static reference rows changed';
  end if;
end;
$$;

commit;

-- Human-readable post-reset evidence. Every delete-class row must be zero.
select 'auth.users' as table_name, count(*) as row_count from auth.users
union all select 'app_profiles', count(*) from public.app_profiles
union all select 'roulette_stats', count(*) from public.roulette_stats
union all select 'roulette_gold_events', count(*) from public.roulette_gold_events
union all select 'roulette_spin_events', count(*) from public.roulette_spin_events
union all select 'tournaments', count(*) from public.tournaments
union all select 'buffalo_events', count(*) from public.buffalo_events
union all select 'push_subscriptions', count(*) from public.push_subscriptions
union all select 'buffalo_shortcut_devices', count(*) from public.buffalo_shortcut_devices
union all select 'trottl_classic_sessions', count(*) from public.trottl_classic_sessions
union all select 'trottl_special_sessions', count(*) from public.trottl_special_sessions
union all select 'buffalo_shortcut_targets (preserved)', count(*) from public.buffalo_shortcut_targets
union all select 'trottl_special_minigame_registry (preserved)', count(*) from public.trottl_special_minigame_registry
order by table_name;

select
  profile.user_id as preserved_admin_user_id,
  profile.display_name as preserved_admin_display_name,
  app_user.email as preserved_admin_email
from public.app_profiles as profile
join auth.users as app_user on app_user.id = profile.user_id
where profile.app_role = 'admin';
