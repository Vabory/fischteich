begin;

create function public.create_tournament_winner_bracket(
  p_tournament_id uuid,
  p_ranked_entry_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_count integer := pg_catalog.cardinality(p_ranked_entry_ids);
  v_distinct_entry_count integer;
  v_valid_entry_count integer;
  v_bracket_size integer := 1;
  v_round_count integer := 0;
  v_bracket_work integer;
  v_round_number integer;
  v_round_match_count integer;
  v_match_index integer;
  v_pair_index integer;
  v_seed_slot_size integer := 2;
  v_seed_slots integer[] := array[1, 2];
  v_next_seed_slots integer[];
  v_primary_seeds integer[] := '{}'::integer[];
  v_seed_entries uuid[] := '{}'::uuid[];
  v_remaining_entries uuid[] := p_ranked_entry_ids;
  v_seed_a integer;
  v_seed_b integer;
  v_primary_seed integer;
  v_opponent_seed integer;
  v_seed_index integer;
  v_entry_id uuid;
  v_entry_a_id uuid;
  v_entry_b_id uuid;
  v_primary_entry_id uuid;
  v_primary_group_id uuid;
  v_target_match_id uuid;
  v_target_stage text;
  v_target_slot text;
begin
  if p_tournament_id is null then
    raise exception using errcode = '22023', message = 'tournament_id is required';
  end if;

  if p_ranked_entry_ids is null or v_entry_count < 2 then
    raise exception using errcode = '22023', message = 'At least two ranked entries are required';
  end if;

  select pg_catalog.count(distinct ranked_entry.entry_id)::integer
  into v_distinct_entry_count
  from pg_catalog.unnest(p_ranked_entry_ids) as ranked_entry(entry_id);

  if v_distinct_entry_count <> v_entry_count then
    raise exception using errcode = '22023', message = 'Ranked entries must be unique';
  end if;

  select pg_catalog.count(*)::integer
  into v_valid_entry_count
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.entry_status = 'active'
    and entry.id = any(p_ranked_entry_ids);

  if v_valid_entry_count <> v_entry_count then
    raise exception using errcode = '22023', message = 'Every ranked entry must be active and belong to the tournament';
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage in ('winner_bracket', 'final')
  ) then
    raise exception using errcode = '55000', message = 'A winner bracket already exists for this tournament';
  end if;

  while v_bracket_size < v_entry_count loop
    v_bracket_size := v_bracket_size * 2;
  end loop;

  v_bracket_work := v_bracket_size;
  while v_bracket_work > 1 loop
    v_round_count := v_round_count + 1;
    v_bracket_work := v_bracket_work / 2;
  end loop;

  while v_seed_slot_size < v_bracket_size loop
    v_next_seed_slots := '{}'::integer[];
    for v_pair_index in 1..pg_catalog.cardinality(v_seed_slots) loop
      v_next_seed_slots := pg_catalog.array_append(v_next_seed_slots, v_seed_slots[v_pair_index]);
      v_next_seed_slots := pg_catalog.array_append(
        v_next_seed_slots,
        (v_seed_slot_size * 2) + 1 - v_seed_slots[v_pair_index]
      );
    end loop;
    v_seed_slots := v_next_seed_slots;
    v_seed_slot_size := v_seed_slot_size * 2;
  end loop;

  for v_match_index in 0..((v_bracket_size / 2) - 1) loop
    v_seed_a := v_seed_slots[(v_match_index * 2) + 1];
    v_seed_b := v_seed_slots[(v_match_index * 2) + 2];

    if v_seed_a <= v_entry_count and v_seed_b <= v_entry_count then
      v_primary_seeds := pg_catalog.array_append(v_primary_seeds, least(v_seed_a, v_seed_b));
    elsif v_seed_a <= v_entry_count then
      v_primary_seeds := pg_catalog.array_append(v_primary_seeds, v_seed_a);
    elsif v_seed_b <= v_entry_count then
      v_primary_seeds := pg_catalog.array_append(v_primary_seeds, v_seed_b);
    end if;
  end loop;

  select pg_catalog.array_agg(primary_seed.seed_value order by primary_seed.seed_value)
  into v_primary_seeds
  from pg_catalog.unnest(v_primary_seeds) as primary_seed(seed_value);

  for v_seed_index in 1..pg_catalog.cardinality(v_primary_seeds) loop
    v_primary_seed := v_primary_seeds[v_seed_index];
    v_entry_id := p_ranked_entry_ids[v_seed_index];
    v_seed_entries[v_primary_seed] := v_entry_id;
    v_remaining_entries := pg_catalog.array_remove(v_remaining_entries, v_entry_id);
  end loop;

  for v_primary_seed, v_opponent_seed in
    select
      least(v_seed_slots[seed_pair.pair_position], v_seed_slots[seed_pair.pair_position + 1]),
      greatest(v_seed_slots[seed_pair.pair_position], v_seed_slots[seed_pair.pair_position + 1])
    from pg_catalog.generate_series(1, pg_catalog.cardinality(v_seed_slots), 2)
      as seed_pair(pair_position)
    where v_seed_slots[seed_pair.pair_position] <= v_entry_count
      and v_seed_slots[seed_pair.pair_position + 1] <= v_entry_count
    order by least(v_seed_slots[seed_pair.pair_position], v_seed_slots[seed_pair.pair_position + 1])
  loop
    v_primary_entry_id := v_seed_entries[v_primary_seed];

    select group_entry.group_id
    into v_primary_group_id
    from public.tournament_group_entries as group_entry
    where group_entry.tournament_id = p_tournament_id
      and group_entry.entry_id = v_primary_entry_id;

    select remaining.entry_id
    into v_entry_id
    from pg_catalog.unnest(v_remaining_entries) with ordinality as remaining(entry_id, entry_order)
    left join public.tournament_group_entries as group_entry
      on group_entry.tournament_id = p_tournament_id
      and group_entry.entry_id = remaining.entry_id
    order by
      case when group_entry.group_id is distinct from v_primary_group_id then 0 else 1 end,
      remaining.entry_order
    limit 1;

    if v_entry_id is null then
      raise exception using errcode = '55000', message = 'Winner bracket seeding could not be completed';
    end if;

    v_seed_entries[v_opponent_seed] := v_entry_id;
    v_remaining_entries := pg_catalog.array_remove(v_remaining_entries, v_entry_id);
  end loop;

  if pg_catalog.cardinality(v_remaining_entries) <> 0 then
    raise exception using errcode = '55000', message = 'Winner bracket seeding left unassigned entries';
  end if;

  update public.tournament_entries as entry
  set seed = null
  where entry.tournament_id = p_tournament_id;

  for v_seed_index in 1..v_entry_count loop
    update public.tournament_entries as entry
    set seed = v_seed_index
    where entry.tournament_id = p_tournament_id
      and entry.id = v_seed_entries[v_seed_index];
  end loop;

  if v_round_count = 1 then
    insert into public.tournament_matches (
      tournament_id, stage, phase_label, entry_a_id, entry_b_id,
      match_status, round_number, match_order
    )
    values (
      p_tournament_id, 'final', 'Finale', v_seed_entries[1], v_seed_entries[2],
      'scheduled', 1, 0
    );
    return;
  end if;

  v_round_number := v_round_count;
  v_round_match_count := 1;

  while v_round_number >= 2 loop
    for v_match_index in 0..(v_round_match_count - 1) loop
      if v_round_number = v_round_count then
        v_target_match_id := null;
        v_target_slot := null;
      else
        v_target_stage := case
          when v_round_number + 1 = v_round_count then 'final'
          else 'winner_bracket'
        end;

        select tournament_match.id
        into v_target_match_id
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.stage = v_target_stage
          and tournament_match.round_number = v_round_number + 1
          and tournament_match.match_order = v_match_index / 2;

        v_target_slot := case when pg_catalog.mod(v_match_index, 2) = 0 then 'a' else 'b' end;
      end if;

      insert into public.tournament_matches (
        tournament_id, stage, phase_label, match_status, round_number, match_order,
        winner_advances_to_match_id, winner_advances_to_slot
      )
      values (
        p_tournament_id,
        case when v_round_number = v_round_count then 'final' else 'winner_bracket' end,
        case when v_round_number = v_round_count then 'Finale' else 'KO-Runde ' || v_round_number::text end,
        'scheduled', v_round_number, v_match_index, v_target_match_id, v_target_slot
      );
    end loop;

    v_round_number := v_round_number - 1;
    v_round_match_count := v_round_match_count * 2;
  end loop;

  for v_match_index in 0..((v_bracket_size / 2) - 1) loop
    v_seed_a := v_seed_slots[(v_match_index * 2) + 1];
    v_seed_b := v_seed_slots[(v_match_index * 2) + 2];
    v_entry_a_id := case when v_seed_a <= v_entry_count then v_seed_entries[v_seed_a] else null end;
    v_entry_b_id := case when v_seed_b <= v_entry_count then v_seed_entries[v_seed_b] else null end;

    select tournament_match.id
    into v_target_match_id
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = case when v_round_count = 2 then 'final' else 'winner_bracket' end
      and tournament_match.round_number = 2
      and tournament_match.match_order = v_match_index / 2;

    v_target_slot := case when pg_catalog.mod(v_match_index, 2) = 0 then 'a' else 'b' end;

    if v_entry_a_id is not null and v_entry_b_id is not null then
      insert into public.tournament_matches (
        tournament_id, stage, phase_label, entry_a_id, entry_b_id,
        match_status, round_number, match_order,
        winner_advances_to_match_id, winner_advances_to_slot
      )
      values (
        p_tournament_id, 'winner_bracket', 'KO-Runde 1', v_entry_a_id, v_entry_b_id,
        'scheduled', 1, v_match_index, v_target_match_id, v_target_slot
      );
    elsif v_entry_a_id is not null or v_entry_b_id is not null then
      if v_target_slot = 'a' then
        update public.tournament_matches
        set entry_a_id = coalesce(v_entry_a_id, v_entry_b_id)
        where id = v_target_match_id;
      else
        update public.tournament_matches
        set entry_b_id = coalesce(v_entry_a_id, v_entry_b_id)
        where id = v_target_match_id;
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.create_tournament_winner_bracket(uuid, uuid[]) is
  'Internal shared winner-bracket generator. Input order is sporting strength; standard seed slots distribute BYEs.';

