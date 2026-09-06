begin;

alter table public.trottl_classic_sessions
  add column action_phase text not null default 'awaiting_roll',
  add column action_actor_seat smallint,
  add column action_target_seat smallint,
  add column current_trottl_seat smallint,
  add column action_payload jsonb not null default '{}'::jsonb,
  add column reaction_id uuid,
  add column reaction_start_at timestamptz,
  add column reaction_loser_seat smallint,
  add column reaction_lockout_until timestamptz;

update public.trottl_classic_sessions
set action_phase = 'rolling',
    action_actor_seat = current_turn_seat
where status = 'playing'
  and roll_phase = 'rolling';

alter table public.trottl_classic_sessions
  add constraint trottl_classic_action_phase_valid check (
    action_phase in (
      'awaiting_roll',
      'awaiting_reroll',
      'rolling',
      'awaiting_drink_ack',
      'choosing_trottl',
      'distributing_four',
      'awaiting_four_acks',
      'reaction_pending',
      'reaction_active',
      'reaction_loser_lockout',
      'reaction_loser_ack',
      'shot_ack'
    )
  ),
  add constraint trottl_classic_action_actor_valid check (
    action_actor_seat is null or action_actor_seat between 0 and 7
  ),
  add constraint trottl_classic_action_target_valid check (
    action_target_seat is null or action_target_seat between 0 and 7
  ),
  add constraint trottl_classic_trottl_seat_valid check (
    current_trottl_seat is null or current_trottl_seat between 0 and 7
  ),
  add constraint trottl_classic_reaction_loser_valid check (
    reaction_loser_seat is null or reaction_loser_seat between 0 and 7
  ),
  add constraint trottl_classic_action_payload_object check (
    pg_catalog.jsonb_typeof(action_payload) = 'object'
  );

