begin;

create function public.is_valid_trottl_avatar_id(p_avatar_id text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_avatar_id = any (array[
    'turbo-lachs',
    'nitro-forelle',
    'koma-karpfen',
    'baller-barsch',
    'rausch-rochen',
    'wodka-wels',
    'party-piranha',
    'sauf-sardine',
    'schnaps-scholle',
    'bier-brasse',
    'flunky-flunder',
    'trichter-thunfisch',
    'hammer-time',
    'braxn',
    'nautilus-schnecke',
    'mystical-bobr'
  ]::text[]);
$$;

alter table public.app_profiles
  add column trottl_avatar_id text,
  add constraint app_profiles_trottl_avatar_valid check (
    trottl_avatar_id is null
    or public.is_valid_trottl_avatar_id(trottl_avatar_id)
  );

alter table public.trottl_classic_players
  add column avatar_id text,
  add column is_ready boolean not null default false,
  add constraint trottl_classic_players_avatar_valid check (
    avatar_id is null
    or public.is_valid_trottl_avatar_id(avatar_id)
  ),
  add constraint trottl_classic_players_ready_requires_avatar check (
    not is_ready
    or (avatar_id is not null and public.is_valid_trottl_avatar_id(avatar_id))
  );

create or replace function public.join_trottl_classic_room(p_room_slot smallint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_profile_avatar_id text;
  v_session public.trottl_classic_sessions;
  v_existing_session_id uuid;
  v_existing_room_slot smallint;
  v_seat_index smallint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_room_slot is null or p_room_slot not in (1, 2) then
    raise exception using errcode = '22023', message = 'Room slot must be 1 or 2';
  end if;

  select profile.display_name, profile.trottl_avatar_id
  into v_display_name, v_profile_avatar_id
  from public.app_profiles as profile
  where profile.user_id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'App profile required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 337733)
  );

  -- Returning an existing membership is a reconnect. Its avatar and ready
  -- snapshot are deliberately left untouched.
  select session.id, session.room_slot
  into v_existing_session_id, v_existing_room_slot
  from public.trottl_classic_players as player
  join public.trottl_classic_sessions as session on session.id = player.session_id
  where player.user_id = v_user_id
    and session.status in ('lobby', 'playing')
  order by session.created_at desc
  limit 1;
  if found then
    if v_existing_room_slot = p_room_slot then
      return v_existing_session_id;
    end if;
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ALREADY_IN_OTHER_ROOM';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, p_room_slot::integer);

  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.room_slot = p_room_slot
    and session.status in ('lobby', 'playing')
  order by session.created_at desc
  limit 1
  for update;

  if found then
    if exists (
      select 1
      from public.trottl_classic_players as player
      where player.session_id = v_session.id
        and player.user_id = v_user_id
    ) then
      return v_session.id;
    end if;
    if v_session.status <> 'lobby' then
      raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_GAME_ALREADY_STARTED';
    end if;
    if v_session.player_count >= 8 then
      raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL';
    end if;
  else
    insert into public.trottl_classic_sessions (room_slot, host_user_id)
    values (p_room_slot, v_user_id)
    returning * into v_session;
  end if;

  select coalesce(pg_catalog.max(player.seat_index), -1) + 1
  into v_seat_index
  from public.trottl_classic_players as player
  where player.session_id = v_session.id;

  if v_seat_index > 7 then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL';
  end if;

  insert into public.trottl_classic_players (
    session_id,
    user_id,
    display_name_snapshot,
    seat_index,
    avatar_id,
    is_ready
  ) values (
    v_session.id,
    v_user_id,
    v_display_name,
    v_seat_index,
    case
      when public.is_valid_trottl_avatar_id(v_profile_avatar_id) then v_profile_avatar_id
      else null
    end,
    false
  );

  update public.trottl_classic_sessions as session
  set player_count = session.player_count + 1
  where session.id = v_session.id;

  return v_session.id;
end;
$$;

create function public.set_trottl_classic_avatar(
  p_session_id uuid,
  p_avatar_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_slot smallint;
  v_session public.trottl_classic_sessions;
  v_player public.trottl_classic_players;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not coalesce(public.is_valid_trottl_avatar_id(p_avatar_id), false) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_INVALID_AVATAR_ID';
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

  select player.* into v_player
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER';
  end if;
  if v_player.is_ready then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_PLAYER_ALREADY_READY';
  end if;

  update public.trottl_classic_players as player
  set avatar_id = p_avatar_id
  where player.session_id = p_session_id
    and player.user_id = v_user_id;

  update public.app_profiles as profile
  set trottl_avatar_id = p_avatar_id
  where profile.user_id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'App profile required';
  end if;

  return p_avatar_id;
end;
$$;

create function public.set_trottl_classic_ready(
  p_session_id uuid,
  p_ready boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_slot smallint;
  v_session public.trottl_classic_sessions;
  v_player public.trottl_classic_players;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_ready is null then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_READY_VALUE_REQUIRED';
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

  select player.* into v_player
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER';
  end if;
  if p_ready and (
    v_player.avatar_id is null
    or not coalesce(public.is_valid_trottl_avatar_id(v_player.avatar_id), false)
  ) then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_AVATAR_REQUIRED';
  end if;

  update public.trottl_classic_players as player
  set is_ready = p_ready
  where player.session_id = p_session_id
    and player.user_id = v_user_id;

  return p_ready;
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

  -- Avatar/ready mutations use this same room lock. Whichever transaction
  -- acquires it first defines the authoritative order for ready-vs-start.
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

  -- Lock the current membership snapshot before validating it. Leave/join and
  -- ready changes are already serialized by the room lock as well.
  perform player.user_id
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
  for update;

  select pg_catalog.count(*)::smallint into v_member_count
  from public.trottl_classic_players as player
  where player.session_id = p_session_id;
  if v_member_count < 3 or v_member_count > 8 then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_INVALID_PLAYER_COUNT';
  end if;
  if exists (
    select 1
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and (
        not player.is_ready
        or player.avatar_id is null
        or not coalesce(public.is_valid_trottl_avatar_id(player.avatar_id), false)
      )
  ) then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_PLAYERS_NOT_READY';
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
      reaction_fallback_at = null,
      reaction_loser_seat = null,
      reaction_lockout_until = null
  where session.id = p_session_id;

  return p_session_id;
end;
$$;

revoke all on function public.is_valid_trottl_avatar_id(text) from public, anon, authenticated;
revoke all on function public.set_trottl_classic_avatar(uuid, text) from public, anon, authenticated;
revoke all on function public.set_trottl_classic_ready(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_trottl_classic_avatar(uuid, text) to authenticated;
grant execute on function public.set_trottl_classic_ready(uuid, boolean) to authenticated;

commit;
