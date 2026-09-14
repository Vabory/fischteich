begin;
-- Room infrastructure only. No Special event, score, life or finale rules change.
create or replace function public.reconcile_trottl_special_members_locked(p_session_id uuid)
returns smallint language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;n smallint;host_id uuid;turn_id smallint;status_value text;finished_value timestamptz;g jsonb;d jsonb;
begin
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 select count(*)::smallint,min(seat_index)::smallint into n,turn_id from public.trottl_special_players where session_id=p_session_id;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=s.host_user_id) then host_id:=s.host_user_id;
 else select user_id into host_id from public.trottl_special_players where session_id=p_session_id order by joined_at,seat_index limit 1;end if;
 host_id:=coalesce(host_id,s.host_user_id);
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and seat_index=s.current_turn_seat) then turn_id:=s.current_turn_seat;end if;
 status_value:=s.status;finished_value:=s.finished_at;g:=s.game_state;d:=s.debug_test;
 if n=0 then
  status_value:='finished';finished_value:=coalesce(s.finished_at,clock_timestamp());turn_id:=null;g:='{}'::jsonb;d:='{}'::jsonb;
  delete from public.trottl_special_spectators where session_id=p_session_id;
 end if;
 update public.trottl_special_sessions set player_count=n,host_user_id=host_id,current_turn_seat=turn_id,
  status=status_value,finished_at=finished_value,game_state=g,debug_test=d
 where id=p_session_id and (player_count,host_user_id,current_turn_seat,status,finished_at,game_state,debug_test)
  is distinct from (n,host_id,turn_id,status_value,finished_value,g,d);
 return n;
end; $$;

create function public.cleanup_trottl_special_lobby_locked(p_session_id uuid,p_now timestamptz)
returns smallint language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;
begin
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 if s.status<>'lobby' then return s.player_count; end if;
 delete from public.trottl_special_players where session_id=p_session_id and p_now>last_seen_at+interval '120 seconds';
 return public.reconcile_trottl_special_members_locked(p_session_id);
end; $$;

