-- Fischteich production cutover: read-only inventory.
-- Run manually in the Supabase SQL editor before pre-release-reset.sql.
-- This file intentionally contains SELECT statements only.

select
  profile.user_id as admin_user_id,
  profile.display_name as admin_display_name,
  app_user.email as admin_email,
  app_user.is_anonymous as admin_is_anonymous,
  app_user.created_at as admin_created_at
from public.app_profiles as profile
join auth.users as app_user on app_user.id = profile.user_id
where profile.app_role = 'admin'
order by profile.created_at;

with inventory(data_class, table_name, row_count) as (
  select 'preserve', 'auth.users (admin)', count(*) from auth.users as u
    join public.app_profiles as p on p.user_id = u.id where p.app_role = 'admin'
  union all select 'delete', 'auth.users (non-admin)', count(*) from auth.users as u
    where not exists (select 1 from public.app_profiles as p where p.user_id = u.id and p.app_role = 'admin')
  union all select 'preserve', 'app_profiles (admin)', count(*) from public.app_profiles where app_role = 'admin'
  union all select 'delete', 'app_profiles (non-admin)', count(*) from public.app_profiles where app_role <> 'admin'
  union all select 'delete', 'roulette_stats', count(*) from public.roulette_stats
  union all select 'delete', 'roulette_gold_events', count(*) from public.roulette_gold_events
  union all select 'delete', 'roulette_spin_events', count(*) from public.roulette_spin_events
  union all select 'delete', 'tournaments', count(*) from public.tournaments
  union all select 'delete', 'tournament_entries', count(*) from public.tournament_entries
  union all select 'delete', 'tournament_team_members', count(*) from public.tournament_team_members
  union all select 'delete', 'tournament_groups', count(*) from public.tournament_groups
  union all select 'delete', 'tournament_group_entries', count(*) from public.tournament_group_entries
  union all select 'delete', 'tournament_matches', count(*) from public.tournament_matches
  union all select 'delete', 'tournament_placements', count(*) from public.tournament_placements
  union all select 'delete', 'tournament_admin_audit', count(*) from public.tournament_admin_audit
  union all select 'delete', 'buffalo_events', count(*) from public.buffalo_events
  union all select 'delete', 'push_subscriptions', count(*) from public.push_subscriptions
  union all select 'delete', 'buffalo_push_jobs', count(*) from public.buffalo_push_jobs
  union all select 'delete', 'buffalo_push_deliveries', count(*) from public.buffalo_push_deliveries
  union all select 'delete', 'buffalo_shortcut_devices', count(*) from public.buffalo_shortcut_devices
  union all select 'preserve', 'buffalo_shortcut_targets', count(*) from public.buffalo_shortcut_targets
  union all select 'delete', 'trottl_classic_sessions', count(*) from public.trottl_classic_sessions
  union all select 'delete', 'trottl_classic_players', count(*) from public.trottl_classic_players
  union all select 'delete', 'trottl_special_sessions', count(*) from public.trottl_special_sessions
  union all select 'delete', 'trottl_special_players', count(*) from public.trottl_special_players
  union all select 'delete', 'trottl_special_spectators', count(*) from public.trottl_special_spectators
  union all select 'delete', 'trottl_special_panic_submissions', count(*) from public.trottl_special_panic_submissions
  union all select 'preserve', 'trottl_special_minigame_registry', count(*) from public.trottl_special_minigame_registry
  union all select 'delete', 'trottl_special_reaction_runs', count(*) from public.trottl_special_reaction_runs
  union all select 'delete', 'trottl_special_color_chaos_runs', count(*) from public.trottl_special_color_chaos_runs
  union all select 'delete', 'trottl_special_fish_memory_rounds', count(*) from public.trottl_special_fish_memory_rounds
  union all select 'delete', 'trottl_special_fish_memory_runs', count(*) from public.trottl_special_fish_memory_runs
  union all select 'delete', 'trottl_special_stop_fish_runs', count(*) from public.trottl_special_stop_fish_runs
  union all select 'delete', 'trottl_special_poison_fish_runs', count(*) from public.trottl_special_poison_fish_runs
  union all select 'delete', 'trottl_special_fish_count_rounds', count(*) from public.trottl_special_fish_count_rounds
  union all select 'delete', 'trottl_special_fish_count_runs', count(*) from public.trottl_special_fish_count_runs
  union all select 'delete', 'trottl_special_catch_me_rounds', count(*) from public.trottl_special_catch_me_rounds
  union all select 'delete', 'trottl_special_catch_me_runs', count(*) from public.trottl_special_catch_me_runs
)
select data_class, table_name, row_count
from inventory
order by data_class, table_name;

select
  count(*) as roulette_player_rows,
  coalesce(sum(total_spins), 0) as total_spins,
  coalesce(sum(turbolachs_count), 0) as turbolachs_count,
  coalesce(sum(nitroforelle_count), 0) as nitroforelle_count,
  coalesce(sum(goldfish_count), 0) as goldfish_count,
  max(last_gold_hit_at) as last_gold_hit_at
from public.roulette_stats;

select status, count(*) as tournament_count
from public.tournaments
group by status
order by status;

select
  tc.constraint_name,
  tc.table_schema || '.' || tc.table_name as child_table,
  ccu.table_schema || '.' || ccu.table_name as parent_table,
  rc.delete_rule,
  tc.is_deferrable,
  tc.initially_deferred
from information_schema.table_constraints as tc
join information_schema.referential_constraints as rc
  on rc.constraint_schema = tc.constraint_schema
 and rc.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_schema = rc.unique_constraint_schema
 and ccu.constraint_name = rc.unique_constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema in ('public', 'auth')
  and ccu.table_schema in ('public', 'auth')
order by parent_table, child_table, tc.constraint_name;
