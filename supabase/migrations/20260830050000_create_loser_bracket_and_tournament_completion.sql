begin;

create function public.create_tournament_loser_bracket(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_entry_count integer;
  v_bracket_size integer := 1;
  v_winner_round_count integer;
  v_loser_round_count integer;
  v_loser_match_count integer;
  v_round integer;
  v_match_order integer;
  v_target_round integer;
  v_target_order integer;
  v_target_slot text;
  v_target_match_id uuid;
  v_grand_final_id uuid;
  v_winner_final_id uuid;
  v_bypass_match record;
  v_incoming record;
  v_incoming_count integer;
begin
  if p_tournament_id is null then
    raise exception using errcode = '22023', message = 'tournament_id is required';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  if not v_tournament.loser_bracket_enabled then
    return;
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and (
        tournament_match.stage = 'loser_bracket'
        or tournament_match.phase_label in ('Grand Final', 'Grand Final Reset')
      )
  ) then
    raise exception using errcode = '55000', message = 'A loser bracket already exists for this tournament';
  end if;

  select pg_catalog.count(*)::integer
  into v_entry_count
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.entry_status = 'active'
    and entry.seed is not null;

  if v_entry_count < 2 then
    raise exception using errcode = '55000', message = 'At least two seeded knockout entries are required';
  end if;

  while v_bracket_size < v_entry_count loop
    v_bracket_size := v_bracket_size * 2;
  end loop;

  select pg_catalog.max(tournament_match.round_number)::integer
  into v_winner_round_count
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.stage in ('winner_bracket', 'final');

  select tournament_match.id
  into v_winner_final_id
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.stage = 'final'
    and tournament_match.round_number = v_winner_round_count
  order by tournament_match.match_order
  limit 1;

  if v_winner_round_count is null or v_winner_final_id is null then
    raise exception using errcode = '55000', message = 'The winner bracket must exist before its loser bracket is created';
  end if;

  update public.tournament_matches
  set
    stage = 'winner_bracket',
    phase_label = 'Winner Bracket Finale',
    winner_advances_to_match_id = null,
    winner_advances_to_slot = null,
    loser_advances_to_match_id = null,
    loser_advances_to_slot = null
  where id = v_winner_final_id;

  v_loser_round_count := (2 * v_winner_round_count) - 2;
  v_loser_match_count := v_bracket_size / 4;

  if v_loser_round_count > 0 then
    for v_round in 1..v_loser_round_count loop
      for v_match_order in 0..(v_loser_match_count - 1) loop
        insert into public.tournament_matches (
          tournament_id, stage, phase_label, match_status, round_number, match_order
        ) values (
          p_tournament_id, 'loser_bracket', 'Loser Bracket Runde ' || v_round::text,
          'scheduled', v_round, v_match_order
        );
      end loop;

      if pg_catalog.mod(v_round, 2) = 0 then
        v_loser_match_count := v_loser_match_count / 2;
      end if;
    end loop;
  end if;

  insert into public.tournament_matches (
    tournament_id, stage, phase_label, match_status, round_number, match_order
  ) values (
    p_tournament_id, 'final', 'Grand Final', 'scheduled', v_winner_round_count + 1, 0
  )
  returning id into v_grand_final_id;

  update public.tournament_matches
  set winner_advances_to_match_id = v_grand_final_id,
      winner_advances_to_slot = 'a'
  where id = v_winner_final_id;

  if v_loser_round_count = 0 then
    update public.tournament_matches
    set loser_advances_to_match_id = v_grand_final_id,
        loser_advances_to_slot = 'b'
    where id = v_winner_final_id;
  else
    select tournament_match.id
    into v_target_match_id
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = 'loser_bracket'
      and tournament_match.round_number = v_loser_round_count
      and tournament_match.match_order = 0;

    update public.tournament_matches
    set loser_advances_to_match_id = v_target_match_id,
        loser_advances_to_slot = 'b'
    where id = v_winner_final_id;
  end if;

  for v_round in 1..(v_winner_round_count - 1) loop
    for v_match_order in
      select tournament_match.match_order
      from public.tournament_matches as tournament_match
      where tournament_match.tournament_id = p_tournament_id
        and tournament_match.stage = 'winner_bracket'
        and tournament_match.round_number = v_round
      order by tournament_match.match_order
    loop
      if v_round = 1 then
        v_target_round := 1;
        v_target_order := v_match_order / 2;
        v_target_slot := case when pg_catalog.mod(v_match_order, 2) = 0 then 'a' else 'b' end;
      else
        v_target_round := (2 * v_round) - 2;
        v_target_order := v_match_order;
        v_target_slot := 'b';
      end if;

      select tournament_match.id
      into v_target_match_id
      from public.tournament_matches as tournament_match
      where tournament_match.tournament_id = p_tournament_id
        and tournament_match.stage = 'loser_bracket'
        and tournament_match.round_number = v_target_round
        and tournament_match.match_order = v_target_order;

      if v_target_match_id is null then
        raise exception using errcode = '55000', message = 'A winner-bracket loser route could not be created';
      end if;

      update public.tournament_matches
      set loser_advances_to_match_id = v_target_match_id,
          loser_advances_to_slot = v_target_slot
      where tournament_id = p_tournament_id
        and stage = 'winner_bracket'
        and round_number = v_round
        and match_order = v_match_order;
    end loop;
  end loop;

  if v_loser_round_count > 0 then
    for v_round in 1..v_loser_round_count loop
      for v_match_order in
        select tournament_match.match_order
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.stage = 'loser_bracket'
          and tournament_match.round_number = v_round
        order by tournament_match.match_order
      loop
        if v_round = v_loser_round_count then
          v_target_match_id := v_grand_final_id;
          v_target_slot := 'b';
        else
          v_target_round := v_round + 1;
          if pg_catalog.mod(v_round, 2) = 1 then
            v_target_order := v_match_order;
            v_target_slot := 'a';
          else
            v_target_order := v_match_order / 2;
            v_target_slot := case when pg_catalog.mod(v_match_order, 2) = 0 then 'a' else 'b' end;
          end if;

          select tournament_match.id
          into v_target_match_id
          from public.tournament_matches as tournament_match
          where tournament_match.tournament_id = p_tournament_id
            and tournament_match.stage = 'loser_bracket'
            and tournament_match.round_number = v_target_round
            and tournament_match.match_order = v_target_order;
        end if;

        update public.tournament_matches
        set winner_advances_to_match_id = v_target_match_id,
            winner_advances_to_slot = v_target_slot
        where tournament_id = p_tournament_id
          and stage = 'loser_bracket'
          and round_number = v_round
          and match_order = v_match_order;
      end loop;
    end loop;
  end if;

  loop
    select tournament_match.*
    into v_bypass_match
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = 'loser_bracket'
      and tournament_match.match_status = 'scheduled'
      and (
        select pg_catalog.count(*)
        from (
          select source_match.id
          from public.tournament_matches as source_match
          where source_match.tournament_id = p_tournament_id
            and source_match.match_status <> 'cancelled'
            and source_match.winner_advances_to_match_id = tournament_match.id
          union all
          select source_match.id
          from public.tournament_matches as source_match
          where source_match.tournament_id = p_tournament_id
            and source_match.match_status <> 'cancelled'
            and source_match.loser_advances_to_match_id = tournament_match.id
        ) as incoming_source
      ) < 2
    order by tournament_match.round_number, tournament_match.match_order
    limit 1;

    exit when not found;

    select pg_catalog.count(*)::integer
    into v_incoming_count
    from (
      select source_match.id
      from public.tournament_matches as source_match
      where source_match.tournament_id = p_tournament_id
        and source_match.match_status <> 'cancelled'
        and source_match.winner_advances_to_match_id = v_bypass_match.id
      union all
      select source_match.id
      from public.tournament_matches as source_match
      where source_match.tournament_id = p_tournament_id
        and source_match.match_status <> 'cancelled'
        and source_match.loser_advances_to_match_id = v_bypass_match.id
    ) as incoming_source;

    if v_incoming_count = 1 then
      select incoming_source.source_id, incoming_source.route_kind
      into v_incoming
      from (
        select source_match.id as source_id, 'winner'::text as route_kind
        from public.tournament_matches as source_match
        where source_match.tournament_id = p_tournament_id
          and source_match.match_status <> 'cancelled'
          and source_match.winner_advances_to_match_id = v_bypass_match.id
        union all
        select source_match.id, 'loser'::text
        from public.tournament_matches as source_match
        where source_match.tournament_id = p_tournament_id
          and source_match.match_status <> 'cancelled'
          and source_match.loser_advances_to_match_id = v_bypass_match.id
      ) as incoming_source
      limit 1;

      if v_incoming.route_kind = 'winner' then
        update public.tournament_matches
        set winner_advances_to_match_id = v_bypass_match.winner_advances_to_match_id,
            winner_advances_to_slot = v_bypass_match.winner_advances_to_slot
        where id = v_incoming.source_id;
      else
        update public.tournament_matches
        set loser_advances_to_match_id = v_bypass_match.winner_advances_to_match_id,
            loser_advances_to_slot = v_bypass_match.winner_advances_to_slot
        where id = v_incoming.source_id;
      end if;
    end if;

    update public.tournament_matches
    set match_status = 'cancelled',
        winner_advances_to_match_id = null,
        winner_advances_to_slot = null,
        loser_advances_to_match_id = null,
        loser_advances_to_slot = null
    where id = v_bypass_match.id;
  end loop;