-- Repair only a missing lobby avatar. Never replace a chosen avatar or mutate Ready.
create function public.repair_trottl_special_lobby_avatar_locked(p_session_id uuid,p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare avatar text;
begin
 if not exists(select 1 from public.trottl_special_sessions s join public.trottl_special_players p on p.session_id=s.id
  where s.id=p_session_id and s.status='lobby' and p.user_id=p_user and p.avatar_id is null and not p.is_ready) then return; end if;
 select trottl_avatar_id into avatar from public.app_profiles where user_id=p_user;
 if not coalesce(public.is_valid_trottl_avatar_id(avatar),false) then avatar:='turbo-lachs';
  update public.app_profiles set trottl_avatar_id=avatar where user_id=p_user and trottl_avatar_id is distinct from avatar;end if;
 update public.trottl_special_players set avatar_id=avatar where session_id=p_session_id and user_id=p_user and avatar_id is null and not is_ready;
end; $$;

create or replace function public.cleanup_trottl_special_lobby(p_session_id uuid)
returns smallint language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;t timestamptz:=clock_timestamp();
begin
 s:=public.lock_trottl_special_session(p_session_id);
 if s.status<>'lobby' then return s.player_count;end if;
 update public.trottl_special_players set last_seen_at=t where session_id=p_session_id and user_id=auth.uid();
 return public.cleanup_trottl_special_lobby_locked(p_session_id,t);
end; $$;

-- Explicit lobby recovery; called before the read-only load, not from snapshot refresh.
create function public.recover_trottl_special_lobby(p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;
begin
 s:=public.lock_trottl_special_session(p_session_id);
 if s.status='lobby' then
  perform public.repair_trottl_special_lobby_avatar_locked(p_session_id,auth.uid());
  perform public.cleanup_trottl_special_lobby(p_session_id);
 end if;
 return p_session_id;
end; $$;

create or replace function public.join_trottl_special_room(p_room_slot smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();name_value text;avatar text;s public.trottl_special_sessions;existing public.trottl_special_sessions;seat_id smallint;t timestamptz;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_room_slot is null or p_room_slot not in (1,2) then raise exception 'Invalid room';end if;
 select display_name,trottl_avatar_id into name_value,avatar from public.app_profiles where user_id=u;
 if not found then raise exception 'App profile required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text,337734));
 -- Always lock BOTH room slots in order: cross-room cleanup/join cannot AB/BA deadlock.
 perform pg_catalog.pg_advisory_xact_lock(337734,1);
 perform pg_catalog.pg_advisory_xact_lock(337734,2);
 t:=clock_timestamp();
 select s0.* into existing from public.trottl_special_sessions s0 join public.trottl_special_players p on p.session_id=s0.id
  where p.user_id=u and s0.status in ('lobby','playing') order by s0.created_at desc limit 1 for update of s0;
 if found then
  if existing.room_slot<>p_room_slot then
   if existing.status='lobby' then perform public.cleanup_trottl_special_lobby_locked(existing.id,t);end if;
   if exists(select 1 from public.trottl_special_players where session_id=existing.id and user_id=u) then raise exception 'TROTTL_SPECIAL_ALREADY_IN_OTHER_ROOM';end if;
  else
   -- Membership still exists: reconnect does not replace its choice or Ready state.
   update public.trottl_special_players set last_seen_at=t where session_id=existing.id and user_id=u;
   if existing.status='lobby' then
    perform public.repair_trottl_special_lobby_avatar_locked(existing.id,u);
    perform public.cleanup_trottl_special_lobby_locked(existing.id,t);
   end if;
   return existing.id;
  end if;
 end if;
 select * into s from public.trottl_special_sessions where room_slot=p_room_slot and status in ('lobby','playing') for update;
 if found then
  if s.status='playing' then raise exception 'TROTTL_SPECIAL_GAME_ALREADY_STARTED';end if;
  perform public.cleanup_trottl_special_lobby_locked(s.id,t);
  select * into s from public.trottl_special_sessions where id=s.id;
  if s.status='finished' then insert into public.trottl_special_sessions(room_slot,host_user_id) values(p_room_slot,u) returning * into s;end if;
 else insert into public.trottl_special_sessions(room_slot,host_user_id) values(p_room_slot,u) returning * into s;end if;
 select n::smallint into seat_id from generate_series(0,7) n where not exists(select 1 from public.trottl_special_players where session_id=s.id and seat_index=n) order by n limit 1;
 if seat_id is null then raise exception 'TROTTL_SPECIAL_ROOM_FULL';end if;
 if not coalesce(public.is_valid_trottl_avatar_id(avatar),false) then avatar:='turbo-lachs';
  update public.app_profiles set trottl_avatar_id=avatar where user_id=u and trottl_avatar_id is distinct from avatar;end if;
 insert into public.trottl_special_players(session_id,user_id,display_name_snapshot,seat_index,avatar_id,is_ready,last_seen_at)
  values(s.id,u,name_value,seat_id,avatar,false,t);
 perform public.reconcile_trottl_special_members_locked(s.id);return s.id;
end; $$;

-- Existing RPC rules remain intact; shared preflight refreshes caller presence and prunes only lobbies.
create function public.trottl_special_lobby_preflight(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;
begin
 s:=public.lock_trottl_special_session(p_session_id);
 if s.status<>'lobby' then raise exception 'TROTTL_SPECIAL_NOT_IN_LOBBY';end if;
 perform public.cleanup_trottl_special_lobby(p_session_id);
end; $$;
alter function public.set_trottl_special_ready(uuid,boolean) rename to set_trottl_special_ready_before_lifecycle;
create function public.set_trottl_special_ready(p_session_id uuid,p_ready boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform public.trottl_special_lobby_preflight(p_session_id);
 return public.set_trottl_special_ready_before_lifecycle(p_session_id,p_ready);
end; $$;
alter function public.set_trottl_special_avatar(uuid,text) rename to set_trottl_special_avatar_before_lifecycle;
create function public.set_trottl_special_avatar(p_session_id uuid,p_avatar_id text)
returns text language plpgsql security definer set search_path='' as $$
begin
 perform public.trottl_special_lobby_preflight(p_session_id);
 return public.set_trottl_special_avatar_before_lifecycle(p_session_id,p_avatar_id);
end; $$;
create or replace function public.kick_trottl_special_player(p_session_id uuid,p_target_player_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;
begin
 s:=public.lock_trottl_special_session(p_session_id);
 if s.status<>'lobby' or s.host_user_id<>auth.uid() or p_target_player_id is null or p_target_player_id=auth.uid() then raise exception 'TROTTL_SPECIAL_KICK_NOT_ALLOWED';end if;
 perform public.trottl_special_lobby_preflight(p_session_id);
 delete from public.trottl_special_players where session_id=p_session_id and user_id=p_target_player_id;
 if not found then return false;end if;
 perform public.reconcile_trottl_special_members_locked(p_session_id);return true;
end; $$;

-- Lobby leave needs no gameplay mutation. Ingame delegates all existing rules.
alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_room_lifecycle;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare slot smallint;s public.trottl_special_sessions;done boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true;end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if s.status='lobby' then
  delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
  if not found then return true;end if;
  perform public.reconcile_trottl_special_members_locked(p_session_id);return true;
 end if;
 done:=public.leave_trottl_special_before_room_lifecycle(p_session_id);
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id) then perform public.reconcile_trottl_special_members_locked(p_session_id);end if;
 return done;
end; $$;

create function public.admin_reset_trottl_special_room(p_room_slot smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare id_value uuid;
begin
 if auth.uid() is null or not public.is_tournament_admin() then raise exception 'TROTTL_SPECIAL_ADMIN_REQUIRED';end if;
 if p_room_slot is null or p_room_slot not in (1,2) then raise exception 'Invalid room';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,p_room_slot::integer);
 select id into id_value from public.trottl_special_sessions where room_slot=p_room_slot and status in ('lobby','playing') for update;
 if not found then return false;end if;
 delete from public.trottl_special_players where session_id=id_value;
 delete from public.trottl_special_spectators where session_id=id_value;
 delete from public.trottl_special_sessions where id=id_value;
 return true;
end; $$;

revoke all on function public.reconcile_trottl_special_members_locked(uuid),public.cleanup_trottl_special_lobby_locked(uuid,timestamptz),
 public.repair_trottl_special_lobby_avatar_locked(uuid,uuid),public.trottl_special_lobby_preflight(uuid),
 public.set_trottl_special_ready_before_lifecycle(uuid,boolean),public.set_trottl_special_avatar_before_lifecycle(uuid,text),public.leave_trottl_special_before_room_lifecycle(uuid),
 public.recover_trottl_special_lobby(uuid),public.join_trottl_special_room(smallint),public.cleanup_trottl_special_lobby(uuid),
 public.set_trottl_special_ready(uuid,boolean),public.set_trottl_special_avatar(uuid,text),public.kick_trottl_special_player(uuid,uuid),
 public.admin_reset_trottl_special_room(smallint),public.leave_trottl_special_session(uuid) from public,anon,authenticated;
grant execute on function public.recover_trottl_special_lobby(uuid),public.join_trottl_special_room(smallint),public.cleanup_trottl_special_lobby(uuid),
 public.set_trottl_special_ready(uuid,boolean),public.set_trottl_special_avatar(uuid,text),public.kick_trottl_special_player(uuid,uuid),
 public.admin_reset_trottl_special_room(smallint),public.leave_trottl_special_session(uuid) to authenticated;
commit;
