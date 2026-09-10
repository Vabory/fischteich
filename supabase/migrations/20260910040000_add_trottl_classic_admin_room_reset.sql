begin;

create function public.admin_reset_trottl_classic_room(p_room_slot smallint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not public.is_tournament_admin() then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_ADMIN_REQUIRED';
  end if;
  if p_room_slot is null or p_room_slot not in (1, 2) then
    raise exception using errcode = '22023', message = 'Room slot must be 1 or 2';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, p_room_slot::integer);

  select session.id into v_session_id
  from public.trottl_classic_sessions as session
  where session.room_slot = p_room_slot
    and session.status in ('lobby', 'playing')
  order by session.created_at desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  -- Keep membership removal explicit for the existing player Realtime stream;
  -- the session removal is published by the existing session stream.
  delete from public.trottl_classic_players as player
  where player.session_id = v_session_id;

  -- Removing the active session eliminates every lobby, roll, action and
  -- reaction field at once. The next normal join creates one fresh lobby.
  delete from public.trottl_classic_sessions as session
  where session.id = v_session_id;

  return true;
end;
$$;

revoke all on function public.admin_reset_trottl_classic_room(smallint) from public, anon, authenticated;
grant execute on function public.admin_reset_trottl_classic_room(smallint) to authenticated;

commit;
