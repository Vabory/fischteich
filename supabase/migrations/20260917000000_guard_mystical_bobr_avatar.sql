create or replace function public.set_trottl_classic_avatar(
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
  v_bobr_unlocked boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not coalesce(public.is_valid_trottl_avatar_id(p_avatar_id), false) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_INVALID_AVATAR_ID';
  end if;

  select profile.bobr_unlocked into v_bobr_unlocked
  from public.app_profiles as profile
  where profile.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'App profile required';
  end if;
  if p_avatar_id = 'mystical-bobr' and v_bobr_unlocked is not true then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MYSTICAL_BOBR_LOCKED';
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

  return p_avatar_id;
end;
$$;

revoke all on function public.set_trottl_classic_avatar(uuid, text) from public, anon;
grant execute on function public.set_trottl_classic_avatar(uuid, text) to authenticated;
