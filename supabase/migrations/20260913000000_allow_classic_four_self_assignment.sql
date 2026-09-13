-- Rule 4 only: the actor is a valid recipient; ACK handling stays recipient-based.
create or replace function public.assign_trottl_classic_four(
  p_session_id uuid,
  p_roll_seq bigint,
  p_target_seat smallint
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_total integer;
  v_target_total integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select session.* into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if v_session.action_phase <> 'distributing_four' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  select player.seat_index into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found or v_member_seat <> v_session.action_actor_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_ACTOR';
  end if;
  if not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = p_session_id and player.seat_index = p_target_seat
  ) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_INVALID_TARGET';
  end if;

  select coalesce(pg_catalog.sum(allocation.value::integer), 0)::integer into v_total
  from pg_catalog.jsonb_each_text(v_session.action_payload->'allocations') as allocation;
  if v_total >= 4 then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_FOUR_COMPLETE';
  end if;
  v_target_total := coalesce((v_session.action_payload->'allocations'->>p_target_seat::text)::integer, 0) + 1;
  update public.trottl_classic_sessions as session
  set action_payload = pg_catalog.jsonb_set(
    session.action_payload,
    array['allocations', p_target_seat::text],
    pg_catalog.to_jsonb(v_target_total),
    true
  )
  where session.id = p_session_id;
  return v_target_total::smallint;
end;
$$;
