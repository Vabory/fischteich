begin;

alter table public.tournament_matches
  add column tiebreaker_round integer;

comment on column public.tournament_matches.tiebreaker_round is
  'Sequential decision round within a group; null for every regular match.';

update public.tournament_matches
set tiebreaker_round = 1
where is_tiebreaker;

alter table public.tournament_matches
  add constraint tournament_matches_tiebreaker_round_consistent check (
    (is_tiebreaker and tiebreaker_round is not null and tiebreaker_round > 0)
    or (not is_tiebreaker and tiebreaker_round is null)
  );

create index tournament_matches_group_tiebreaker_round_idx
  on public.tournament_matches (tournament_id, group_id, tiebreaker_round, match_order)
  where is_tiebreaker;

create function public.prepare_tiebreaker_result_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_tiebreaker
    and old.match_status = 'completed'
    and (
      new.score_a is distinct from old.score_a
      or new.score_b is distinct from old.score_b
      or new.winner_entry_id is distinct from old.winner_entry_id
    )
  then
    if exists (
      select 1
      from public.tournament_matches as later_match
      where later_match.tournament_id = old.tournament_id
        and later_match.group_id = old.group_id
        and later_match.is_tiebreaker
        and later_match.tiebreaker_round > old.tiebreaker_round
        and (
          later_match.match_status <> 'scheduled'
          or later_match.score_a is not null
          or later_match.score_b is not null
          or later_match.winner_entry_id is not null
          or later_match.started_at is not null
        )
    ) then
      raise exception using
        errcode = '55000',
        message = 'Dieses Ergebnis kann nicht geändert werden, weil bereits abhängige Matches gespielt wurden.';
    end if;

    delete from public.tournament_matches as later_match
    where later_match.tournament_id = old.tournament_id
      and later_match.group_id = old.group_id
      and later_match.is_tiebreaker
      and later_match.tiebreaker_round > old.tiebreaker_round;
  end if;

  return new;
end;
$$;

create trigger prepare_tiebreaker_result_correction
before update of score_a, score_b, winner_entry_id on public.tournament_matches
for each row
execute function public.prepare_tiebreaker_result_correction();

comment on function public.prepare_tiebreaker_result_correction() is
  'Invalidates unplayed dependent decision rounds and protects already played rounds when an earlier result changes.';

create function public.get_tournament_regular_group_standings(p_tournament_id uuid)
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

comment on function public.get_tournament_regular_group_standings(uuid) is
  'Internal regular-match standings. Tiebreaker matches never alter these sporting statistics.';

