begin;

-- Classic keeps stable global seat ids. These helpers traverse only seats that
-- currently exist, so gaps left by a departure are never treated as players.
create function public.next_trottl_classic_active_seat(
  p_session_id uuid,
  p_anchor_seat smallint
)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select player.seat_index
      from public.trottl_classic_players as player
      where player.session_id = p_session_id
        and player.seat_index > p_anchor_seat
      order by player.seat_index
      limit 1
    ),
    (
      select player.seat_index
      from public.trottl_classic_players as player
      where player.session_id = p_session_id
      order by player.seat_index
      limit 1
    )
  );
$$;

create function public.previous_trottl_classic_active_seat(
  p_session_id uuid,
  p_anchor_seat smallint
)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select player.seat_index
      from public.trottl_classic_players as player
      where player.session_id = p_session_id
        and player.seat_index < p_anchor_seat
      order by player.seat_index desc
      limit 1
    ),
    (
      select player.seat_index
      from public.trottl_classic_players as player
      where player.session_id = p_session_id
      order by player.seat_index desc
      limit 1
    )
  );
$$;

create function public.finish_trottl_classic_action_locked(
  p_session_id uuid,
  p_anchor_seat smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trottl_classic_sessions as session
  set current_turn_seat = public.next_trottl_classic_active_seat(p_session_id, p_anchor_seat),
      roll_phase = 'idle',
      roll_started_at = null,
      roll_resolve_at = null,
      action_phase = 'awaiting_roll',
      action_actor_seat = null,
      action_target_seat = null,
      action_payload = '{}'::jsonb,
      reaction_id = null,
      reaction_start_at = null,
      reaction_fallback_at = null,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;
end;
$$;

-- All explicit and stale gameplay deletes converge here while the caller owns
-- the room advisory lock and session row lock.
create function public.reconcile_trottl_classic_membership_locked(
  p_session_id uuid,
  p_departing_user_id uuid,
  p_departing_seat smallint,
  p_now timestamptz
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.trottl_classic_sessions;
  v_remaining_count smallint;
  v_next_host uuid;
  v_payload jsonb;
  v_allocations jsonb;
  v_acks jsonb;
  v_penalty_seats jsonb;
  v_penalty_acks jsonb;
  v_required integer;
  v_ack_count integer;
begin
  select session.* into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;

  select pg_catalog.count(*)::smallint into v_remaining_count
  from public.trottl_classic_players as player
  where player.session_id = p_session_id;

  if v_remaining_count = 0 then
    update public.trottl_classic_sessions as session
    set status = 'finished', player_count = 0, finished_at = p_now,
        current_turn_seat = null, roll_seq = 0, roll_result = null,
        roll_phase = 'idle', roll_started_at = null, roll_resolve_at = null,
        action_phase = 'awaiting_roll', action_actor_seat = null,
        action_target_seat = null, current_trottl_seat = null,
        action_payload = '{}'::jsonb, reaction_id = null,
        reaction_start_at = null, reaction_fallback_at = null,
        reaction_loser_seat = null, reaction_lockout_until = null
    where session.id = p_session_id;
    return 0;
  end if;

  select player.user_id into v_next_host
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and (v_session.host_user_id <> p_departing_user_id or player.user_id = v_session.host_user_id)
  order by (player.user_id = v_session.host_user_id) desc,
           player.seat_index, player.joined_at, player.user_id
  limit 1;
  if v_next_host is null then
    select player.user_id into v_next_host
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
    order by player.seat_index, player.joined_at, player.user_id
    limit 1;
  end if;

  if v_session.status = 'playing' and v_remaining_count = 1 then
    update public.trottl_classic_players as player
    set is_ready = false
    where player.session_id = p_session_id;
    update public.trottl_classic_sessions as session
    set status = 'lobby', host_user_id = v_next_host,
        player_count = 1, started_at = null, finished_at = null,
        current_turn_seat = null, roll_seq = 0, roll_result = null,
        roll_phase = 'idle', roll_started_at = null, roll_resolve_at = null,
        action_phase = 'awaiting_roll', action_actor_seat = null,
        action_target_seat = null, current_trottl_seat = null,
        action_payload = '{}'::jsonb, reaction_id = null,
        reaction_start_at = null, reaction_fallback_at = null,
        reaction_loser_seat = null, reaction_lockout_until = null
    where session.id = p_session_id;
    return 1;
  end if;

  update public.trottl_classic_sessions as session
  set player_count = v_remaining_count, host_user_id = v_next_host
  where session.id = p_session_id;

  if v_session.status <> 'playing' then return v_remaining_count; end if;

  if v_session.current_trottl_seat = p_departing_seat then
    update public.trottl_classic_sessions as session
    set current_trottl_seat = (
      select player.seat_index
      from public.trottl_classic_players as player
      where player.session_id = p_session_id
      order by pg_catalog.random()
      limit 1
    )
    where session.id = p_session_id;
  end if;

  if v_session.current_turn_seat = p_departing_seat
    or v_session.action_actor_seat = p_departing_seat
    or (v_session.action_phase = 'awaiting_drink_ack' and v_session.action_target_seat = p_departing_seat)
    or (v_session.action_phase in ('shot_ack', 'awaiting_reroll') and v_session.action_actor_seat = p_departing_seat) then
    perform public.finish_trottl_classic_action_locked(p_session_id, p_departing_seat);
    return v_remaining_count;
  end if;

  if v_session.action_phase in ('distributing_four', 'awaiting_four_acks') then
    v_allocations := coalesce(v_session.action_payload->'allocations', '{}'::jsonb) - p_departing_seat::text;
    select coalesce(pg_catalog.jsonb_agg(value order by ordinal), '[]'::jsonb) into v_acks
    from pg_catalog.jsonb_array_elements(coalesce(v_session.action_payload->'acks', '[]'::jsonb))
      with ordinality as item(value, ordinal)
    where value <> pg_catalog.to_jsonb(p_departing_seat);
    v_payload := pg_catalog.jsonb_set(v_session.action_payload, '{allocations}', v_allocations, true);
    v_payload := pg_catalog.jsonb_set(v_payload, '{acks}', v_acks, true);
    if v_session.action_phase = 'awaiting_four_acks' then
      select pg_catalog.count(*)::integer into v_required
      from pg_catalog.jsonb_each_text(v_allocations) as allocation
      where allocation.value::integer > 0;
      v_ack_count := pg_catalog.jsonb_array_length(v_acks);
      if v_ack_count >= v_required then
        perform public.finish_trottl_classic_action_locked(p_session_id, v_session.action_actor_seat);
        return v_remaining_count;
      end if;
    end if;
    update public.trottl_classic_sessions as session set action_payload = v_payload
    where session.id = p_session_id;
  end if;

  if v_session.action_phase in ('reaction_pending', 'reaction_active', 'reaction_loser_lockout', 'reaction_loser_ack')
    or (v_session.action_phase = 'rolling' and v_session.roll_result = 5) then
    v_payload := pg_catalog.jsonb_set(
      v_session.action_payload,
      '{players}',
      coalesce(v_session.action_payload->'players', '{}'::jsonb) - p_departing_seat::text,
      true
    );
    select coalesce(pg_catalog.jsonb_agg(value order by ordinal), '[]'::jsonb) into v_penalty_seats
    from pg_catalog.jsonb_array_elements(coalesce(v_payload->'penalty_seats', '[]'::jsonb))
      with ordinality as item(value, ordinal)
    where value <> pg_catalog.to_jsonb(p_departing_seat);
    select coalesce(pg_catalog.jsonb_agg(value order by ordinal), '[]'::jsonb) into v_penalty_acks
    from pg_catalog.jsonb_array_elements(coalesce(v_payload->'penalty_acks', '[]'::jsonb))
      with ordinality as item(value, ordinal)
    where value <> pg_catalog.to_jsonb(p_departing_seat);
    v_payload := pg_catalog.jsonb_set(v_payload, '{penalty_seats}', v_penalty_seats, true);
    v_payload := pg_catalog.jsonb_set(v_payload, '{penalty_acks}', v_penalty_acks, true);
    update public.trottl_classic_sessions as session
    set action_payload = v_payload,
        reaction_loser_seat = case
          when session.reaction_loser_seat = p_departing_seat
            and pg_catalog.jsonb_array_length(v_penalty_seats) = 1
            then (v_penalty_seats->>0)::smallint
          when session.reaction_loser_seat = p_departing_seat then null
          else session.reaction_loser_seat
        end
    where session.id = p_session_id;
    if v_session.action_phase in ('reaction_pending', 'reaction_active') then
      perform public.refresh_trottl_classic_personal_reaction_locked(p_session_id, p_now);
    elsif pg_catalog.jsonb_array_length(v_penalty_seats) = 0
      or pg_catalog.jsonb_array_length(v_penalty_acks) >= pg_catalog.jsonb_array_length(v_penalty_seats) then
      perform public.finish_trottl_classic_action_locked(p_session_id, v_session.action_actor_seat);
    end if;
  end if;

  return v_remaining_count;
end;
$$;

create or replace function public.cleanup_trottl_classic_lobby_locked(p_session_id uuid, p_now timestamptz)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.trottl_classic_sessions;
  v_stale record;
  v_remaining_count smallint;
begin
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  if v_session.status not in ('lobby', 'playing') then return v_session.player_count; end if;

  for v_stale in
    delete from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and p_now > player.last_seen_at + pg_catalog.make_interval(secs => 120)
    returning player.user_id, player.seat_index
  loop
    v_remaining_count := public.reconcile_trottl_classic_membership_locked(
      p_session_id, v_stale.user_id, v_stale.seat_index, p_now
    );
  end loop;
  if v_remaining_count is null then
    select pg_catalog.count(*)::smallint into v_remaining_count
    from public.trottl_classic_players as player where player.session_id = p_session_id;
  end if;
  return v_remaining_count;
end;
$$;

create or replace function public.heartbeat_trottl_classic_lobby(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid(); v_room_slot smallint; v_status text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.room_slot into v_room_slot from public.trottl_classic_sessions as session where session.id = p_session_id;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.status into v_status from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  if v_status not in ('lobby', 'playing') then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_ACTIVE'; end if;
  update public.trottl_classic_players as player set last_seen_at = v_now
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER'; end if;
  return v_now;
end;
$$;

create or replace function public.cleanup_trottl_classic_lobby(p_session_id uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid(); v_room_slot smallint; v_status text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.room_slot into v_room_slot from public.trottl_classic_sessions as session where session.id = p_session_id;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.status into v_status from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  if v_status not in ('lobby', 'playing') then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_ACTIVE'; end if;
  update public.trottl_classic_players as player set last_seen_at = v_now
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER'; end if;
  return public.cleanup_trottl_classic_lobby_locked(p_session_id, v_now);
end;
$$;

create or replace function public.leave_trottl_classic_session(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid(); v_room_slot smallint; v_status text;
  v_departing_seat smallint; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 337733));
  select session.room_slot into v_room_slot from public.trottl_classic_sessions as session where session.id = p_session_id;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.status into v_status from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  delete from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id
  returning player.seat_index into v_departing_seat;
  if not found then return v_status; end if;
  perform public.reconcile_trottl_classic_membership_locked(p_session_id, v_user_id, v_departing_seat, v_now);
  select session.status into v_status from public.trottl_classic_sessions as session where session.id = p_session_id;
  return v_status;
end;
$$;

create or replace function public.join_trottl_classic_room(p_room_slot smallint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid(); v_display_name text; v_profile_avatar_id text;
  v_join_avatar_id text; v_session public.trottl_classic_sessions;
  v_existing_session_id uuid; v_existing_room_slot smallint;
  v_remaining_count smallint; v_seat_index smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_room_slot is null or p_room_slot not in (1, 2) then raise exception using errcode = '22023', message = 'Room slot must be 1 or 2'; end if;
  select profile.display_name, profile.trottl_avatar_id into v_display_name, v_profile_avatar_id
  from public.app_profiles as profile where profile.user_id = v_user_id;
  if not found then raise exception using errcode = '23503', message = 'App profile required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 337733));

  select session.id, session.room_slot into v_existing_session_id, v_existing_room_slot
  from public.trottl_classic_players as player
  join public.trottl_classic_sessions as session on session.id = player.session_id
  where player.user_id = v_user_id and session.status in ('lobby', 'playing')
  order by session.created_at desc limit 1;
  if found then
    if v_existing_room_slot <> p_room_slot then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ALREADY_IN_OTHER_ROOM'; end if;
    perform pg_catalog.pg_advisory_xact_lock(337733, v_existing_room_slot::integer);
    select session.* into v_session from public.trottl_classic_sessions as session
    where session.id = v_existing_session_id and session.status in ('lobby', 'playing') for update;
    if found then
      update public.trottl_classic_players as player set last_seen_at = v_now
      where player.session_id = v_existing_session_id and player.user_id = v_user_id;
      if found then
        perform public.cleanup_trottl_classic_lobby_locked(v_existing_session_id, v_now);
        return v_existing_session_id;
      end if;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, p_room_slot::integer);
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.room_slot = p_room_slot and session.status in ('lobby', 'playing')
  order by session.created_at desc limit 1 for update;
  if found then
    v_remaining_count := public.cleanup_trottl_classic_lobby_locked(v_session.id, v_now);
    select session.* into v_session from public.trottl_classic_sessions as session where session.id = v_session.id for update;
    if v_remaining_count = 0 or v_session.status = 'finished' then
      insert into public.trottl_classic_sessions (room_slot, host_user_id) values (p_room_slot, v_user_id) returning * into v_session;
    elsif v_remaining_count >= 8 then
      raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL';
    end if;
  else
    insert into public.trottl_classic_sessions (room_slot, host_user_id) values (p_room_slot, v_user_id) returning * into v_session;
  end if;

  select candidate.seat_index::smallint into v_seat_index
  from pg_catalog.generate_series(0, 7) as candidate(seat_index)
  where not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = v_session.id and player.seat_index = candidate.seat_index
  ) order by candidate.seat_index limit 1;
  if v_seat_index is null then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL'; end if;
  if coalesce(public.is_valid_trottl_avatar_id(v_profile_avatar_id), false) then
    v_join_avatar_id := v_profile_avatar_id;
  else
    v_join_avatar_id := 'turbo-lachs';
    update public.app_profiles as profile set trottl_avatar_id = v_join_avatar_id where profile.user_id = v_user_id;
  end if;
  insert into public.trottl_classic_players (
    session_id, user_id, display_name_snapshot, seat_index, avatar_id, is_ready, last_seen_at
  ) values (v_session.id, v_user_id, v_display_name, v_seat_index, v_join_avatar_id, false, v_now);
  update public.trottl_classic_sessions as session set player_count = (
    select pg_catalog.count(*)::smallint from public.trottl_classic_players as player where player.session_id = v_session.id
  ) where session.id = v_session.id;
  return v_session.id;
end;
$$;

create or replace function public.start_trottl_classic_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid(); v_room_slot smallint; v_session public.trottl_classic_sessions;
  v_member_count smallint; v_first_seat smallint; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.room_slot into v_room_slot from public.trottl_classic_sessions as session where session.id = p_session_id;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.* into v_session from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  if v_session.status <> 'lobby' then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_IN_LOBBY'; end if;
  update public.trottl_classic_players as player set last_seen_at = v_now
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER'; end if;
  perform public.cleanup_trottl_classic_lobby_locked(p_session_id, v_now);
  select session.* into v_session from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  if v_session.host_user_id <> v_user_id then raise exception using errcode = '42501', message = 'Only the host may start'; end if;
  select pg_catalog.count(*)::smallint, pg_catalog.min(player.seat_index)::smallint into v_member_count, v_first_seat
  from public.trottl_classic_players as player where player.session_id = p_session_id;
  if v_member_count < 2 or v_member_count > 8 then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_INVALID_PLAYER_COUNT'; end if;
  if exists (
    select 1 from public.trottl_classic_players as player where player.session_id = p_session_id
      and (not player.is_ready or player.avatar_id is null or not coalesce(public.is_valid_trottl_avatar_id(player.avatar_id), false))
  ) then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_PLAYERS_NOT_READY'; end if;
  update public.trottl_classic_sessions as session
  set status = 'playing', player_count = v_member_count, started_at = v_now,
      current_turn_seat = v_first_seat, roll_seq = 0, roll_result = null,
      roll_phase = 'idle', roll_started_at = null, roll_resolve_at = null,
      action_phase = 'awaiting_roll', action_actor_seat = null, action_target_seat = null,
      current_trottl_seat = null, action_payload = '{}'::jsonb, reaction_id = null,
      reaction_start_at = null, reaction_fallback_at = null,
      reaction_loser_seat = null, reaction_lockout_until = null
  where session.id = p_session_id;
  return p_session_id;
end;
$$;

-- Sparse-seat replacements for the four rule functions that previously used
-- modulo player_count. Reaction participants remain the immutable roll-start snapshot.
create or replace function public.resolve_trottl_classic_rule_locked(p_session_id uuid, p_roll_seq bigint, p_now timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_session public.trottl_classic_sessions; v_phase text; v_target smallint;
  v_payload jsonb := '{}'::jsonb; v_reaction_id uuid; v_reaction_fallback_at timestamptz;
begin
  select session.* into v_session from public.trottl_classic_sessions as session where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_phase <> 'rolling'
    or v_session.action_phase <> 'rolling' or v_session.roll_seq <> p_roll_seq or p_now < v_session.roll_resolve_at then return false; end if;
  case v_session.roll_result
    when 1 then v_phase := 'awaiting_drink_ack'; v_target := public.next_trottl_classic_active_seat(p_session_id, v_session.action_actor_seat); v_payload := pg_catalog.jsonb_build_object('kind','left_neighbor','sips',1);
    when 2 then v_phase := 'awaiting_drink_ack'; v_target := public.previous_trottl_classic_active_seat(p_session_id, v_session.action_actor_seat); v_payload := pg_catalog.jsonb_build_object('kind','right_neighbor','sips',1);
    when 3 then
      if v_session.current_trottl_seat is null or v_session.current_trottl_seat = v_session.action_actor_seat then
        v_phase := 'choosing_trottl'; v_target := null;
        v_payload := pg_catalog.jsonb_build_object('kind', case when v_session.current_trottl_seat is null then 'first_trottl' else 'replace_trottl' end);
      else v_phase := 'awaiting_drink_ack'; v_target := v_session.current_trottl_seat; v_payload := pg_catalog.jsonb_build_object('kind','trottl_drink','sips',1); end if;
    when 4 then v_phase := 'distributing_four'; v_target := null; v_payload := pg_catalog.jsonb_build_object('kind','four_sips','allocations','{}'::jsonb,'acks','[]'::jsonb);
    when 5 then
      v_phase := 'reaction_pending'; v_target := null;
      if v_session.action_payload->>'kind' = 'personal_reaction' then v_payload := v_session.action_payload;
      else select pg_catalog.jsonb_build_object('kind','personal_reaction','players',coalesce(pg_catalog.jsonb_object_agg(player.seat_index::text,pg_catalog.jsonb_build_object('status','pending')),'{}'::jsonb),'penalty_seats','[]'::jsonb,'penalty_acks','[]'::jsonb)
        into v_payload from public.trottl_classic_players as player where player.session_id = p_session_id; end if;
      v_reaction_id := coalesce(v_session.reaction_id, pg_catalog.gen_random_uuid());
      v_reaction_fallback_at := coalesce(v_session.reaction_fallback_at, p_now + pg_catalog.make_interval(secs => 27.4));
    when 6 then v_phase := 'shot_ack'; v_target := v_session.action_actor_seat; v_payload := pg_catalog.jsonb_build_object('kind','shot');
    else raise exception using errcode = '23514', message = 'TROTTL_CLASSIC_INVALID_ROLL_RESULT';
  end case;
  update public.trottl_classic_sessions as session set roll_phase='idle',roll_started_at=null,roll_resolve_at=null,
    action_phase=v_phase,action_target_seat=v_target,action_payload=v_payload,reaction_id=v_reaction_id,
    reaction_start_at=null,reaction_fallback_at=v_reaction_fallback_at,reaction_loser_seat=null,reaction_lockout_until=null
  where session.id=p_session_id;
  return true;
end; $$;

create or replace function public.ack_trottl_classic_drink(p_session_id uuid, p_roll_seq bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid:=auth.uid(); v_session public.trottl_classic_sessions; v_member_seat smallint;
  v_allocated integer; v_required integer; v_ack_count integer; v_acks jsonb;
begin
  if v_user_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session where session.id=p_session_id for update;
  if not found or v_session.status<>'playing' or v_session.roll_seq<>p_roll_seq then raise exception using errcode='P0001',message='TROTTL_CLASSIC_STALE_ACTION'; end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player where player.session_id=p_session_id and player.user_id=v_user_id;
  if not found then raise exception using errcode='42501',message='TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  if v_session.action_phase='awaiting_drink_ack' then
    if v_member_seat<>v_session.action_target_seat then raise exception using errcode='42501',message='TROTTL_CLASSIC_NOT_ACTION_TARGET'; end if;
    perform public.finish_trottl_classic_action_locked(p_session_id,v_session.action_actor_seat); return true;
  end if;
  if v_session.action_phase<>'awaiting_four_acks' then raise exception using errcode='P0001',message='TROTTL_CLASSIC_WRONG_ACTION_PHASE'; end if;
  v_allocated:=coalesce((v_session.action_payload->'allocations'->>v_member_seat::text)::integer,0);
  if v_allocated<1 then raise exception using errcode='42501',message='TROTTL_CLASSIC_NOT_ACTION_TARGET'; end if;
  if coalesce(v_session.action_payload->'acks','[]'::jsonb) @> pg_catalog.jsonb_build_array(v_member_seat) then return false; end if;
  v_acks:=coalesce(v_session.action_payload->'acks','[]'::jsonb)||pg_catalog.jsonb_build_array(v_member_seat);
  select pg_catalog.count(*)::integer into v_required from pg_catalog.jsonb_each_text(v_session.action_payload->'allocations') as allocation where allocation.value::integer>0;
  v_ack_count:=pg_catalog.jsonb_array_length(v_acks);
  if v_ack_count>=v_required then perform public.finish_trottl_classic_action_locked(p_session_id,v_session.action_actor_seat);
  else update public.trottl_classic_sessions as session set action_payload=pg_catalog.jsonb_set(session.action_payload,'{acks}',v_acks,true) where session.id=p_session_id; end if;
  return true;
end; $$;

create or replace function public.choose_trottl_classic_trottl(p_session_id uuid,p_roll_seq bigint,p_target_seat smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_session public.trottl_classic_sessions; v_member_seat smallint;
begin
  if v_user_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session where session.id=p_session_id for update;
  if not found or v_session.status<>'playing' or v_session.roll_seq<>p_roll_seq then raise exception using errcode='P0001',message='TROTTL_CLASSIC_STALE_ACTION'; end if;
  if v_session.action_phase<>'choosing_trottl' then raise exception using errcode='P0001',message='TROTTL_CLASSIC_WRONG_ACTION_PHASE'; end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player where player.session_id=p_session_id and player.user_id=v_user_id;
  if not found or v_member_seat<>v_session.action_actor_seat then raise exception using errcode='42501',message='TROTTL_CLASSIC_NOT_ACTION_ACTOR'; end if;
  if p_target_seat=v_member_seat or not exists(select 1 from public.trottl_classic_players as player where player.session_id=p_session_id and player.seat_index=p_target_seat) then raise exception using errcode='22023',message='TROTTL_CLASSIC_INVALID_TARGET'; end if;
  update public.trottl_classic_sessions as session set current_trottl_seat=p_target_seat where session.id=p_session_id;
  perform public.finish_trottl_classic_action_locked(p_session_id,v_session.action_actor_seat);
  return true;
end; $$;

create or replace function public.ack_trottl_classic_reaction_loser(p_session_id uuid,p_roll_seq bigint,p_reaction_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_session public.trottl_classic_sessions; v_member_seat smallint; v_penalty_seats jsonb; v_penalty_acks jsonb;
begin
  if v_user_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session where session.id=p_session_id for update;
  if not found or v_session.roll_seq<>p_roll_seq or v_session.reaction_id is distinct from p_reaction_id then raise exception using errcode='P0001',message='TROTTL_CLASSIC_STALE_ACTION'; end if;
  if v_session.action_phase not in ('reaction_loser_lockout','reaction_loser_ack') or pg_catalog.clock_timestamp()<v_session.reaction_lockout_until then raise exception using errcode='P0001',message='TROTTL_CLASSIC_REACTION_LOCKOUT'; end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player where player.session_id=p_session_id and player.user_id=v_user_id;
  if not found then raise exception using errcode='42501',message='TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  v_penalty_seats:=coalesce(v_session.action_payload->'penalty_seats','[]'::jsonb); v_penalty_acks:=coalesce(v_session.action_payload->'penalty_acks','[]'::jsonb);
  if not(v_penalty_seats @> pg_catalog.jsonb_build_array(v_member_seat)) then raise exception using errcode='42501',message='TROTTL_CLASSIC_NOT_ACTION_TARGET'; end if;
  if v_penalty_acks @> pg_catalog.jsonb_build_array(v_member_seat) then return false; end if;
  v_penalty_acks:=v_penalty_acks||pg_catalog.jsonb_build_array(v_member_seat);
  if pg_catalog.jsonb_array_length(v_penalty_acks)>=pg_catalog.jsonb_array_length(v_penalty_seats) then perform public.finish_trottl_classic_action_locked(p_session_id,v_session.action_actor_seat);
  else update public.trottl_classic_sessions as session set action_payload=pg_catalog.jsonb_set(session.action_payload,'{penalty_acks}',v_penalty_acks,true) where session.id=p_session_id; end if;
  return true;
end; $$;

revoke all on function public.next_trottl_classic_active_seat(uuid, smallint) from public, anon, authenticated;
revoke all on function public.previous_trottl_classic_active_seat(uuid, smallint) from public, anon, authenticated;
revoke all on function public.finish_trottl_classic_action_locked(uuid, smallint) from public, anon, authenticated;
revoke all on function public.reconcile_trottl_classic_membership_locked(uuid, uuid, smallint, timestamptz) from public, anon, authenticated;

commit;
