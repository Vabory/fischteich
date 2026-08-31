begin;

create table public.tournament_admin_audit (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  tournament_title_snapshot text not null,
  match_id uuid,
  admin_user_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  constraint tournament_admin_audit_title_valid check (
    tournament_title_snapshot = pg_catalog.btrim(tournament_title_snapshot)
    and pg_catalog.char_length(tournament_title_snapshot) between 1 and 120
  ),
  constraint tournament_admin_audit_action_valid check (
    action in ('match_result_corrected', 'tournament_restored', 'tournament_hard_deleted')
  ),
  constraint tournament_admin_audit_values_objects check (
    (old_value is null or pg_catalog.jsonb_typeof(old_value) = 'object')
    and (new_value is null or pg_catalog.jsonb_typeof(new_value) = 'object')
  )
);

comment on table public.tournament_admin_audit is
  'Append-only security audit for administrative tournament corrections and lifecycle actions. Tournament and admin IDs are immutable snapshots without cascading foreign keys so hard-delete evidence survives.';

create index tournament_admin_audit_tournament_created_idx
  on public.tournament_admin_audit (tournament_id, created_at desc);
create index tournament_admin_audit_admin_created_idx
  on public.tournament_admin_audit (admin_user_id, created_at desc);

alter table public.tournament_admin_audit enable row level security;
revoke all on table public.tournament_admin_audit from public, anon, authenticated;

create or replace function public.restore_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
begin
  if v_actor_id is null or not public.is_tournament_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only an admin may restore a tournament';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament not found';
  end if;

  if v_tournament.deleted_at is not null then
    update public.tournaments as tournament
    set deleted_at = null
    where tournament.id = p_tournament_id;

    insert into public.tournament_admin_audit (
      tournament_id, tournament_title_snapshot, admin_user_id, action, old_value, new_value
    ) values (
      v_tournament.id,
      v_tournament.title,
      v_actor_id,
      'tournament_restored',
      pg_catalog.jsonb_build_object(
        'deleted_at', v_tournament.deleted_at,
        'deleted_by', v_tournament.deleted_by,
        'deleted_by_display_name_snapshot', v_tournament.deleted_by_display_name_snapshot,
        'delete_reason', v_tournament.delete_reason
      ),
      pg_catalog.jsonb_build_object('deleted_at', null)
    );
  end if;

  return p_tournament_id;
end;
$$;

comment on function public.restore_tournament(uuid) is
  'Idempotently restores a soft-deleted tournament for admins and records the state-changing restore in the persistent admin audit.';

