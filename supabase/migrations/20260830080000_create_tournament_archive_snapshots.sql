begin;

alter table public.tournament_placements
  drop constraint if exists tournament_placements_place_key;

create unique index if not exists tournament_placements_one_champion_idx
  on public.tournament_placements (tournament_id)
  where placement = 1;

create or replace function public.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and (
        public.is_tournament_admin()
        or (
          tournament.host_user_id = (select auth.uid())
          and tournament.deleted_at is null
          and tournament.status <> 'finished'
        )
      )
  );
$$;

comment on function public.can_manage_tournament(uuid) is
  'Admins may manage every tournament; normal hosts lose write access once a tournament is finished.';

drop policy if exists tournaments_update_as_host_or_admin on public.tournaments;
create policy tournaments_update_as_host_or_admin
on public.tournaments
for update
to authenticated
using (
  public.is_tournament_admin()
  or (
    host_user_id = (select auth.uid())
    and deleted_at is null
    and status <> 'finished'
  )
)
with check (
  public.is_tournament_admin()
  or (
    host_user_id = (select auth.uid())
    and deleted_at is null
    and status <> 'finished'
  )
);

create function public.write_tournament_placement_snapshot(
  p_tournament_id uuid,
  p_entry_id uuid,
  p_placement integer,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_stats jsonb;
begin
  select entry.display_name_snapshot
  into v_display_name
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.id = p_entry_id;

  if v_display_name is null then
    raise exception using
      errcode = '23503',
      message = 'Placement entry must belong to the tournament';
  end if;

  select pg_catalog.jsonb_build_object(
    'matches_played', stats.matches_played,
    'matches_won', stats.matches_won,
    'matches_lost', stats.matches_lost,
    'score_for', stats.score_for,
    'score_against', stats.score_against,
    'score_diff', stats.score_for - stats.score_against,
    'group_matches_played', stats.group_matches_played,
    'group_wins', stats.group_wins,
    'knockout_wins', stats.knockout_wins,
    'tiebreaker_matches', stats.tiebreaker_matches,
    'loser_bracket_matches', stats.loser_bracket_matches,
    'source', p_source
  )
  into v_stats
  from (
    select
      pg_catalog.count(*)::integer as matches_played,
      pg_catalog.count(*) filter (
        where tournament_match.winner_entry_id = p_entry_id
      )::integer as matches_won,
      pg_catalog.count(*) filter (
        where tournament_match.winner_entry_id is not null
          and tournament_match.winner_entry_id <> p_entry_id
      )::integer as matches_lost,
      coalesce(pg_catalog.sum(
        case
          when tournament_match.entry_a_id = p_entry_id then tournament_match.score_a
          else tournament_match.score_b
        end
      ), 0) as score_for,
      coalesce(pg_catalog.sum(
        case
          when tournament_match.entry_a_id = p_entry_id then tournament_match.score_b
          else tournament_match.score_a
        end
      ), 0) as score_against,
      pg_catalog.count(*) filter (
        where tournament_match.stage = 'group'
          and not tournament_match.is_tiebreaker
      )::integer as group_matches_played,
      pg_catalog.count(*) filter (
        where tournament_match.stage = 'group'
          and not tournament_match.is_tiebreaker
          and tournament_match.winner_entry_id = p_entry_id
      )::integer as group_wins,
      pg_catalog.count(*) filter (
        where tournament_match.stage in ('winner_bracket', 'loser_bracket', 'final')
          and tournament_match.winner_entry_id = p_entry_id
      )::integer as knockout_wins,
      pg_catalog.count(*) filter (
        where tournament_match.is_tiebreaker
      )::integer as tiebreaker_matches,
      pg_catalog.count(*) filter (
        where tournament_match.stage = 'loser_bracket'
      )::integer as loser_bracket_matches
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.match_status = 'completed'
      and p_entry_id in (tournament_match.entry_a_id, tournament_match.entry_b_id)
  ) as stats;

  insert into public.tournament_placements (
    tournament_id,
    entry_id,
    placement,
    display_name_snapshot,
    stats_snapshot
  ) values (
    p_tournament_id,
    p_entry_id,
    p_placement,
    v_display_name,
    v_stats
  );
end;
$$;

comment on function public.write_tournament_placement_snapshot(uuid, uuid, integer, text) is
  'Internal helper that stores one immutable placement and aggregate finish-time statistics.';

create function public.rebuild_tournament_placement_snapshots(
  p_tournament_id uuid,
  p_champion_entry_id uuid,
  p_source text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_deciding_final public.tournament_matches%rowtype;
  v_runner_up_entry_id uuid;
  v_eliminated record;
  v_remaining record;
  v_next_shared_placement integer;
  v_placement_count integer;
  v_entry_count integer;
begin
  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  if v_tournament.status <> 'finished' then
    raise exception using errcode = '23514', message = 'Placement snapshots require a finished tournament';
  end if;

  if not exists (
    select 1
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and entry.id = p_champion_entry_id
  ) then
    raise exception using errcode = '23503', message = 'The champion entry does not belong to the tournament';
  end if;

  select tournament_match.*
  into v_deciding_final
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.stage = 'final'
    and tournament_match.match_status = 'completed'
    and tournament_match.winner_entry_id is not null
  order by
    case tournament_match.phase_label
      when 'Grand Final Reset' then 0
      when 'Grand Final' then 1
      else 2
    end,
    tournament_match.round_number desc,
    tournament_match.completed_at desc nulls last
  limit 1;

  if not found or v_deciding_final.winner_entry_id <> p_champion_entry_id then
    raise exception using errcode = '23514', message = 'The champion must be the winner of the deciding final';
  end if;

  v_runner_up_entry_id := case
    when v_deciding_final.entry_a_id = p_champion_entry_id then v_deciding_final.entry_b_id
    else v_deciding_final.entry_a_id
  end;

  if v_runner_up_entry_id is null or v_runner_up_entry_id = p_champion_entry_id then
    raise exception using errcode = '23514', message = 'The deciding final must contain a distinct runner-up';
  end if;

  delete from public.tournament_placements
  where tournament_id = p_tournament_id;

  perform public.write_tournament_placement_snapshot(
    p_tournament_id, p_champion_entry_id, 1, p_source
  );
  perform public.write_tournament_placement_snapshot(
    p_tournament_id, v_runner_up_entry_id, 2, p_source
  );

  if v_tournament.loser_bracket_enabled then
    for v_eliminated in
      with loser_eliminations as (
        select
          case
            when tournament_match.winner_entry_id = tournament_match.entry_a_id then tournament_match.entry_b_id
            else tournament_match.entry_a_id
          end as entry_id,
          tournament_match.round_number
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.stage = 'loser_bracket'
          and tournament_match.match_status = 'completed'
          and tournament_match.winner_entry_id is not null
      ), deduplicated as (
        select elimination.entry_id, pg_catalog.max(elimination.round_number)::integer as elimination_round
        from loser_eliminations as elimination
        where elimination.entry_id not in (p_champion_entry_id, v_runner_up_entry_id)
        group by elimination.entry_id
      ), round_sizes as (
        select elimination_round, pg_catalog.count(*)::integer as eliminated_count
        from deduplicated
        group by elimination_round
      ), ranked_rounds as (
        select
          elimination_round,
          3 + coalesce(
            pg_catalog.sum(eliminated_count) over (
              order by elimination_round desc
              rows between unbounded preceding and 1 preceding
            ),
            0
          )::integer as placement
        from round_sizes
      )
      select deduplicated.entry_id, ranked_rounds.placement
      from deduplicated
      join ranked_rounds using (elimination_round)
      order by ranked_rounds.placement, deduplicated.entry_id
    loop
      perform public.write_tournament_placement_snapshot(
        p_tournament_id, v_eliminated.entry_id, v_eliminated.placement, p_source
      );
    end loop;
  else
    for v_eliminated in
      with knockout_eliminations as (
        select
          case
            when tournament_match.winner_entry_id = tournament_match.entry_a_id then tournament_match.entry_b_id
            else tournament_match.entry_a_id
          end as entry_id,
          tournament_match.round_number
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.stage in ('winner_bracket', 'final')
          and tournament_match.match_status = 'completed'
          and tournament_match.winner_entry_id is not null
      ), deduplicated as (
        select elimination.entry_id, pg_catalog.max(elimination.round_number)::integer as elimination_round
        from knockout_eliminations as elimination
        where elimination.entry_id not in (p_champion_entry_id, v_runner_up_entry_id)
        group by elimination.entry_id
      ), round_sizes as (
        select elimination_round, pg_catalog.count(*)::integer as eliminated_count
        from deduplicated
        group by elimination_round
      ), ranked_rounds as (
        select
          elimination_round,
          3 + coalesce(
            pg_catalog.sum(eliminated_count) over (
              order by elimination_round desc
              rows between unbounded preceding and 1 preceding
            ),
            0
          )::integer as placement
        from round_sizes
      )
      select deduplicated.entry_id, ranked_rounds.placement
      from deduplicated
      join ranked_rounds using (elimination_round)
      order by ranked_rounds.placement, deduplicated.entry_id
    loop
      perform public.write_tournament_placement_snapshot(
        p_tournament_id, v_eliminated.entry_id, v_eliminated.placement, p_source
      );
    end loop;
  end if;

  select pg_catalog.count(*)::integer + 1
  into v_next_shared_placement
  from public.tournament_placements as placement
  where placement.tournament_id = p_tournament_id;

  for v_remaining in
    select entry.id
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and not exists (
        select 1
        from public.tournament_placements as placement
        where placement.tournament_id = p_tournament_id
          and placement.entry_id = entry.id
      )
    order by entry.sort_order
  loop
    perform public.write_tournament_placement_snapshot(
      p_tournament_id, v_remaining.id, v_next_shared_placement, p_source
    );
  end loop;

  select pg_catalog.count(*)::integer
  into v_placement_count
  from public.tournament_placements as placement
  where placement.tournament_id = p_tournament_id;

  select pg_catalog.count(*)::integer
  into v_entry_count
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id;

  if v_placement_count <> v_entry_count then
    raise exception using errcode = '23514', message = 'Every tournament entry must receive exactly one placement';
  end if;

  return v_placement_count;
end;
$$;

comment on function public.rebuild_tournament_placement_snapshots(uuid, uuid, text) is
  'Internal atomic competition-ranking builder for single and double elimination tournaments.';

create or replace function public.finish_tournament_with_champion(
  p_tournament_id uuid,
  p_champion_entry_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tournaments
  set status = 'finished',
      current_phase = 'finished'
  where id = p_tournament_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  perform public.rebuild_tournament_placement_snapshots(
    p_tournament_id,
    p_champion_entry_id,
    p_source
  );
end;
$$;

comment on function public.finish_tournament_with_champion(uuid, uuid, text) is
  'Atomically finishes a tournament and stores complete placement and statistics snapshots.';

create function public.backfill_finished_tournament_placements(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_champion_entry_id uuid;
begin
  if auth.uid() is not null and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only an admin may backfill tournament placements';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and tournament.status = 'finished'
  ) then
    raise exception using errcode = '23514', message = 'Only a finished tournament can be backfilled';
  end if;

  select placement.entry_id
  into v_champion_entry_id
  from public.tournament_placements as placement
  where placement.tournament_id = p_tournament_id
    and placement.placement = 1
  limit 1;

  if v_champion_entry_id is null then
    select tournament_match.winner_entry_id
    into v_champion_entry_id
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = 'final'
      and tournament_match.match_status = 'completed'
      and tournament_match.winner_entry_id is not null
    order by
      case tournament_match.phase_label
        when 'Grand Final Reset' then 0
        when 'Grand Final' then 1
        else 2
      end,
      tournament_match.round_number desc,
      tournament_match.completed_at desc nulls last
    limit 1;
  end if;

  if v_champion_entry_id is null then
    raise exception using errcode = 'P0002', message = 'No completed deciding final was found';
  end if;

  return public.rebuild_tournament_placement_snapshots(
    p_tournament_id,
    v_champion_entry_id,
    'admin_backfill'
  );
end;
$$;

comment on function public.backfill_finished_tournament_placements(uuid) is
  'Explicit admin-only backfill for one existing finished tournament; never runs automatically.';

revoke all on function public.write_tournament_placement_snapshot(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.rebuild_tournament_placement_snapshots(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finish_tournament_with_champion(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.backfill_finished_tournament_placements(uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_finished_tournament_placements(uuid)
  to authenticated;

commit;