create function public.get_tournament_group_standings(p_tournament_id uuid)
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
          (member_stats.score_for - member_stats.score_against) desc,
          member_stats.score_for desc
      )::integer as standing_rank,
      pg_catalog.row_number() over (
        partition by member_stats.group_id
        order by
          member_stats.wins desc,
          (member_stats.score_for - member_stats.score_against) desc,
          member_stats.score_for desc,
          member_stats.group_seed,
          member_stats.entry_id
      )::integer as display_position,
      pg_catalog.count(*) over (
        partition by
          member_stats.group_id,
          member_stats.wins,
          (member_stats.score_for - member_stats.score_against),
          member_stats.score_for
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

comment on function public.get_tournament_group_standings(uuid) is
  'Computes non-persistent group standings from completed regular group matches, including qualification-boundary ties.';

create function public.set_tournament_match_result(
  p_match_id uuid,
  p_score_a numeric,
  p_score_b numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament_id uuid;
  v_tournament public.tournaments%rowtype;
  v_match public.tournament_matches%rowtype;
  v_target_match public.tournament_matches%rowtype;
  v_new_winner_id uuid;
  v_target_entry_id uuid;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if p_match_id is null then
    raise exception using errcode = '22023', message = 'match_id is required';
  end if;

  if p_score_a is null or p_score_b is null then
    raise exception using errcode = '22023', message = 'Both scores are required';
  end if;

  if p_score_a::text in ('NaN', 'Infinity', '-Infinity')
    or p_score_b::text in ('NaN', 'Infinity', '-Infinity')
    or p_score_a < 0
    or p_score_b < 0
    or p_score_a > 9999999999.9999
    or p_score_b > 9999999999.9999
  then
    raise exception using errcode = '22023', message = 'Scores must be finite, non-negative numeric values within the supported range';
  end if;

  if p_score_a = p_score_b then
    raise exception using errcode = '22023', message = 'Das Match benötigt einen Gewinner.';
  end if;

  select tournament_match.tournament_id
  into v_tournament_id
  from public.tournament_matches as tournament_match
  where tournament_match.id = p_match_id;

  if v_tournament_id is null then
    raise exception using errcode = 'P0002', message = 'Tournament match does not exist';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = v_tournament_id
  for update;

  select tournament_match.*
  into v_match
  from public.tournament_matches as tournament_match
  where tournament_match.id = p_match_id
    and tournament_match.tournament_id = v_tournament_id
  for update;

  if v_tournament.deleted_at is not null or v_tournament.status <> 'active' then
    raise exception using errcode = '55000', message = 'Only matches in an active, undeleted tournament can receive results';
  end if;

  if v_tournament.host_user_id <> v_actor_id and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only the tournament host or an admin may save results';
  end if;

  if v_match.stage not in ('group', 'winner_bracket', 'final') then
    raise exception using errcode = '55000', message = 'Results are not supported for this match stage yet';
  end if;

  if (v_match.stage = 'group' and v_tournament.current_phase <> 'group_stage')
    or (v_match.stage in ('winner_bracket', 'final') and v_tournament.current_phase <> 'winner_bracket')
  then
    raise exception using errcode = '55000', message = 'The match does not belong to the tournament current phase';
  end if;

  if v_match.entry_a_id is null or v_match.entry_b_id is null then
    raise exception using errcode = '55000', message = 'The match is still waiting for both participants';
  end if;

  v_new_winner_id := case when p_score_a > p_score_b then v_match.entry_a_id else v_match.entry_b_id end;

  if v_match.stage = 'group' and v_match.winner_advances_to_match_id is not null then
    raise exception using errcode = '23514', message = 'Group matches must not contain winner routing';
  end if;

  if v_match.stage <> 'group' and v_match.winner_advances_to_match_id is not null then
    select tournament_match.*
    into v_target_match
    from public.tournament_matches as tournament_match
    where tournament_match.id = v_match.winner_advances_to_match_id
      and tournament_match.tournament_id = v_tournament_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'The configured winner target match does not exist';
    end if;

    v_target_entry_id := case
      when v_match.winner_advances_to_slot = 'a' then v_target_match.entry_a_id
      when v_match.winner_advances_to_slot = 'b' then v_target_match.entry_b_id
      else null
    end;

    if v_target_entry_id is distinct from v_new_winner_id then
      if v_target_match.match_status <> 'scheduled'
        or v_target_match.score_a is not null
        or v_target_match.score_b is not null
        or v_target_match.winner_entry_id is not null
        or v_target_match.started_at is not null
      then
        raise exception using
          errcode = '55000',
          message = 'Dieses Ergebnis kann nicht geändert werden, weil bereits abhängige Matches gespielt wurden.';
      end if;

      if v_target_entry_id is not null
        and v_target_entry_id is distinct from v_match.winner_entry_id
      then
        raise exception using errcode = '55000', message = 'The winner target slot is occupied by an unrelated entry';
      end if;
    end if;
  end if;

  update public.tournament_matches
  set
    score_a = p_score_a,
    score_b = p_score_b,
    winner_entry_id = v_new_winner_id,
    match_status = 'completed'
  where id = p_match_id;

  if v_match.stage <> 'group'
    and v_match.winner_advances_to_match_id is not null
    and v_target_entry_id is distinct from v_new_winner_id
  then
    if v_match.winner_advances_to_slot = 'a' then
      update public.tournament_matches
      set entry_a_id = v_new_winner_id
      where id = v_match.winner_advances_to_match_id;
    else
      update public.tournament_matches
      set entry_b_id = v_new_winner_id
      where id = v_match.winner_advances_to_match_id;
    end if;
  end if;

  update public.tournaments
  set updated_at = pg_catalog.now()
  where id = v_tournament_id;

  return p_match_id;
end;
$$;

comment on function public.set_tournament_match_result(uuid, numeric, numeric) is
  'Atomically validates a result, derives its winner, and safely updates the configured winner target slot.';

create function public.advance_tournament_from_groups(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_group_match_count integer;
  v_qualifier_count integer;
  v_expected_qualifier_count integer;
  v_ranked_qualifier_ids uuid[];
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if p_tournament_id is null then
    raise exception using errcode = '22023', message = 'tournament_id is required';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  if v_tournament.deleted_at is not null
    or v_tournament.status <> 'active'
    or not v_tournament.group_stage_enabled
    or v_tournament.current_phase <> 'group_stage'
  then
    raise exception using errcode = '55000', message = 'Only an active group-stage tournament can advance to knockout';
  end if;

  if v_tournament.host_user_id <> v_actor_id and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only the tournament host or an admin may create the knockout phase';
  end if;

  select pg_catalog.count(*)::integer
  into v_group_match_count
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.stage = 'group'
    and not tournament_match.is_tiebreaker;

  if v_group_match_count = 0 or exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = 'group'
      and not tournament_match.is_tiebreaker
      and tournament_match.match_status <> 'completed'
  ) then
    raise exception using errcode = '55000', message = 'All regular group matches must be completed first';
  end if;

  if exists (
    select 1
    from public.get_tournament_group_standings(p_tournament_id) as standing
    where standing.qualification_tie
  ) then
    raise exception using errcode = '55000', message = 'Entscheidungsspiel erforderlich.';
  end if;

  select
    pg_catalog.array_agg(
      standing.entry_id
      order by standing.standing_rank, standing.group_sort_order, standing.group_seed, standing.entry_id
    ),
    pg_catalog.count(*)::integer
  into v_ranked_qualifier_ids, v_qualifier_count
  from public.get_tournament_group_standings(p_tournament_id) as standing
  where standing.qualified is true;

  v_expected_qualifier_count := v_tournament.group_count * v_tournament.advancers_per_group;

  if v_qualifier_count <> v_expected_qualifier_count or v_qualifier_count < 2 then
    raise exception using errcode = '55000', message = 'The expected number of group qualifiers could not be determined';
  end if;

  perform public.create_tournament_winner_bracket(p_tournament_id, v_ranked_qualifier_ids);

  update public.tournaments
  set current_phase = 'winner_bracket'
  where id = p_tournament_id;

  return p_tournament_id;
end;
$$;

comment on function public.advance_tournament_from_groups(uuid) is
  'Atomically validates completed groups, rejects qualification ties, selects qualifiers, and creates the shared winner bracket.';

create or replace function public.start_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_entry_count integer;
  v_existing_match_count integer;
  v_group_count integer;
  v_group_entry_count integer;
  v_distinct_group_entry_count integer;
  v_smallest_group_size integer;
  v_group_size integer;
  v_group record;
  v_group_entries uuid[];
  v_rotated_entries uuid[];
  v_ranked_entry_ids uuid[];
  v_schedule_size integer;
  v_group_round integer;
  v_pair_index integer;
  v_entry_a_id uuid;
  v_entry_b_id uuid;
  v_match_order integer := 0;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if p_tournament_id is null then
    raise exception using errcode = '22023', message = 'tournament_id is required';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  if v_tournament.deleted_at is not null then
    raise exception using errcode = '55000', message = 'Deleted tournaments cannot be started';
  end if;

  if v_tournament.host_user_id <> v_actor_id and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only the tournament host or an admin may start this tournament';
  end if;

  if v_tournament.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only a draft tournament can be started';
  end if;

  select pg_catalog.count(*)::integer
  into v_existing_match_count
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id;

  if v_existing_match_count <> 0 then
    raise exception using errcode = '55000', message = 'A draft tournament must not already contain matches';
  end if;

  select pg_catalog.count(*)::integer
  into v_entry_count
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id;

  if v_entry_count < 2 then
    raise exception using errcode = '22023', message = 'At least two tournament entries are required';
  end if;

  if exists (
    select 1 from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and entry.entry_type <> v_tournament.tournament_type
  ) then
    raise exception using errcode = '23514', message = 'Every entry type must match the tournament type';
  end if;

  if v_tournament.tournament_type = 'team' and exists (
    select 1
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and not exists (
        select 1 from public.tournament_team_members as member
        where member.tournament_id = p_tournament_id and member.team_entry_id = entry.id
      )
  ) then
    raise exception using errcode = '22023', message = 'Every team entry must contain at least one member';
  end if;

  if v_tournament.group_stage_enabled then
    select pg_catalog.count(*)::integer
    into v_group_count
    from public.tournament_groups as tournament_group
    where tournament_group.tournament_id = p_tournament_id;

    if v_group_count < 2 or v_tournament.group_count is null or v_tournament.group_count <> v_group_count then
      raise exception using errcode = '22023', message = 'The stored group count does not match the tournament configuration';
    end if;

    select pg_catalog.count(*)::integer, pg_catalog.count(distinct group_entry.entry_id)::integer
    into v_group_entry_count, v_distinct_group_entry_count
    from public.tournament_group_entries as group_entry
    where group_entry.tournament_id = p_tournament_id;

    if v_group_entry_count <> v_entry_count or v_distinct_group_entry_count <> v_entry_count then
      raise exception using errcode = '22023', message = 'Every tournament entry must belong to exactly one group';
    end if;

    v_smallest_group_size := null;

    for v_group in
      select tournament_group.id, tournament_group.label, tournament_group.sort_order
      from public.tournament_groups as tournament_group
      where tournament_group.tournament_id = p_tournament_id
      order by tournament_group.sort_order, tournament_group.id
    loop
      select
        pg_catalog.array_agg(group_entry.entry_id order by group_entry.group_seed, group_entry.entry_id),
        pg_catalog.count(*)::integer
      into v_group_entries, v_group_size
      from public.tournament_group_entries as group_entry
      where group_entry.tournament_id = p_tournament_id and group_entry.group_id = v_group.id;

      if v_group_size < 2 then
        raise exception using errcode = '22023', message = 'Every group must contain at least two entries';
      end if;

      if v_smallest_group_size is null or v_group_size < v_smallest_group_size then
        v_smallest_group_size := v_group_size;
      end if;

      if pg_catalog.mod(v_group_size, 2) = 1 then
        v_group_entries := pg_catalog.array_append(v_group_entries, null::uuid);
      end if;

      v_schedule_size := pg_catalog.cardinality(v_group_entries);

      for v_group_round in 1..(v_schedule_size - 1) loop
        for v_pair_index in 1..(v_schedule_size / 2) loop
          v_entry_a_id := v_group_entries[v_pair_index];
          v_entry_b_id := v_group_entries[v_schedule_size + 1 - v_pair_index];

          if v_entry_a_id is not null and v_entry_b_id is not null then
            insert into public.tournament_matches (
              tournament_id, stage, phase_label, group_id, entry_a_id, entry_b_id,
              match_status, round_number, match_order
            ) values (
              p_tournament_id, 'group', v_group.label, v_group.id, v_entry_a_id, v_entry_b_id,
              'scheduled', v_group_round, v_match_order
            );
            v_match_order := v_match_order + 1;
          end if;
        end loop;

        v_rotated_entries := array[v_group_entries[1], v_group_entries[v_schedule_size]];
        if v_schedule_size > 2 then
          v_rotated_entries := v_rotated_entries || v_group_entries[2:(v_schedule_size - 1)];
        end if;
        v_group_entries := v_rotated_entries;
      end loop;
    end loop;

    if v_tournament.advancers_per_group is null
      or v_tournament.advancers_per_group < 1
      or v_tournament.advancers_per_group >= v_smallest_group_size
    then
      raise exception using errcode = '22023', message = 'advancers_per_group must leave at least one entry eliminated in every group';
    end if;
  else
    if v_tournament.group_count is not null
      or v_tournament.advancers_per_group is not null
      or exists (select 1 from public.tournament_groups as tournament_group where tournament_group.tournament_id = p_tournament_id)
      or exists (select 1 from public.tournament_group_entries as group_entry where group_entry.tournament_id = p_tournament_id)
    then
      raise exception using errcode = '22023', message = 'Direct knockout tournaments must not contain group structure';
    end if;

    select pg_catalog.array_agg(entry.id order by pg_catalog.random(), entry.id)
    into v_ranked_entry_ids
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id and entry.entry_status = 'active';

    perform public.create_tournament_winner_bracket(p_tournament_id, v_ranked_entry_ids);
  end if;

  update public.tournaments
  set
    status = 'active',
    current_phase = case when v_tournament.group_stage_enabled then 'group_stage' else 'winner_bracket' end,
    finished_at = null
  where id = p_tournament_id;

  return p_tournament_id;
end;
$$;

comment on function public.start_tournament(uuid) is
  'Atomically validates and starts a draft tournament, using the shared winner-bracket generator for direct knockout.';

revoke all on function public.create_tournament_winner_bracket(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.get_tournament_group_standings(uuid)
  from public, anon, authenticated;
revoke all on function public.set_tournament_match_result(uuid, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.advance_tournament_from_groups(uuid)
  from public, anon, authenticated;

revoke insert, update, delete on table public.tournament_matches
  from authenticated;
grant select on table public.tournament_matches
  to authenticated;

grant execute on function public.get_tournament_group_standings(uuid)
  to authenticated;
grant execute on function public.set_tournament_match_result(uuid, numeric, numeric)
  to authenticated;
grant execute on function public.advance_tournament_from_groups(uuid)
  to authenticated;
grant execute on function public.start_tournament(uuid)
  to authenticated;

commit;
