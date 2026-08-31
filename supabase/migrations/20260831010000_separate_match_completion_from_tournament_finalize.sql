begin;

create function public.get_tournament_ready_champion(p_tournament_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_grand_final public.tournament_matches%rowtype;
  v_reset_match public.tournament_matches%rowtype;
  v_champion_entry_id uuid;
begin
  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id;

  if not found
    or v_tournament.deleted_at is not null
    or v_tournament.status <> 'active'
  then
    return null;
  end if;

  if not v_tournament.loser_bracket_enabled then
    select tournament_match.winner_entry_id
    into v_champion_entry_id
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = p_tournament_id
      and tournament_match.stage = 'final'
      and tournament_match.phase_label = 'Finale'
      and tournament_match.match_status = 'completed'
      and tournament_match.winner_entry_id is not null
    order by tournament_match.round_number desc, tournament_match.match_order desc
    limit 1;

    return v_champion_entry_id;
  end if;

  select tournament_match.*
  into v_grand_final
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.phase_label = 'Grand Final'
  limit 1;

  if not found
    or v_grand_final.match_status <> 'completed'
    or v_grand_final.winner_entry_id is null
  then
    return null;
  end if;

  select tournament_match.*
  into v_reset_match
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.phase_label = 'Grand Final Reset'
  limit 1;

  if v_grand_final.winner_entry_id = v_grand_final.entry_a_id then
    if found then return null; end if;
    return v_grand_final.winner_entry_id;
  end if;

  if v_grand_final.winner_entry_id <> v_grand_final.entry_b_id
    or not found
    or v_reset_match.match_status <> 'completed'
    or v_reset_match.winner_entry_id is null
    or v_reset_match.entry_a_id is distinct from v_grand_final.entry_a_id
    or v_reset_match.entry_b_id is distinct from v_grand_final.entry_b_id
  then
    return null;
  end if;

  return v_reset_match.winner_entry_id;
end;
$$;

comment on function public.get_tournament_ready_champion(uuid) is
  'Internal derived ready-to-finish state. Returns the unique sporting champion only while an undeleted tournament remains active and no required Grand Final Reset is outstanding.';

create function public.can_finalize_tournament(p_tournament_id uuid)
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
      and tournament.deleted_at is null
      and tournament.status = 'active'
      and (
        tournament.host_user_id = (select auth.uid())
        or public.is_tournament_admin()
      )
      and public.get_tournament_ready_champion(tournament.id) is not null
  );
$$;

comment on function public.can_finalize_tournament(uuid) is
  'Returns true only for the host or an admin when the active tournament has a unique champion and needs no further reset match.';

create function public.finalize_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_champion_entry_id uuid;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  if v_tournament.host_user_id <> v_actor_id and not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only the tournament host or an admin may finalize this tournament';
  end if;

  if v_tournament.deleted_at is not null then
    raise exception using errcode = '55000', message = 'A deleted tournament cannot be finalized';
  end if;

  if v_tournament.status = 'finished' then
    return p_tournament_id;
  end if;

  if v_tournament.status <> 'active' then
    raise exception using errcode = '55000', message = 'Only an active tournament can be finalized';
  end if;

  v_champion_entry_id := public.get_tournament_ready_champion(p_tournament_id);
  if v_champion_entry_id is null then
    raise exception using errcode = '55000', message = 'The tournament is not ready to be finalized';
  end if;

  perform public.finish_tournament_with_champion(
    p_tournament_id,
    v_champion_entry_id,
    case when v_tournament.loser_bracket_enabled then 'explicit_double_elimination_finalize' else 'explicit_single_elimination_finalize' end
  );

  return p_tournament_id;
end;
$$;

comment on function public.finalize_tournament(uuid) is
  'Idempotent host/admin boundary that atomically derives the champion, marks the tournament finished, and delegates all placement/stat snapshot generation to the existing completion helper.';

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
    or p_score_a < 0 or p_score_b < 0
    or p_score_a > 9999999999.9999 or p_score_b > 9999999999.9999
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
    and (v_match.winner_advances_to_match_id is not null or v_match.loser_advances_to_match_id is not null)
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
        raise exception using errcode = '55000', message = 'Dieses Ergebnis kann nicht geändert werden, weil bereits abhängige Matches gespielt wurden.';
      end if;

      if v_new_winner_id = v_match.entry_a_id then
        delete from public.tournament_matches where id = v_reset_match.id;
      end if;
    end if;
  end if;

  perform public.route_tournament_match_entry(
    v_tournament_id, v_match.winner_advances_to_match_id, v_match.winner_advances_to_slot,
    v_match.winner_entry_id, v_new_winner_id
  );
  perform public.route_tournament_match_entry(
    v_tournament_id, v_match.loser_advances_to_match_id, v_match.loser_advances_to_slot,
    v_old_loser_id, v_new_loser_id
  );

  update public.tournament_matches
  set score_a = p_score_a,
      score_b = p_score_b,
      winner_entry_id = v_new_winner_id,
      match_status = 'completed'
  where id = p_match_id;

  if v_match.phase_label = 'Grand Final' then
    if v_new_winner_id = v_match.entry_a_id then
      update public.tournaments
      set current_phase = 'grand_final', updated_at = pg_catalog.now()
      where id = v_tournament_id;
    else
      if not exists (
        select 1 from public.tournament_matches as tournament_match
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
      set current_phase = 'grand_final_reset', updated_at = pg_catalog.now()
      where id = v_tournament_id;
    end if;
  elsif v_match.phase_label = 'Grand Final Reset' then
    update public.tournaments
    set current_phase = 'grand_final_reset', updated_at = pg_catalog.now()
    where id = v_tournament_id;
  elsif v_match.stage = 'final' and not v_tournament.loser_bracket_enabled then
    update public.tournaments
    set current_phase = 'winner_bracket', updated_at = pg_catalog.now()
    where id = v_tournament_id;
  else
    select tournament_match.*
    into v_grand_final
    from public.tournament_matches as tournament_match
    where tournament_match.tournament_id = v_tournament_id
      and tournament_match.phase_label = 'Grand Final';

    if found and v_grand_final.entry_a_id is not null and v_grand_final.entry_b_id is not null then
      update public.tournaments
      set current_phase = 'grand_final', updated_at = pg_catalog.now()
      where id = v_tournament_id;
    else
      update public.tournaments set updated_at = pg_catalog.now() where id = v_tournament_id;
    end if;
  end if;

  return p_match_id;
end;
$$;

comment on function public.set_tournament_match_result(uuid, numeric, numeric) is
  'Atomically saves and safely reroutes match results, including Grand Final Reset creation/removal, while deliberately leaving tournament finalization to finalize_tournament.';

revoke all on function public.get_tournament_ready_champion(uuid) from public, anon, authenticated;
revoke all on function public.can_finalize_tournament(uuid) from public, anon, authenticated;
revoke all on function public.finalize_tournament(uuid) from public, anon, authenticated;
revoke all on function public.set_tournament_match_result(uuid, numeric, numeric) from public, anon, authenticated;

grant execute on function public.can_finalize_tournament(uuid) to authenticated;
grant execute on function public.finalize_tournament(uuid) to authenticated;
grant execute on function public.set_tournament_match_result(uuid, numeric, numeric) to authenticated;

commit;
