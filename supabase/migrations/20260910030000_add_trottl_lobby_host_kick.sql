begin;

create function public.kick_trottl_classic_player(
  p_session_id uuid,
  p_target_player_id uuid
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
  v_now timestamptz := pg_catalog.clock_timestamp();
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
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;
  if v_session.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_IN_LOBBY';
  end if;
  if not exists (
    select 1
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and player.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_NOT_MEMBER';
  end if;
  if v_session.host_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_HOST_REQUIRED';
  end if;
  if p_target_player_id = v_user_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_CANNOT_KICK_SELF';
  end if;

  -- Keep the acting host alive before applying the existing stale-player
  -- cleanup under the same room lock.
  update public.trottl_classic_players as player
  set last_seen_at = v_now
  where player.session_id = p_session_id
    and player.user_id = v_user_id;
  perform public.cleanup_trottl_classic_lobby_locked(p_session_id, v_now);

  delete from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = p_target_player_id;
  if not found then
    return false;
  end if;

  -- The shared helper owns authoritative player_count/host synchronization.
  perform public.cleanup_trottl_classic_lobby_locked(p_session_id, v_now);
  return true;
end;
$$;

revoke all on function public.kick_trottl_classic_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kick_trottl_classic_player(uuid, uuid) to authenticated;

commit;