create function public.admin_set_tournament_match_result(
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
  v_tournament public.tournaments%rowtype;
  v_match public.tournament_matches%rowtype;
  v_new_winner_id uuid;
  v_new_loser_id uuid;
  v_old_loser_id uuid;
  v_winner_changed boolean;
  v_champion_entry_id uuid;
begin
  if v_actor_id is null or not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only an admin may correct tournament results';
  end if;

  if p_match_id is null then
    raise exception using errcode = '22023', message = 'match_id is required';
  end if;

  if p_score_a is null or p_score_b is null
    or p_score_a::text in ('NaN', 'Infinity', '-Infinity')
    or p_score_b::text in ('NaN', 'Infinity', '-Infinity')
    or p_score_a < 0 or p_score_b < 0
    or p_score_a > 9999999999.9999 or p_score_b > 9999999999.9999
  then
    raise exception using errcode = '22023', message = 'Scores must be finite, non-negative numeric values within the supported range';
  end if;

  if p_score_a = p_score_b then
    raise exception using errcode = '22023', message = 'Das Match benötigt einen Gewinner.';
  end if;

  select tournament_match.*
  into v_match
  from public.tournament_matches as tournament_match
  where tournament_match.id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament match does not exist';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = v_match.tournament_id
  for update;

  if v_tournament.deleted_at is not null
    or v_tournament.status not in ('active', 'finished')
  then
    raise exception using errcode = '55000', message = 'Only visible active or finished tournaments can be corrected';
  end if;

  if v_match.match_status <> 'completed'
    or v_match.entry_a_id is null
    or v_match.entry_b_id is null
    or v_match.winner_entry_id is null
  then
    raise exception using errcode = '55000', message = 'Only completed matches can be corrected';
  end if;

  v_new_winner_id := case when p_score_a > p_score_b then v_match.entry_a_id else v_match.entry_b_id end;
  v_new_loser_id := case when p_score_a > p_score_b then v_match.entry_b_id else v_match.entry_a_id end;
  v_old_loser_id := case
    when v_match.winner_entry_id = v_match.entry_a_id then v_match.entry_b_id
    else v_match.entry_a_id
  end;
  v_winner_changed := v_match.winner_entry_id is distinct from v_new_winner_id;

  if v_winner_changed and v_tournament.status = 'finished' then
    raise exception using
      errcode = '55000',
      message = 'Diese Korrektur würde bereits gespielte Folgematches beeinflussen.';
  end if;

  if v_winner_changed and v_match.stage = 'group' and (
    v_tournament.current_phase <> 'group_stage'
    or exists (
      select 1
      from public.tournament_matches as related_match
      where related_match.tournament_id = v_match.tournament_id
        and related_match.group_id = v_match.group_id
        and related_match.is_tiebreaker
        and related_match.id <> v_match.id
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Diese Korrektur würde bereits gespielte Folgematches beeinflussen.';
  end if;

  if v_winner_changed and (
    v_match.phase_label in ('Grand Final', 'Grand Final Reset')
    or (v_match.stage = 'final' and v_tournament.loser_bracket_enabled)
  ) then
    raise exception using
      errcode = '55000',
      message = 'Diese Korrektur würde die abgeschlossene Finalstruktur verändern und ist in Version 1 gesperrt.';
  end if;

  if v_winner_changed then
    perform public.route_tournament_match_entry(
      v_match.tournament_id,
      v_match.winner_advances_to_match_id,
      v_match.winner_advances_to_slot,
      v_match.winner_entry_id,
      v_new_winner_id
    );
    perform public.route_tournament_match_entry(
      v_match.tournament_id,
      v_match.loser_advances_to_match_id,
      v_match.loser_advances_to_slot,
      v_old_loser_id,
      v_new_loser_id
    );
  end if;

  update public.tournament_matches as tournament_match
  set score_a = p_score_a,
      score_b = p_score_b,
      winner_entry_id = v_new_winner_id,
      match_status = 'completed'
  where tournament_match.id = p_match_id;

  if v_tournament.status = 'finished' then
    select placement.entry_id
    into v_champion_entry_id
    from public.tournament_placements as placement
    where placement.tournament_id = v_tournament.id
      and placement.placement = 1
    limit 1;

    if v_champion_entry_id is null then
      select deciding_match.winner_entry_id
      into v_champion_entry_id
      from public.tournament_matches as deciding_match
      where deciding_match.tournament_id = v_tournament.id
        and deciding_match.stage = 'final'
        and deciding_match.match_status = 'completed'
        and deciding_match.winner_entry_id is not null
      order by
        case deciding_match.phase_label when 'Grand Final Reset' then 0 when 'Grand Final' then 1 else 2 end,
        deciding_match.round_number desc,
        deciding_match.completed_at desc nulls last
      limit 1;
    end if;

    if v_champion_entry_id is null then
      raise exception using errcode = 'P0002', message = 'No completed deciding final was found';
    end if;

    perform public.rebuild_tournament_placement_snapshots(
      v_tournament.id,
      v_champion_entry_id,
      'admin_correction'
    );
  else
    update public.tournaments as tournament
    set updated_at = pg_catalog.now()
    where tournament.id = v_tournament.id;
  end if;

  insert into public.tournament_admin_audit (
    tournament_id, tournament_title_snapshot, match_id, admin_user_id,
    action, old_value, new_value
  ) values (
    v_tournament.id,
    v_tournament.title,
    v_match.id,
    v_actor_id,
    'match_result_corrected',
    pg_catalog.jsonb_build_object(
      'score_a', v_match.score_a,
      'score_b', v_match.score_b,
      'winner_entry_id', v_match.winner_entry_id
    ),
    pg_catalog.jsonb_build_object(
      'score_a', p_score_a,
      'score_b', p_score_b,
      'winner_entry_id', v_new_winner_id
    )
  );

  return p_match_id;
end;
$$;

comment on function public.admin_set_tournament_match_result(uuid, numeric, numeric) is
  'Admin-only atomic correction for completed matches. It reroutes safe active-bracket winner changes, blocks played dependencies and structural final changes, refreshes finished snapshots, and audits every success.';

create function public.hard_delete_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
begin
  if v_actor_id is null or not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'Only an admin may permanently delete a tournament';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament not found';
  end if;

  if v_tournament.deleted_at is null then
    raise exception using errcode = '55000', message = 'Only a soft-deleted tournament may be permanently deleted';
  end if;

  insert into public.tournament_admin_audit (
    tournament_id, tournament_title_snapshot, admin_user_id, action, old_value, new_value
  ) values (
    v_tournament.id,
    v_tournament.title,
    v_actor_id,
    'tournament_hard_deleted',
    pg_catalog.jsonb_build_object(
      'status', v_tournament.status,
      'current_phase', v_tournament.current_phase,
      'deleted_at', v_tournament.deleted_at,
      'deleted_by', v_tournament.deleted_by
    ),
    null
  );

  delete from public.tournaments as tournament
  where tournament.id = p_tournament_id;

  return p_tournament_id;
end;
$$;

comment on function public.hard_delete_tournament(uuid) is
  'Admin-only permanent deletion of an already soft-deleted tournament. Existing aggregate-root cascades remove dependent tournament data while the independent audit row survives.';

revoke all on function public.admin_set_tournament_match_result(uuid, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.hard_delete_tournament(uuid)
  from public, anon, authenticated;
revoke all on function public.restore_tournament(uuid)
  from public, anon, authenticated;

grant execute on function public.admin_set_tournament_match_result(uuid, numeric, numeric)
  to authenticated;
grant execute on function public.hard_delete_tournament(uuid)
  to authenticated;
grant execute on function public.restore_tournament(uuid)
  to authenticated;

commit;