create function public.resolve_trottl_classic_rule_locked(
  p_session_id uuid,
  p_roll_seq bigint,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.trottl_classic_sessions;
  v_phase text;
  v_target smallint;
  v_payload jsonb := '{}'::jsonb;
  v_reaction_id uuid;
  v_reaction_start_at timestamptz;
begin
  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;

  if not found
    or v_session.status <> 'playing'
    or v_session.roll_phase <> 'rolling'
    or v_session.action_phase <> 'rolling'
    or v_session.roll_seq <> p_roll_seq
    or p_now < v_session.roll_resolve_at then
    return false;
  end if;

  case v_session.roll_result
    when 1 then
      v_phase := 'awaiting_drink_ack';
      v_target := ((v_session.action_actor_seat - 1 + v_session.player_count) % v_session.player_count)::smallint;
      v_payload := pg_catalog.jsonb_build_object('kind', 'left_neighbor', 'sips', 1);
    when 2 then
      v_phase := 'awaiting_drink_ack';
      v_target := ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint;
      v_payload := pg_catalog.jsonb_build_object('kind', 'right_neighbor', 'sips', 1);
    when 3 then
      if v_session.current_trottl_seat is null
        or v_session.current_trottl_seat = v_session.action_actor_seat then
        v_phase := 'choosing_trottl';
        v_target := null;
        v_payload := pg_catalog.jsonb_build_object(
          'kind',
          case when v_session.current_trottl_seat is null then 'first_trottl' else 'replace_trottl' end
        );
      else
        v_phase := 'awaiting_drink_ack';
        v_target := v_session.current_trottl_seat;
        v_payload := pg_catalog.jsonb_build_object('kind', 'trottl_drink', 'sips', 1);
      end if;
    when 4 then
      v_phase := 'distributing_four';
      v_target := null;
      v_payload := pg_catalog.jsonb_build_object(
        'kind', 'four_sips',
        'allocations', '{}'::jsonb,
        'acks', '[]'::jsonb
      );
    when 5 then
      v_phase := 'reaction_pending';
      v_target := null;
      v_payload := pg_catalog.jsonb_build_object('kind', 'reaction', 'reactions', '{}'::jsonb);
      v_reaction_id := coalesce(v_session.reaction_id, pg_catalog.gen_random_uuid());
      v_reaction_start_at := greatest(
        coalesce(v_session.reaction_start_at, v_session.roll_started_at + pg_catalog.make_interval(secs => 4.0)),
        p_now + pg_catalog.make_interval(secs => 1.4)
      );
    when 6 then
      v_phase := 'shot_ack';
      v_target := v_session.action_actor_seat;
      v_payload := pg_catalog.jsonb_build_object('kind', 'shot');
    else
      raise exception using errcode = '23514', message = 'TROTTL_CLASSIC_INVALID_ROLL_RESULT';
  end case;

  update public.trottl_classic_sessions as session
  set roll_phase = 'idle',
      roll_started_at = null,
      roll_resolve_at = null,
      action_phase = v_phase,
      action_target_seat = v_target,
      action_payload = v_payload,
      reaction_id = v_reaction_id,
      reaction_start_at = v_reaction_start_at,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;

  return true;
end;
$$;

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

  select session.room_slot into v_room_slot
  from public.trottl_classic_sessions as session
  where session.id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.* into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;

  if v_session.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_IN_LOBBY';
  end if;
  if v_session.host_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'Only the host may start';
  end if;

  select pg_catalog.count(*)::smallint into v_member_count
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
      roll_resolve_at = null,
      action_phase = 'awaiting_roll',
      action_actor_seat = null,
      action_target_seat = null,
      current_trottl_seat = null,
      action_payload = '{}'::jsonb,
      reaction_id = null,
      reaction_start_at = null,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;

  return p_session_id;
end;
$$;

create or replace function public.roll_trottl_classic_die(p_session_id uuid)
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

  select session.* into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_PLAYING';
  end if;

  if v_session.roll_phase = 'rolling' and v_now >= v_session.roll_resolve_at then
    perform public.resolve_trottl_classic_rule_locked(p_session_id, v_session.roll_seq, v_now);
    select session.* into v_session
    from public.trottl_classic_sessions as session
    where session.id = p_session_id
    for update;
  end if;

  select player.seat_index into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;
  if v_member_seat <> v_session.current_turn_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_YOUR_TURN';
  end if;
  if v_session.roll_phase <> 'idle'
    or v_session.action_phase not in ('awaiting_roll', 'awaiting_reroll') then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ACTION_REQUIRED';
  end if;

  v_result := (1 + pg_catalog.floor(pg_catalog.random() * 6))::smallint;
  update public.trottl_classic_sessions as session
  set roll_seq = session.roll_seq + 1,
      roll_result = v_result,
      roll_phase = 'rolling',
      roll_started_at = v_now,
      roll_resolve_at = v_now + pg_catalog.make_interval(secs => 2.6),
      action_phase = 'rolling',
      action_actor_seat = session.current_turn_seat,
      action_target_seat = null,
      action_payload = '{}'::jsonb,
      reaction_id = case when v_result = 5 then pg_catalog.gen_random_uuid() else null end,
      reaction_start_at = case when v_result = 5 then v_now + pg_catalog.make_interval(secs => 4.0) else null end,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id
  returning session.roll_seq into v_roll_seq;

  return v_roll_seq;
end;
$$;

create or replace function public.resolve_trottl_classic_roll(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = p_session_id and player.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;
  return public.resolve_trottl_classic_rule_locked(
    p_session_id,
    p_roll_seq,
    pg_catalog.clock_timestamp()
  );
end;
$$;

create function public.ack_trottl_classic_drink(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_allocated integer;
  v_required integer;
  v_ack_count integer;
  v_acks jsonb;
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
  select player.seat_index into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;

  if v_session.action_phase = 'awaiting_drink_ack' then
    if v_member_seat <> v_session.action_target_seat then
      raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_TARGET';
    end if;
    update public.trottl_classic_sessions as session
    set current_turn_seat = ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint,
        action_phase = 'awaiting_roll',
        action_actor_seat = null,
        action_target_seat = null,
        action_payload = '{}'::jsonb
    where session.id = p_session_id;
    return true;
  end if;

  if v_session.action_phase <> 'awaiting_four_acks' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  v_allocated := coalesce((v_session.action_payload->'allocations'->>v_member_seat::text)::integer, 0);
  if v_allocated < 1 then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_TARGET';
  end if;
  if coalesce(v_session.action_payload->'acks', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_member_seat) then
    return false;
  end if;

  v_acks := coalesce(v_session.action_payload->'acks', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_member_seat);
  select pg_catalog.count(*)::integer into v_required
  from pg_catalog.jsonb_each_text(v_session.action_payload->'allocations') as allocation
  where allocation.value::integer > 0;
  select pg_catalog.jsonb_array_length(v_acks) into v_ack_count;

  if v_ack_count >= v_required then
    update public.trottl_classic_sessions as session
    set current_turn_seat = ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint,
        action_phase = 'awaiting_roll',
        action_actor_seat = null,
        action_target_seat = null,
        action_payload = '{}'::jsonb
    where session.id = p_session_id;
  else
    update public.trottl_classic_sessions as session
    set action_payload = pg_catalog.jsonb_set(session.action_payload, '{acks}', v_acks, true)
    where session.id = p_session_id;
  end if;
  return true;
end;
$$;

create function public.choose_trottl_classic_trottl(
  p_session_id uuid,
  p_roll_seq bigint,
  p_target_seat smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
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
  if v_session.action_phase <> 'choosing_trottl' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  select player.seat_index into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found or v_member_seat <> v_session.action_actor_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_ACTOR';
  end if;
  if p_target_seat = v_member_seat or not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = p_session_id and player.seat_index = p_target_seat
  ) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_INVALID_TARGET';
  end if;

  update public.trottl_classic_sessions as session
  set current_trottl_seat = p_target_seat,
      current_turn_seat = ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint,
      action_phase = 'awaiting_roll',
      action_actor_seat = null,
      action_target_seat = null,
      action_payload = '{}'::jsonb
  where session.id = p_session_id;
  return true;
end;
$$;

create function public.assign_trottl_classic_four(
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
  if p_target_seat = v_member_seat or not exists (
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

create function public.reset_trottl_classic_four(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.roll_seq <> p_roll_seq then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if v_session.status <> 'playing' or v_session.action_phase <> 'distributing_four'
    or v_member_seat is distinct from v_session.action_actor_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_ACTOR';
  end if;
  update public.trottl_classic_sessions as session
  set action_payload = pg_catalog.jsonb_build_object(
    'kind', 'four_sips', 'allocations', '{}'::jsonb, 'acks', '[]'::jsonb
  ) where session.id = p_session_id;
  return true;
end;
$$;

create function public.confirm_trottl_classic_four(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_total integer;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.roll_seq <> p_roll_seq then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if v_session.status <> 'playing' or v_session.action_phase <> 'distributing_four'
    or v_member_seat is distinct from v_session.action_actor_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_ACTOR';
  end if;
  select coalesce(pg_catalog.sum(allocation.value::integer), 0)::integer into v_total
  from pg_catalog.jsonb_each_text(v_session.action_payload->'allocations') as allocation;
  if v_total <> 4 then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_FOUR_REQUIRES_EXACTLY_FOUR';
  end if;
  update public.trottl_classic_sessions as session
  set action_phase = 'awaiting_four_acks',
      action_payload = pg_catalog.jsonb_set(session.action_payload, '{acks}', '[]'::jsonb, true)
  where session.id = p_session_id;
  return true;
end;
$$;

create function public.react_trottl_classic(
  p_session_id uuid,
  p_roll_seq bigint,
  p_reaction_id uuid,
  p_client_reacted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reactions jsonb;
  v_reaction_count integer;
  v_loser_seat smallint;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq
    or v_session.reaction_id is distinct from p_reaction_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if v_session.action_phase not in ('reaction_pending', 'reaction_active') then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  if p_client_reacted_at is null then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_TIME_IMPLAUSIBLE';
  end if;
  if v_now < v_session.reaction_start_at or p_client_reacted_at < v_session.reaction_start_at then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_TOO_EARLY';
  end if;
  if p_client_reacted_at > v_now + pg_catalog.make_interval(secs => 0.25)
    or p_client_reacted_at < v_now - pg_catalog.make_interval(secs => 10.0) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_TIME_IMPLAUSIBLE';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  if coalesce(v_session.action_payload->'reactions', '{}'::jsonb) ? v_member_seat::text then return false; end if;

  v_reactions := pg_catalog.jsonb_set(
    coalesce(v_session.action_payload, '{}'::jsonb),
    array['reactions', v_member_seat::text],
    pg_catalog.to_jsonb(p_client_reacted_at::text),
    true
  );
  select pg_catalog.count(*)::integer into v_reaction_count
  from pg_catalog.jsonb_object_keys(v_reactions->'reactions');

  if v_reaction_count >= v_session.player_count - 1 then
    select player.seat_index into v_loser_seat
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and not ((v_reactions->'reactions') ? player.seat_index::text)
    order by player.seat_index
    limit 1;
    update public.trottl_classic_sessions as session
    set action_phase = 'reaction_loser_lockout',
        action_payload = v_reactions,
        reaction_loser_seat = v_loser_seat,
        reaction_lockout_until = v_now + pg_catalog.make_interval(secs => 0.8)
    where session.id = p_session_id;
  else
    update public.trottl_classic_sessions as session
    set action_phase = 'reaction_active', action_payload = v_reactions
    where session.id = p_session_id;
  end if;
  return true;
end;
$$;

create function public.ack_trottl_classic_reaction_loser(
  p_session_id uuid,
  p_roll_seq bigint,
  p_reaction_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.roll_seq <> p_roll_seq
    or v_session.reaction_id is distinct from p_reaction_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if v_session.action_phase not in ('reaction_loser_lockout', 'reaction_loser_ack')
    or pg_catalog.clock_timestamp() < v_session.reaction_lockout_until then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_REACTION_LOCKOUT';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found or v_member_seat is distinct from v_session.reaction_loser_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_TARGET';
  end if;
  update public.trottl_classic_sessions as session
  set current_turn_seat = ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint,
      action_phase = 'awaiting_roll',
      action_actor_seat = null,
      action_target_seat = null,
      action_payload = '{}'::jsonb,
      reaction_id = null,
      reaction_start_at = null,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;
  return true;
end;
$$;

create function public.ack_trottl_classic_shot(p_session_id uuid, p_roll_seq bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if v_session.action_phase <> 'shot_ack' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found or v_member_seat <> v_session.action_actor_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_ACTOR';
  end if;
  update public.trottl_classic_sessions as session
  set action_phase = 'awaiting_reroll',
      action_actor_seat = null,
      action_target_seat = null,
      action_payload = '{}'::jsonb
  where session.id = p_session_id;
  return true;
end;
$$;

create function public.get_trottl_classic_server_time(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = p_session_id and player.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;
  return pg_catalog.clock_timestamp();
end;
$$;

revoke all on function public.resolve_trottl_classic_rule_locked(uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.ack_trottl_classic_drink(uuid, bigint) from public, anon, authenticated;
revoke all on function public.choose_trottl_classic_trottl(uuid, bigint, smallint) from public, anon, authenticated;
revoke all on function public.assign_trottl_classic_four(uuid, bigint, smallint) from public, anon, authenticated;
revoke all on function public.reset_trottl_classic_four(uuid, bigint) from public, anon, authenticated;
revoke all on function public.confirm_trottl_classic_four(uuid, bigint) from public, anon, authenticated;
revoke all on function public.react_trottl_classic(uuid, bigint, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.ack_trottl_classic_reaction_loser(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.ack_trottl_classic_shot(uuid, bigint) from public, anon, authenticated;
revoke all on function public.get_trottl_classic_server_time(uuid) from public, anon, authenticated;
grant execute on function public.ack_trottl_classic_drink(uuid, bigint) to authenticated;
grant execute on function public.choose_trottl_classic_trottl(uuid, bigint, smallint) to authenticated;
grant execute on function public.assign_trottl_classic_four(uuid, bigint, smallint) to authenticated;
grant execute on function public.reset_trottl_classic_four(uuid, bigint) to authenticated;
grant execute on function public.confirm_trottl_classic_four(uuid, bigint) to authenticated;
grant execute on function public.react_trottl_classic(uuid, bigint, uuid, timestamptz) to authenticated;
grant execute on function public.ack_trottl_classic_reaction_loser(uuid, bigint, uuid) to authenticated;
grant execute on function public.ack_trottl_classic_shot(uuid, bigint) to authenticated;
grant execute on function public.get_trottl_classic_server_time(uuid) to authenticated;

commit;
