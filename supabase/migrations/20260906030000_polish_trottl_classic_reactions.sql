begin;

alter table public.trottl_classic_sessions
  add column reaction_fallback_at timestamptz;

-- A deployment during an old shared-start reaction converts it to a fresh
-- personal-window round instead of leaving an unreadable legacy payload.
update public.trottl_classic_sessions as session
set action_phase = 'reaction_pending',
    action_payload = pg_catalog.jsonb_build_object(
      'kind', 'personal_reaction',
      'players', coalesce((
        select pg_catalog.jsonb_object_agg(
          player.seat_index::text,
          pg_catalog.jsonb_build_object('status', 'pending')
        )
        from public.trottl_classic_players as player
        where player.session_id = session.id
      ), '{}'::jsonb),
      'penalty_seats', '[]'::jsonb,
      'penalty_acks', '[]'::jsonb
    ),
    reaction_start_at = null,
    reaction_fallback_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30.0),
    reaction_loser_seat = null,
    reaction_lockout_until = null
where session.action_phase in (
  'reaction_pending',
  'reaction_active',
  'reaction_loser_lockout',
  'reaction_loser_ack'
);

create or replace function public.resolve_trottl_classic_rule_locked(
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
  v_reaction_fallback_at timestamptz;
begin
  select session.* into v_session
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
      -- With the clockwise visual cycle, global +1 is physically left.
      v_target := ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint;
      v_payload := pg_catalog.jsonb_build_object('kind', 'left_neighbor', 'sips', 1);
    when 2 then
      v_phase := 'awaiting_drink_ack';
      -- Global -1 is physically right without changing the turn cycle itself.
      v_target := ((v_session.action_actor_seat - 1 + v_session.player_count) % v_session.player_count)::smallint;
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
        'kind', 'four_sips', 'allocations', '{}'::jsonb, 'acks', '[]'::jsonb
      );
    when 5 then
      v_phase := 'reaction_pending';
      v_target := null;
      if v_session.action_payload->>'kind' = 'personal_reaction' then
        v_payload := v_session.action_payload;
      else
        select pg_catalog.jsonb_build_object(
          'kind', 'personal_reaction',
          'players', coalesce(pg_catalog.jsonb_object_agg(
            player.seat_index::text,
            pg_catalog.jsonb_build_object('status', 'pending')
          ), '{}'::jsonb),
          'penalty_seats', '[]'::jsonb,
          'penalty_acks', '[]'::jsonb
        ) into v_payload
        from public.trottl_classic_players as player
        where player.session_id = p_session_id;
      end if;
      v_reaction_id := coalesce(v_session.reaction_id, pg_catalog.gen_random_uuid());
      v_reaction_fallback_at := coalesce(
        v_session.reaction_fallback_at,
        p_now + pg_catalog.make_interval(secs => 27.4)
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
      reaction_start_at = null,
      reaction_fallback_at = v_reaction_fallback_at,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;
  return true;
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
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'playing' then raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_PLAYING'; end if;

  if v_session.roll_phase = 'rolling' and v_now >= v_session.roll_resolve_at then
    perform public.resolve_trottl_classic_rule_locked(p_session_id, v_session.roll_seq, v_now);
    select session.* into v_session from public.trottl_classic_sessions as session
    where session.id = p_session_id for update;
  end if;

  select player.seat_index into v_member_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  if v_member_seat <> v_session.current_turn_seat then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_YOUR_TURN';
  end if;
  if v_session.roll_phase <> 'idle' or v_session.action_phase not in ('awaiting_roll', 'awaiting_reroll') then
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
      action_payload = case when v_result = 5 then pg_catalog.jsonb_build_object(
        'kind', 'personal_reaction',
        'players', coalesce((
          select pg_catalog.jsonb_object_agg(
            player.seat_index::text,
            pg_catalog.jsonb_build_object('status', 'pending')
          )
          from public.trottl_classic_players as player
          where player.session_id = p_session_id
        ), '{}'::jsonb),
        'penalty_seats', '[]'::jsonb,
        'penalty_acks', '[]'::jsonb
      ) else '{}'::jsonb end,
      reaction_id = case when v_result = 5 then pg_catalog.gen_random_uuid() else null end,
      reaction_start_at = null,
      reaction_fallback_at = case when v_result = 5 then v_now + pg_catalog.make_interval(secs => 30.0) else null end,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id
  returning session.roll_seq into v_roll_seq;
  return v_roll_seq;
end;
$$;

create function public.refresh_trottl_classic_personal_reaction_locked(
  p_session_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.trottl_classic_sessions;
  v_players jsonb;
  v_seat text;
  v_player jsonb;
  v_deadline timestamptz;
  v_pending_count integer;
  v_timeout_count integer;
  v_penalty_seats jsonb;
  v_loser_seat smallint;
  v_changed boolean := false;
begin
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.action_phase not in ('reaction_pending', 'reaction_active') then return false; end if;

  v_players := coalesce(v_session.action_payload->'players', '{}'::jsonb);
  for v_seat, v_player in select entry.key, entry.value from pg_catalog.jsonb_each(v_players) as entry
  loop
    if v_player->>'status' = 'pending' then
      v_deadline := (v_player->>'deadline_at')::timestamptz;
      if (
        v_deadline is not null
        and p_now >= v_deadline + pg_catalog.make_interval(secs => 2.0)
      ) or (
        v_deadline is null
        and v_session.reaction_fallback_at is not null
        and p_now >= v_session.reaction_fallback_at
      ) then
        v_player := v_player || pg_catalog.jsonb_build_object('status', 'timed_out');
        v_players := pg_catalog.jsonb_set(v_players, array[v_seat], v_player, false);
        v_changed := true;
      end if;
    end if;
  end loop;

  select pg_catalog.count(*)::integer into v_pending_count
  from pg_catalog.jsonb_each(v_players) as entry
  where entry.value->>'status' = 'pending';

  if v_pending_count = 0 then
    select pg_catalog.count(*)::integer into v_timeout_count
    from pg_catalog.jsonb_each(v_players) as entry
    where entry.value->>'status' = 'timed_out';

    if v_timeout_count > 0 then
      select pg_catalog.jsonb_agg(entry.key::smallint order by entry.key::smallint) into v_penalty_seats
      from pg_catalog.jsonb_each(v_players) as entry
      where entry.value->>'status' = 'timed_out';
    else
      select entry.key::smallint into v_loser_seat
      from pg_catalog.jsonb_each(v_players) as entry
      where entry.value->>'status' = 'reacted'
      order by (entry.value->>'duration_ms')::integer desc, entry.key::smallint
      limit 1;
      v_penalty_seats := pg_catalog.jsonb_build_array(v_loser_seat);
    end if;

    update public.trottl_classic_sessions as session
    set action_phase = 'reaction_loser_lockout',
        action_payload = pg_catalog.jsonb_build_object(
          'kind', 'personal_reaction',
          'players', v_players,
          'penalty_seats', coalesce(v_penalty_seats, '[]'::jsonb),
          'penalty_acks', '[]'::jsonb
        ),
        reaction_loser_seat = case
          when pg_catalog.jsonb_array_length(coalesce(v_penalty_seats, '[]'::jsonb)) = 1
            then (v_penalty_seats->>0)::smallint
          else null
        end,
        reaction_lockout_until = p_now + pg_catalog.make_interval(secs => 0.8)
    where session.id = p_session_id;
    return true;
  end if;

  if v_changed then
    update public.trottl_classic_sessions as session
    set action_payload = pg_catalog.jsonb_set(session.action_payload, '{players}', v_players, true)
    where session.id = p_session_id;
  end if;
  return v_changed;
end;
$$;

create function public.start_trottl_classic_personal_reaction(
  p_session_id uuid,
  p_roll_seq bigint,
  p_reaction_id uuid,
  p_client_started_at timestamptz
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
  v_player jsonb;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq
    or v_session.reaction_id is distinct from p_reaction_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if not (
    v_session.action_phase in ('reaction_pending', 'reaction_active')
    or (v_session.action_phase = 'rolling' and v_session.roll_result = 5)
  ) then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  v_player := v_session.action_payload->'players'->v_member_seat::text;
  if v_player->>'status' <> 'pending' then return false; end if;
  if v_player ? 'started_at' then return false; end if;
  if p_client_started_at is null
    or p_client_started_at > v_now + pg_catalog.make_interval(secs => 0.25)
    or p_client_started_at < v_now - pg_catalog.make_interval(secs => 30.0)
    or v_now >= v_session.reaction_fallback_at then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_START_IMPLAUSIBLE';
  end if;

  v_player := v_player || pg_catalog.jsonb_build_object(
    'started_at', p_client_started_at,
    'deadline_at', p_client_started_at + pg_catalog.make_interval(secs => 10.0)
  );
  update public.trottl_classic_sessions as session
  set action_payload = pg_catalog.jsonb_set(
    session.action_payload,
    array['players', v_member_seat::text],
    v_player,
    false
  ) where session.id = p_session_id;
  perform public.refresh_trottl_classic_personal_reaction_locked(p_session_id, v_now);
  return true;
end;
$$;

create or replace function public.react_trottl_classic(
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
  v_player jsonb;
  v_started_at timestamptz;
  v_deadline_at timestamptz;
  v_duration_ms integer;
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
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  v_player := v_session.action_payload->'players'->v_member_seat::text;
  if v_player->>'status' <> 'pending' then return false; end if;
  v_started_at := (v_player->>'started_at')::timestamptz;
  v_deadline_at := (v_player->>'deadline_at')::timestamptz;
  if v_started_at is null or v_deadline_at is null then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_REACTION_NOT_STARTED';
  end if;
  if p_client_reacted_at is null
    or p_client_reacted_at < v_started_at
    or p_client_reacted_at > v_deadline_at
    or p_client_reacted_at > v_now + pg_catalog.make_interval(secs => 0.25)
    or p_client_reacted_at < v_now - pg_catalog.make_interval(secs => 12.0) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_TIME_IMPLAUSIBLE';
  end if;

  v_duration_ms := pg_catalog.floor(
    extract(epoch from (p_client_reacted_at - v_started_at)) * 1000
  )::integer;
  v_player := v_player || pg_catalog.jsonb_build_object(
    'status', 'reacted',
    'reacted_at', p_client_reacted_at,
    'duration_ms', v_duration_ms
  );
  update public.trottl_classic_sessions as session
  set action_payload = pg_catalog.jsonb_set(
    session.action_payload,
    array['players', v_member_seat::text],
    v_player,
    false
  ) where session.id = p_session_id;
  perform public.refresh_trottl_classic_personal_reaction_locked(p_session_id, v_now);
  return true;
end;
$$;

create function public.sync_trottl_classic_reaction(p_session_id uuid)
returns boolean
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
  return public.refresh_trottl_classic_personal_reaction_locked(
    p_session_id,
    pg_catalog.clock_timestamp()
  );
end;
$$;

create or replace function public.ack_trottl_classic_reaction_loser(
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
  v_penalty_seats jsonb;
  v_penalty_acks jsonb;
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
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  v_penalty_seats := coalesce(v_session.action_payload->'penalty_seats', '[]'::jsonb);
  v_penalty_acks := coalesce(v_session.action_payload->'penalty_acks', '[]'::jsonb);
  if not (v_penalty_seats @> pg_catalog.jsonb_build_array(v_member_seat)) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_ACTION_TARGET';
  end if;
  if v_penalty_acks @> pg_catalog.jsonb_build_array(v_member_seat) then return false; end if;
  v_penalty_acks := v_penalty_acks || pg_catalog.jsonb_build_array(v_member_seat);

  if pg_catalog.jsonb_array_length(v_penalty_acks) >= pg_catalog.jsonb_array_length(v_penalty_seats) then
    update public.trottl_classic_sessions as session
    set current_turn_seat = ((v_session.action_actor_seat + 1) % v_session.player_count)::smallint,
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
  else
    update public.trottl_classic_sessions as session
    set action_payload = pg_catalog.jsonb_set(session.action_payload, '{penalty_acks}', v_penalty_acks, true)
    where session.id = p_session_id;
  end if;
  return true;
end;
$$;

revoke all on function public.refresh_trottl_classic_personal_reaction_locked(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.start_trottl_classic_personal_reaction(uuid, bigint, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sync_trottl_classic_reaction(uuid)
  from public, anon, authenticated;
grant execute on function public.start_trottl_classic_personal_reaction(uuid, bigint, uuid, timestamptz)
  to authenticated;
grant execute on function public.sync_trottl_classic_reaction(uuid)
  to authenticated;

commit;
