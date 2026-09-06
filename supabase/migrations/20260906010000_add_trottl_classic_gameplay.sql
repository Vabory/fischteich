begin;

alter table public.trottl_classic_sessions
  add column current_turn_seat smallint,
  add column roll_seq bigint not null default 0,
  add column roll_result smallint,
  add column roll_phase text not null default 'idle',
  add column roll_started_at timestamptz,
  add column roll_resolve_at timestamptz;

update public.trottl_classic_sessions
set current_turn_seat = 0
where status = 'playing';

alter table public.trottl_classic_sessions
  add constraint trottl_classic_current_turn_valid
    check (current_turn_seat is null or current_turn_seat between 0 and 7),
  add constraint trottl_classic_roll_seq_valid
    check (roll_seq >= 0),
  add constraint trottl_classic_roll_result_valid
    check (roll_result is null or roll_result between 1 and 6),
  add constraint trottl_classic_roll_phase_valid
    check (roll_phase in ('idle', 'rolling')),
  add constraint trottl_classic_roll_state_valid
    check (
      (
        roll_phase = 'idle'
        and roll_started_at is null
        and roll_resolve_at is null
      )
      or (
        roll_phase = 'rolling'
        and roll_result between 1 and 6
        and roll_started_at is not null
        and roll_resolve_at > roll_started_at
      )
    );

create or replace function public.start_trottl_classic_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_slot smallint;
  v_session public.trottl_classic_sessions;
  v_member_count smallint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select session.room_slot
  into v_room_slot
  from public.trottl_classic_sessions as session
  where session.id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;

  if v_session.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_IN_LOBBY';
  end if;
  if v_session.host_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'Only the host may start';
  end if;

  select pg_catalog.count(*)::smallint
  into v_member_count
  from public.trottl_classic_players as player
  where player.session_id = p_session_id;
  if v_member_count < 3 or v_member_count > 8 then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_INVALID_PLAYER_COUNT';
  end if;

  update public.trottl_classic_sessions as session
  set status = 'playing',
      player_count = v_member_count,
      started_at = pg_catalog.clock_timestamp(),
      current_turn_seat = 0,
      roll_seq = 0,
      roll_result = null,
      roll_phase = 'idle',
      roll_started_at = null,
      roll_resolve_at = null
  where session.id = p_session_id;

  return p_session_id;
end;
$$;

create function public.roll_trottl_classic_die(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_result smallint;
  v_roll_seq bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_PLAYING';
  end if;

  -- Lazily resolve an expired roll under the same row lock. This lets the next
  -- player recover progress even if every browser slept through the timer.
  if v_session.roll_phase = 'rolling' and v_now >= v_session.roll_resolve_at then
    update public.trottl_classic_sessions as session
    set current_turn_seat = ((session.current_turn_seat + 1) % session.player_count)::smallint,
        roll_phase = 'idle',
        roll_started_at = null,
        roll_resolve_at = null
    where session.id = p_session_id
    returning * into v_session;
  end if;

  select player.seat_index
  into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = v_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;
  if v_member_seat <> v_session.current_turn_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_YOUR_TURN';
  end if;
  if v_session.roll_phase <> 'idle' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROLL_IN_PROGRESS';
  end if;

  -- Generate exactly once for this accepted roll, then persist the value used
  -- by every Realtime client.
  v_result := (1 + pg_catalog.floor(pg_catalog.random() * 6))::smallint;
  update public.trottl_classic_sessions as session
  set roll_seq = session.roll_seq + 1,
      roll_result = v_result,
      roll_phase = 'rolling',
      roll_started_at = v_now,
      roll_resolve_at = v_now + pg_catalog.make_interval(secs => 2.6)
  where session.id = p_session_id
  returning session.roll_seq into v_roll_seq;

  return v_roll_seq;
end;
$$;

create function public.resolve_trottl_classic_roll(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not exists (
    select 1
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and player.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;

  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'playing'
    or v_session.roll_phase <> 'rolling'
    or v_session.roll_seq <> p_roll_seq
    or pg_catalog.clock_timestamp() < v_session.roll_resolve_at then
    return false;
  end if;

  update public.trottl_classic_sessions as session
  set current_turn_seat = ((session.current_turn_seat + 1) % session.player_count)::smallint,
      roll_phase = 'idle',
      roll_started_at = null,
      roll_resolve_at = null
  where session.id = p_session_id;
  return true;
end;
$$;

revoke all on function public.roll_trottl_classic_die(uuid) from public, anon, authenticated;
revoke all on function public.resolve_trottl_classic_roll(uuid, bigint) from public, anon, authenticated;
grant execute on function public.roll_trottl_classic_die(uuid) to authenticated;
grant execute on function public.resolve_trottl_classic_roll(uuid, bigint) to authenticated;

commit;
