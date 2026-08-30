begin;

create or replace function public.get_tournament_regular_group_standings(p_tournament_id uuid)
returns table (
  group_id uuid,
  group_label text,
  group_sort_order integer,
  entry_id uuid,
  display_name text,
  group_seed integer,
  played integer,
  wins integer,
  losses integer,
  score_for numeric,
  score_against numeric,
  score_difference numeric,
  standing_rank integer,
  display_position integer,
  is_tied boolean,
  tied_rank integer,
  qualification_tie boolean,
  qualified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with tournament_config as (
    select tournament.id, tournament.advancers_per_group
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and tournament.group_stage_enabled
      and public.can_view_tournament(tournament.id)
  ), member_stats as (
    select
      tournament_group.id as group_id,
      tournament_group.label as group_label,
      tournament_group.sort_order as group_sort_order,
      entry.id as entry_id,
      entry.display_name_snapshot as display_name,
      group_entry.group_seed,
      pg_catalog.count(tournament_match.id)::integer as played,
      pg_catalog.count(tournament_match.id) filter (
        where tournament_match.winner_entry_id = entry.id
      )::integer as wins,
      pg_catalog.count(tournament_match.id) filter (
        where tournament_match.winner_entry_id is not null
          and tournament_match.winner_entry_id <> entry.id
      )::integer as losses,
      coalesce(pg_catalog.sum(
        case when tournament_match.entry_a_id = entry.id then tournament_match.score_a
             when tournament_match.entry_b_id = entry.id then tournament_match.score_b
             else 0 end
      ), 0::numeric) as score_for,
      coalesce(pg_catalog.sum(
        case when tournament_match.entry_a_id = entry.id then tournament_match.score_b
             when tournament_match.entry_b_id = entry.id then tournament_match.score_a
             else 0 end
      ), 0::numeric) as score_against,
      tournament_config.advancers_per_group
    from tournament_config
    join public.tournament_groups as tournament_group
      on tournament_group.tournament_id = tournament_config.id
    join public.tournament_group_entries as group_entry
      on group_entry.tournament_id = tournament_group.tournament_id
      and group_entry.group_id = tournament_group.id
    join public.tournament_entries as entry
      on entry.tournament_id = group_entry.tournament_id
      and entry.id = group_entry.entry_id
    left join public.tournament_matches as tournament_match
      on tournament_match.tournament_id = tournament_group.tournament_id
      and tournament_match.group_id = tournament_group.id
      and tournament_match.stage = 'group'
      and not tournament_match.is_tiebreaker
      and tournament_match.match_status = 'completed'
      and entry.id in (tournament_match.entry_a_id, tournament_match.entry_b_id)
    group by
      tournament_group.id, tournament_group.label, tournament_group.sort_order,
      entry.id, entry.display_name_snapshot, group_entry.group_seed,
      tournament_config.advancers_per_group
  ), ranked as (
    select
      member_stats.*,
      (member_stats.score_for - member_stats.score_against) as score_difference,
      pg_catalog.rank() over (
        partition by member_stats.group_id
        order by
          member_stats.wins desc,
          (member_stats.score_for - member_stats.score_against) desc
      )::integer as standing_rank,
      pg_catalog.row_number() over (
        partition by member_stats.group_id
        order by
          member_stats.wins desc,
          (member_stats.score_for - member_stats.score_against) desc,
          member_stats.group_seed,
          member_stats.entry_id
      )::integer as display_position,
      pg_catalog.count(*) over (
        partition by
          member_stats.group_id,
          member_stats.wins,
          (member_stats.score_for - member_stats.score_against)
      )::integer as tie_size
    from member_stats
  )
  select
    ranked.group_id,
    ranked.group_label,
    ranked.group_sort_order,
    ranked.entry_id,
    ranked.display_name,
    ranked.group_seed,
    ranked.played,
    ranked.wins,
    ranked.losses,
    ranked.score_for,
    ranked.score_against,
    ranked.score_difference,
    ranked.standing_rank,
    ranked.display_position,
    ranked.tie_size > 1 as is_tied,
    case when ranked.tie_size > 1 then ranked.standing_rank else null end as tied_rank,
    (
      ranked.tie_size > 1
      and ranked.standing_rank <= ranked.advancers_per_group
      and ranked.standing_rank + ranked.tie_size - 1 > ranked.advancers_per_group
    ) as qualification_tie,
    case
      when ranked.tie_size > 1
        and ranked.standing_rank <= ranked.advancers_per_group
        and ranked.standing_rank + ranked.tie_size - 1 > ranked.advancers_per_group
        then null
      else ranked.standing_rank <= ranked.advancers_per_group
    end as qualified
  from ranked
  order by ranked.group_sort_order, ranked.display_position;
$$;

comment on function public.get_tournament_regular_group_standings(uuid) is
  'Internal regular-match standings ranked only by wins and score difference; score totals remain statistical output.';

create or replace function public.get_tournament_group_tiebreaker_resolution(p_tournament_id uuid)
returns table (
  resolved_group_id uuid,
  resolved_entry_id uuid,
  final_qualification_rank integer,
  qualified boolean,
  tiebreaker_status text,
  tiebreaker_round integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boundary record;
  v_original_entry_ids uuid[];
  v_candidate_entry_ids uuid[];
  v_selected_entry_ids uuid[];
  v_safe_entry_ids uuid[];
  v_boundary_entry_ids uuid[];
  v_entry_id uuid;
  v_slots_remaining integer;
  v_current_round integer;
  v_match_count integer;
  v_incomplete_match_count integer;
  v_participant_count integer;
  v_expected_match_count integer;
  v_boundary_rank integer;
  v_safe_count integer;
  v_entry_index integer;
  v_selected_index integer;
  v_resolution_status text;
begin
  for v_boundary in
    select
      regular.group_id,
      regular.standing_rank as base_rank,
      tournament.advancers_per_group
    from public.get_tournament_regular_group_standings(p_tournament_id) as regular
    join public.tournaments as tournament on tournament.id = p_tournament_id
    where regular.qualification_tie
    group by regular.group_id, regular.standing_rank, tournament.advancers_per_group
    order by regular.group_id
  loop
    select pg_catalog.array_agg(regular.entry_id order by regular.group_seed, regular.entry_id)
    into v_original_entry_ids
    from public.get_tournament_regular_group_standings(p_tournament_id) as regular
    where regular.group_id = v_boundary.group_id
      and regular.standing_rank = v_boundary.base_rank;

    v_candidate_entry_ids := v_original_entry_ids;
    v_selected_entry_ids := '{}'::uuid[];
    v_slots_remaining := v_boundary.advancers_per_group - (v_boundary.base_rank - 1);
    v_current_round := 1;
    v_resolution_status := 'unresolved';

    loop
      select
        pg_catalog.count(*)::integer,
        pg_catalog.count(*) filter (where tournament_match.match_status <> 'completed')::integer
      into v_match_count, v_incomplete_match_count
      from public.tournament_matches as tournament_match
      where tournament_match.tournament_id = p_tournament_id
        and tournament_match.group_id = v_boundary.group_id
        and tournament_match.stage = 'group'
        and tournament_match.is_tiebreaker
        and tournament_match.tiebreaker_round = v_current_round;

      if v_match_count = 0 then
        v_resolution_status := 'unresolved';
        exit;
      end if;

      v_expected_match_count := pg_catalog.cardinality(v_candidate_entry_ids)
        * (pg_catalog.cardinality(v_candidate_entry_ids) - 1) / 2;

      select pg_catalog.count(distinct participant.entry_id)::integer
      into v_participant_count
      from (
        select tournament_match.entry_a_id as entry_id
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.group_id = v_boundary.group_id
          and tournament_match.is_tiebreaker
          and tournament_match.tiebreaker_round = v_current_round
        union
        select tournament_match.entry_b_id
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.group_id = v_boundary.group_id
          and tournament_match.is_tiebreaker
          and tournament_match.tiebreaker_round = v_current_round
      ) as participant;

      if v_match_count <> v_expected_match_count
        or v_participant_count <> pg_catalog.cardinality(v_candidate_entry_ids)
        or exists (
          select 1
          from public.tournament_matches as tournament_match
          cross join lateral (
            values (tournament_match.entry_a_id), (tournament_match.entry_b_id)
          ) as participant(entry_id)
          where tournament_match.tournament_id = p_tournament_id
            and tournament_match.group_id = v_boundary.group_id
            and tournament_match.stage = 'group'
            and tournament_match.is_tiebreaker
            and tournament_match.tiebreaker_round = v_current_round
            and not (participant.entry_id = any(v_candidate_entry_ids))
        )
      then
        v_resolution_status := 'unresolved';
        exit;
      end if;

      if v_incomplete_match_count > 0 then
        v_resolution_status := 'in_progress';
        exit;
      end if;

      with round_stats as (
        select
          candidate.entry_id,
          group_entry.group_seed,
          pg_catalog.count(tournament_match.id) filter (
            where tournament_match.winner_entry_id = candidate.entry_id
          )::integer as wins,
          coalesce(pg_catalog.sum(
            case when tournament_match.entry_a_id = candidate.entry_id then tournament_match.score_a
                 when tournament_match.entry_b_id = candidate.entry_id then tournament_match.score_b
                 else 0 end
          ), 0::numeric) as score_for,
          coalesce(pg_catalog.sum(
            case when tournament_match.entry_a_id = candidate.entry_id then tournament_match.score_b
                 when tournament_match.entry_b_id = candidate.entry_id then tournament_match.score_a
                 else 0 end
          ), 0::numeric) as score_against
        from pg_catalog.unnest(v_candidate_entry_ids) as candidate(entry_id)
        join public.tournament_group_entries as group_entry
          on group_entry.tournament_id = p_tournament_id
          and group_entry.group_id = v_boundary.group_id
          and group_entry.entry_id = candidate.entry_id
        left join public.tournament_matches as tournament_match
          on tournament_match.tournament_id = p_tournament_id
          and tournament_match.group_id = v_boundary.group_id
          and tournament_match.is_tiebreaker
          and tournament_match.tiebreaker_round = v_current_round
          and tournament_match.match_status = 'completed'
          and candidate.entry_id in (tournament_match.entry_a_id, tournament_match.entry_b_id)
        group by candidate.entry_id, group_entry.group_seed
      ), ranked_base as (
        select
          round_stats.*,
          pg_catalog.rank() over (
            order by
              round_stats.wins desc,
              (round_stats.score_for - round_stats.score_against) desc
          )::integer as round_rank
        from round_stats
      ), ranked as (
        select
          ranked_base.*,
          pg_catalog.count(*) over (
            partition by ranked_base.wins,
              (ranked_base.score_for - ranked_base.score_against)
          )::integer as tie_size
        from ranked_base
      )
      select
        pg_catalog.array_agg(ranked.entry_id order by ranked.round_rank, ranked.group_seed, ranked.entry_id)
          filter (where ranked.round_rank + ranked.tie_size - 1 <= v_slots_remaining),
        pg_catalog.min(ranked.round_rank)
          filter (
            where ranked.tie_size > 1
              and ranked.round_rank <= v_slots_remaining
              and ranked.round_rank + ranked.tie_size - 1 > v_slots_remaining
          ),
        pg_catalog.array_agg(ranked.entry_id order by ranked.group_seed, ranked.entry_id)
          filter (
            where ranked.tie_size > 1
              and ranked.round_rank <= v_slots_remaining
              and ranked.round_rank + ranked.tie_size - 1 > v_slots_remaining
          )
      into v_safe_entry_ids, v_boundary_rank, v_boundary_entry_ids
      from ranked;

      v_safe_entry_ids := coalesce(v_safe_entry_ids, '{}'::uuid[]);
      v_safe_count := pg_catalog.cardinality(v_safe_entry_ids);
      v_selected_entry_ids := v_selected_entry_ids || v_safe_entry_ids;

      if v_boundary_rank is null then
        if v_safe_count <> v_slots_remaining then
          v_resolution_status := 'unresolved';
        else
          v_candidate_entry_ids := '{}'::uuid[];
          v_resolution_status := 'resolved';
        end if;
        exit;
      end if;

      v_slots_remaining := v_slots_remaining - v_safe_count;
      v_candidate_entry_ids := v_boundary_entry_ids;
      v_current_round := v_current_round + 1;
      v_resolution_status := 'unresolved';
    end loop;

    for v_entry_index in 1..pg_catalog.cardinality(v_original_entry_ids) loop
      v_entry_id := v_original_entry_ids[v_entry_index];
      v_selected_index := pg_catalog.array_position(v_selected_entry_ids, v_entry_id);
      resolved_group_id := v_boundary.group_id;
      resolved_entry_id := v_entry_id;
      tiebreaker_round := v_current_round;

      if v_selected_index is not null then
        final_qualification_rank := v_boundary.base_rank + v_selected_index - 1;
        qualified := true;
        tiebreaker_status := 'resolved';
      elsif v_entry_id = any(v_candidate_entry_ids) and v_resolution_status <> 'resolved' then
        final_qualification_rank := null;
        qualified := null;
        tiebreaker_status := v_resolution_status;
      else
        final_qualification_rank := null;
        qualified := false;
        tiebreaker_status := 'resolved';
      end if;

      return next;
    end loop;
  end loop;
end;
$$;

comment on function public.get_tournament_group_tiebreaker_resolution(uuid) is
  'Resolves qualification-boundary ties by wins and score difference only across sequential decision rounds.';

commit;