end;
$$;

comment on function public.create_tournament_loser_bracket(uuid) is
  'Builds and compacts the loser bracket around real winner-bracket matches, then connects both champions to the Grand Final.';

create function public.create_loser_bracket_after_knockout_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.loser_bracket_enabled
    and new.current_phase = 'winner_bracket'
    and (
      old.current_phase is distinct from new.current_phase
      or old.status is distinct from new.status
    )
  then
    perform public.create_tournament_loser_bracket(new.id);
  end if;

  return null;
end;
$$;

create trigger create_loser_bracket_after_knockout_start
after update of status, current_phase on public.tournaments
for each row
execute function public.create_loser_bracket_after_knockout_start();

create function public.route_tournament_match_entry(
  p_tournament_id uuid,
  p_target_match_id uuid,
  p_target_slot text,
  p_old_entry_id uuid,
  p_new_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_match public.tournament_matches%rowtype;
  v_current_entry_id uuid;
begin
  if p_target_match_id is null then
    return;
  end if;

  select tournament_match.*
  into v_target_match
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.id = p_target_match_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'The configured target match does not exist';
  end if;

  v_current_entry_id := case
    when p_target_slot = 'a' then v_target_match.entry_a_id
    when p_target_slot = 'b' then v_target_match.entry_b_id
    else null
  end;

  if p_target_slot not in ('a', 'b') then
    raise exception using errcode = '23514', message = 'The configured target slot is invalid';
  end if;

  if v_current_entry_id is not distinct from p_new_entry_id then
    return;
  end if;

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

  if v_current_entry_id is not null
    and v_current_entry_id is distinct from p_old_entry_id
  then
    raise exception using errcode = '55000', message = 'The target slot is occupied by an unrelated entry';
  end if;

  if p_target_slot = 'a' then
    update public.tournament_matches
    set entry_a_id = p_new_entry_id
    where id = p_target_match_id;
  else
    update public.tournament_matches
    set entry_b_id = p_new_entry_id
    where id = p_target_match_id;
  end if;
end;
$$;

create function public.finish_tournament_with_champion(
  p_tournament_id uuid,
  p_champion_entry_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  select entry.display_name_snapshot
  into v_display_name
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.id = p_champion_entry_id;

  if v_display_name is null then
    raise exception using errcode = '23503', message = 'The champion entry does not belong to the tournament';
  end if;

  insert into public.tournament_placements (
    tournament_id, entry_id, placement, display_name_snapshot, stats_snapshot
  ) values (
    p_tournament_id, p_champion_entry_id, 1, v_display_name,
    pg_catalog.jsonb_build_object('source', p_source)
  )
  on conflict (tournament_id, placement) do update
  set entry_id = excluded.entry_id,
      display_name_snapshot = excluded.display_name_snapshot,
      stats_snapshot = excluded.stats_snapshot,
      awarded_at = pg_catalog.now();

  update public.tournaments
  set status = 'finished',
      current_phase = 'finished'
  where id = p_tournament_id;
end;
$$;

create or replace function public.set_tournament_match_result(
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
  v_reset_match public.tournament_matches%rowtype;
  v_new_winner_id uuid;
  v_new_loser_id uuid;
  v_old_loser_id uuid;
  v_grand_final public.tournament_matches%rowtype;
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

  if v_match.stage not in ('group', 'winner_bracket', 'loser_bracket', 'final') then
    raise exception using errcode = '55000', message = 'Results are not supported for this match stage';
  end if;

  if (v_match.stage = 'group' and v_tournament.current_phase <> 'group_stage')
    or (
      v_match.stage in ('winner_bracket', 'loser_bracket', 'final')
      and v_tournament.current_phase not in ('winner_bracket', 'grand_final', 'grand_final_reset')
    )
  then
    raise exception using errcode = '55000', message = 'The match does not belong to the tournament current phase';
  end if;

  if v_match.match_status = 'cancelled'
    or v_match.entry_a_id is null
    or v_match.entry_b_id is null
  then
    raise exception using errcode = '55000', message = 'The match is still waiting for both participants';
  end if;

  v_new_winner_id := case when p_score_a > p_score_b then v_match.entry_a_id else v_match.entry_b_id end;
  v_new_loser_id := case when p_score_a > p_score_b then v_match.entry_b_id else v_match.entry_a_id end;
  v_old_loser_id := case
    when v_match.winner_entry_id = v_match.entry_a_id then v_match.entry_b_id
    when v_match.winner_entry_id = v_match.entry_b_id then v_match.entry_a_id
    else null
  end;

  if v_match.stage = 'group'
    and (
      v_match.winner_advances_to_match_id is not null
      or v_match.loser_advances_to_match_id is not null
    )
  then
    raise exception using errcode = '23514', message = 'Group matches must not contain bracket routing';
  end if;

  if v_match.phase_label = 'Grand Final'
    and v_match.winner_entry_id is distinct from v_new_winner_id
  then
    select tournament_match.*
    into v_reset_match
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = v_tournament_id
      and tournament_match.phase_label = 'Grand Final Reset'
    for update;

    if found then
      if v_reset_match.match_status <> 'scheduled'
        or v_reset_match.score_a is not null
        or v_reset_match.score_b is not null
        or v_reset_match.winner_entry_id is not null
        or v_reset_match.started_at is not null
      then
        raise exception using
          errcode = '55000',
          message = 'Dieses Ergebnis kann nicht geändert werden, weil bereits abhängige Matches gespielt wurden.';
      end if;

      if v_new_winner_id = v_match.entry_a_id then
        delete from public.tournament_matches where id = v_reset_match.id;
      end if;
    end if;
  end if;

  perform public.route_tournament_match_entry(
    v_tournament_id,
    v_match.winner_advances_to_match_id,
    v_match.winner_advances_to_slot,
    v_match.winner_entry_id,
    v_new_winner_id
  );

  perform public.route_tournament_match_entry(
    v_tournament_id,
    v_match.loser_advances_to_match_id,
    v_match.loser_advances_to_slot,
    v_old_loser_id,
    v_new_loser_id
  );

  update public.tournament_matches
  set score_a = p_score_a,
      score_b = p_score_b,
      winner_entry_id = v_new_winner_id,
      match_status = 'completed'
  where id = p_match_id;

  if v_match.phase_label = 'Grand Final' then
    if v_new_winner_id = v_match.entry_a_id then
      perform public.finish_tournament_with_champion(v_tournament_id, v_new_winner_id, 'grand_final');
    else
      if not exists (
        select 1
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = v_tournament_id
          and tournament_match.phase_label = 'Grand Final Reset'
      ) then
        insert into public.tournament_matches (
          tournament_id, stage, phase_label, entry_a_id, entry_b_id,
          match_status, round_number, match_order
        ) values (
          v_tournament_id, 'final', 'Grand Final Reset',
          v_match.entry_a_id, v_match.entry_b_id,
          'scheduled', v_match.round_number + 1, 0
        );
      end if;

      update public.tournaments
      set current_phase = 'grand_final_reset',
          updated_at = pg_catalog.now()
      where id = v_tournament_id;
    end if;
  elsif v_match.phase_label = 'Grand Final Reset' then
    perform public.finish_tournament_with_champion(v_tournament_id, v_new_winner_id, 'grand_final_reset');
  elsif v_match.stage = 'final' and not v_tournament.loser_bracket_enabled then
    perform public.finish_tournament_with_champion(v_tournament_id, v_new_winner_id, 'single_elimination_final');
  else
    select tournament_match.*
    into v_grand_final
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = v_tournament_id
      and tournament_match.phase_label = 'Grand Final';

    if found and v_grand_final.entry_a_id is not null and v_grand_final.entry_b_id is not null then
      update public.tournaments
      set current_phase = 'grand_final',
          updated_at = pg_catalog.now()
      where id = v_tournament_id;
    else
      update public.tournaments
      set updated_at = pg_catalog.now()
      where id = v_tournament_id;
    end if;
  end if;

  return p_match_id;
end;
$$;

comment on function public.set_tournament_match_result(uuid, numeric, numeric) is
  'Atomically saves results, routes winners and losers, protects dependent matches, creates a required Grand Final Reset, and finishes the tournament.';

revoke all on function public.create_tournament_loser_bracket(uuid)
  from public, anon, authenticated;
revoke all on function public.create_loser_bracket_after_knockout_start()
  from public, anon, authenticated;
revoke all on function public.route_tournament_match_entry(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_tournament_with_champion(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_tournament_match_result(uuid, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.set_tournament_match_result(uuid, numeric, numeric)
  to authenticated;

commit;