create function public.get_tournament_group_tiebreaker_resolution(p_tournament_id uuid)
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
              (round_stats.score_for - round_stats.score_against) desc,
              round_stats.score_for desc
          )::integer as round_rank
        from round_stats
      ), ranked as (
        select
          ranked_base.*,
          pg_catalog.count(*) over (
            partition by ranked_base.wins,
              (ranked_base.score_for - ranked_base.score_against),
              ranked_base.score_for
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
  'Resolves only qualification-boundary ties through sequential, separately ranked tiebreaker mini round robins.';

drop function public.advance_tournament_from_groups(uuid);
drop function public.get_tournament_group_standings(uuid);

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
  qualified boolean,
  final_qualification_rank integer,
  tiebreaker_status text,
  tiebreaker_round integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    regular.group_id,
    regular.group_label,
    regular.group_sort_order,
    regular.entry_id,
    regular.display_name,
    regular.group_seed,
    regular.played,
    regular.wins,
    regular.losses,
    regular.score_for,
    regular.score_against,
    regular.score_difference,
    regular.standing_rank,
    regular.display_position,
    regular.is_tied,
    regular.tied_rank,
    case
      when resolution.resolved_entry_id is not null then resolution.qualified is null
      else regular.qualification_tie
    end as qualification_tie,
    case
      when resolution.resolved_entry_id is not null then resolution.qualified
      else regular.qualified
    end as qualified,
    case
      when resolution.resolved_entry_id is not null then resolution.final_qualification_rank
      else regular.standing_rank
    end as final_qualification_rank,
    coalesce(resolution.tiebreaker_status, 'none') as tiebreaker_status,
    resolution.tiebreaker_round
  from public.get_tournament_regular_group_standings(p_tournament_id) as regular
  left join public.get_tournament_group_tiebreaker_resolution(p_tournament_id) as resolution
    on resolution.resolved_group_id = regular.group_id
    and resolution.resolved_entry_id = regular.entry_id
  order by regular.group_sort_order, regular.display_position;
$$;

comment on function public.get_tournament_group_standings(uuid) is
  'Regular standings plus computed multi-round tiebreaker qualification state; regular statistics remain unchanged.';

create function public.create_group_tiebreaker(
  p_tournament_id uuid,
  p_group_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_group public.tournament_groups%rowtype;
  v_candidate_entry_ids uuid[];
  v_candidate_count integer;
  v_existing_round integer;
  v_next_round integer;
  v_round_number integer;
  v_match_order integer;
  v_entry_a_index integer;
  v_entry_b_index integer;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if p_tournament_id is null or p_group_id is null then
    raise exception using errcode = '22023', message = 'tournament_id and group_id are required';
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
    raise exception using errcode = '55000', message = 'Only an active group-stage tournament can create tiebreakers';
  end if;

  if v_tournament.host_user_id <> v_actor_id and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only the tournament host or an admin may create tiebreakers';
  end if;

  select tournament_group.*
  into v_group
  from public.tournament_groups as tournament_group
  where tournament_group.id = p_group_id
    and tournament_group.tournament_id = p_tournament_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament group does not exist';
  end if;

  if not exists (
    select 1 from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.group_id = p_group_id
      and tournament_match.stage = 'group'
      and not tournament_match.is_tiebreaker
  ) or exists (
    select 1 from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.group_id = p_group_id
      and tournament_match.stage = 'group'
      and not tournament_match.is_tiebreaker
      and tournament_match.match_status <> 'completed'
  ) then
    raise exception using errcode = '55000', message = 'All regular matches in the group must be completed first';
  end if;

  select pg_catalog.max(tournament_match.tiebreaker_round)
  into v_existing_round
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.group_id = p_group_id
    and tournament_match.is_tiebreaker;

  if v_existing_round is not null and exists (
    select 1 from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.group_id = p_group_id
      and tournament_match.is_tiebreaker
      and tournament_match.tiebreaker_round = v_existing_round
      and tournament_match.match_status <> 'completed'
  ) then
    return v_existing_round;
  end if;

  select
    pg_catalog.array_agg(resolution.resolved_entry_id order by group_entry.group_seed, resolution.resolved_entry_id),
    pg_catalog.count(*)::integer
  into v_candidate_entry_ids, v_candidate_count
  from public.get_tournament_group_tiebreaker_resolution(p_tournament_id) as resolution
  join public.tournament_group_entries as group_entry
    on group_entry.tournament_id = p_tournament_id
    and group_entry.group_id = p_group_id
    and group_entry.entry_id = resolution.resolved_entry_id
  where resolution.resolved_group_id = p_group_id
    and resolution.qualified is null
    and resolution.tiebreaker_status = 'unresolved';

  if v_candidate_count < 2 then
    raise exception using errcode = '55000', message = 'No unresolved qualification-relevant tie exists for this group';
  end if;

  v_next_round := coalesce(v_existing_round, 0) + 1;

  if exists (
    select 1 from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.group_id = p_group_id
      and tournament_match.is_tiebreaker
      and tournament_match.tiebreaker_round = v_next_round
  ) then
    return v_next_round;
  end if;

  select coalesce(pg_catalog.max(tournament_match.round_number), 0) + 1
  into v_round_number
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.group_id = p_group_id
    and tournament_match.stage = 'group';

  select coalesce(pg_catalog.max(tournament_match.match_order), -1) + 1
  into v_match_order
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id;

  for v_entry_a_index in 1..(v_candidate_count - 1) loop
    for v_entry_b_index in (v_entry_a_index + 1)..v_candidate_count loop
      insert into public.tournament_matches (
        tournament_id, stage, phase_label, group_id,
        entry_a_id, entry_b_id, match_status,
        round_number, match_order, is_tiebreaker, tiebreaker_round
      ) values (
        p_tournament_id, 'group', v_group.label || ' Entscheidung ' || v_next_round::text, p_group_id,
        v_candidate_entry_ids[v_entry_a_index], v_candidate_entry_ids[v_entry_b_index], 'scheduled',
        v_round_number, v_match_order, true, v_next_round
      );
      v_match_order := v_match_order + 1;
    end loop;
  end loop;

  update public.tournaments
  set updated_at = pg_catalog.now()
  where id = p_tournament_id;

  return v_next_round;
end;
$$;

comment on function public.create_group_tiebreaker(uuid, uuid) is
  'Atomically creates one match for a two-entry boundary tie or a mini round robin for all unresolved tied entries.';

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
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.is_tiebreaker
      and tournament_match.match_status <> 'completed'
  ) or exists (
    select 1
    from public.get_tournament_group_standings(p_tournament_id) as standing
    where standing.qualified is null
      or standing.tiebreaker_status in ('unresolved', 'in_progress')
  ) then
    raise exception using errcode = '55000', message = 'Entscheidungsspiel erforderlich.';
  end if;

  select
    pg_catalog.array_agg(
      standing.entry_id
      order by standing.final_qualification_rank, standing.group_sort_order, standing.group_seed, standing.entry_id
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
  'Advances only after regular groups and every qualification-relevant tiebreaker are fully resolved.';

revoke all on function public.get_tournament_regular_group_standings(uuid)
  from public, anon, authenticated;
revoke all on function public.get_tournament_group_tiebreaker_resolution(uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_tiebreaker_result_correction()
  from public, anon, authenticated;
revoke all on function public.get_tournament_group_standings(uuid)
  from public, anon, authenticated;
revoke all on function public.create_group_tiebreaker(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.advance_tournament_from_groups(uuid)
  from public, anon, authenticated;

grant execute on function public.get_tournament_group_standings(uuid)
  to authenticated;
grant execute on function public.create_group_tiebreaker(uuid, uuid)
  to authenticated;
grant execute on function public.advance_tournament_from_groups(uuid)
  to authenticated;

commit;
