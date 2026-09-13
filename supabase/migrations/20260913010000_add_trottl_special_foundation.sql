begin;

-- Classic's fixed-mode constraints and unfiltered RPCs remain unchanged.
-- A small Special lifecycle namespace; no Classic gameplay/reaction schema copied.
create table public.trottl_special_sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'special' check (mode = 'special'),
  room_slot smallint not null check (room_slot in (1,2)),
  status text not null default 'lobby' check (status in ('lobby','playing','finished')),
  host_user_id uuid not null references public.app_profiles(user_id),
  player_count smallint not null default 0 check (player_count between 0 and 8),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  current_turn_seat smallint check (current_turn_seat between 0 and 7),
  -- Reserved state container: no Special dice rules or action phases yet.
  game_state jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(game_state) = 'object'),
  check ((status='lobby' and started_at is null and finished_at is null)
    or (status='playing' and started_at is not null and finished_at is null)
    or (status='finished' and finished_at is not null))
);
create unique index trottl_special_one_active_session_per_slot_idx
  on public.trottl_special_sessions(room_slot) where status in ('lobby','playing');
create table public.trottl_special_players (
  session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
  user_id uuid not null references public.app_profiles(user_id),
  display_name_snapshot text not null check (display_name_snapshot=pg_catalog.btrim(display_name_snapshot)
    and pg_catalog.char_length(display_name_snapshot) between 1 and 24),
  seat_index smallint not null check (seat_index between 0 and 7),
  avatar_id text check (avatar_id is null or public.is_valid_trottl_avatar_id(avatar_id)),
  is_ready boolean not null default false,
  joined_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_seen_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(session_id,user_id), unique(session_id,seat_index),
  check (not is_ready or avatar_id is not null)
);
create index trottl_special_membership_lookup on public.trottl_special_players(user_id,session_id);
alter table public.trottl_special_sessions enable row level security;
alter table public.trottl_special_players enable row level security;

create function public.is_trottl_special_member(p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.trottl_special_players as p
    where p.session_id=p_session_id and p.user_id=(select auth.uid()));
$$;
create policy trottl_special_metadata on public.trottl_special_sessions for select to authenticated using(true);
create policy trottl_special_members on public.trottl_special_players for select to authenticated
  using(public.is_trottl_special_member(session_id));
revoke all on public.trottl_special_sessions, public.trottl_special_players from public,anon,authenticated;
grant select on public.trottl_special_sessions, public.trottl_special_players to authenticated;

-- All Special lifecycle writers share this namespace and lock order.
create function public.lock_trottl_special_session(p_session_id uuid)
returns public.trottl_special_sessions language plpgsql security definer set search_path='' as $$
declare v_slot smallint; v_session public.trottl_special_sessions;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select s.room_slot into v_slot from public.trottl_special_sessions as s where s.id=p_session_id;
  if not found then raise exception using errcode='P0001',message='TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
  select s.* into v_session from public.trottl_special_sessions as s where s.id=p_session_id for update;
  if v_session.status='finished' or not public.is_trottl_special_member(p_session_id) then
    raise exception using errcode='42501',message='TROTTL_SPECIAL_NOT_MEMBER';
  end if;
  return v_session;
end; $$;

create function public.reconcile_trottl_special_members_locked(p_session_id uuid)
returns smallint language plpgsql security definer set search_path='' as $$
declare v_count smallint; v_host uuid; v_first smallint;
begin
  select pg_catalog.count(*)::smallint,pg_catalog.min(p.seat_index)::smallint into v_count,v_first
    from public.trottl_special_players as p where p.session_id=p_session_id;
  select p.user_id into v_host from public.trottl_special_players as p where p.session_id=p_session_id
    order by p.joined_at,p.seat_index limit 1;
  update public.trottl_special_sessions as s set player_count=v_count,
    host_user_id=case when exists(select 1 from public.trottl_special_players as p
      where p.session_id=p_session_id and p.user_id=s.host_user_id) then s.host_user_id else coalesce(v_host,s.host_user_id) end,
    current_turn_seat=case when exists(select 1 from public.trottl_special_players as p
      where p.session_id=p_session_id and p.seat_index=s.current_turn_seat) then s.current_turn_seat else v_first end,
    status=case when v_count=0 then 'finished' else s.status end,
    finished_at=case when v_count=0 then pg_catalog.clock_timestamp() else s.finished_at end
    where s.id=p_session_id;
  return v_count;
end; $$;

create function public.get_trottl_special_rooms()
returns table(room_slot smallint,session_id uuid,session_status text,player_count smallint,is_member boolean)
language sql stable security definer set search_path='' as $$
  select slot.n,s.id,s.status,coalesce(s.player_count,0)::smallint,
    coalesce(public.is_trottl_special_member(s.id),false)
  from (values(1::smallint),(2::smallint)) as slot(n)
  left join public.trottl_special_sessions as s on s.room_slot=slot.n and s.status in ('lobby','playing')
  where (select auth.uid()) is not null order by slot.n;
$$;

create function public.join_trottl_special_room(p_room_slot smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_name text; v_avatar text;
  v_session public.trottl_special_sessions; v_existing public.trottl_special_sessions; v_seat smallint;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_room_slot is null or p_room_slot not in (1,2) then raise exception using errcode='22023',message='Invalid room'; end if;
  select p.display_name,p.trottl_avatar_id into v_name,v_avatar from public.app_profiles as p where p.user_id=v_user;
  if not found then raise exception using errcode='23503',message='App profile required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,337734));
  select s.* into v_existing from public.trottl_special_sessions as s
    join public.trottl_special_players as p on p.session_id=s.id
    where p.user_id=v_user and s.status in ('lobby','playing') order by s.created_at desc limit 1;
  if found then
    if v_existing.room_slot<>p_room_slot then raise exception using errcode='P0001',message='TROTTL_SPECIAL_ALREADY_IN_OTHER_ROOM'; end if;
    -- Existing members may reconnect; this never inserts a new active participant.
    perform public.lock_trottl_special_session(v_existing.id);
    update public.trottl_special_players as p set last_seen_at=pg_catalog.clock_timestamp()
      where p.session_id=v_existing.id and p.user_id=v_user;
    return v_existing.id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,p_room_slot::integer);
  select s.* into v_session from public.trottl_special_sessions as s
    where s.room_slot=p_room_slot and s.status in ('lobby','playing') for update;
  if found and v_session.status='playing' then
    raise exception using errcode='P0001',message='TROTTL_SPECIAL_GAME_ALREADY_STARTED';
  end if;
  if not found then
    insert into public.trottl_special_sessions(room_slot,host_user_id) values(p_room_slot,v_user) returning * into v_session;
  else
    -- Abandoned lobbies must not permanently occupy a slot. Never prune games.
    delete from public.trottl_special_players as p where p.session_id=v_session.id
      and p.last_seen_at<pg_catalog.clock_timestamp()-interval '90 seconds';
    if public.reconcile_trottl_special_members_locked(v_session.id)=0 then
      insert into public.trottl_special_sessions(room_slot,host_user_id) values(p_room_slot,v_user) returning * into v_session;
    end if;
  end if;
  select seat.n::smallint into v_seat from pg_catalog.generate_series(0,7) as seat(n)
    where not exists(select 1 from public.trottl_special_players as p
      where p.session_id=v_session.id and p.seat_index=seat.n) order by seat.n limit 1;
  if v_seat is null then raise exception using errcode='P0001',message='TROTTL_SPECIAL_ROOM_FULL'; end if;
  insert into public.trottl_special_players(session_id,user_id,display_name_snapshot,seat_index,avatar_id)
    values(v_session.id,v_user,v_name,v_seat,case when public.is_valid_trottl_avatar_id(v_avatar) then v_avatar else null end);
  perform public.reconcile_trottl_special_members_locked(v_session.id);
  return v_session.id;
end; $$;

create function public.heartbeat_trottl_special_session(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  update public.trottl_special_players as p set last_seen_at=v_now where p.session_id=p_session_id and p.user_id=auth.uid();
  return v_now;
end; $$;

create function public.cleanup_trottl_special_lobby(p_session_id uuid)
returns smallint language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  if v_session.status='lobby' then
    delete from public.trottl_special_players as p where p.session_id=p_session_id
      and p.last_seen_at<pg_catalog.clock_timestamp()-interval '90 seconds' and p.user_id<>auth.uid();
    return public.reconcile_trottl_special_members_locked(p_session_id);
  end if;
  return v_session.player_count;
end; $$;

create function public.set_trottl_special_ready(p_session_id uuid,p_ready boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions; v_avatar text;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  if v_session.status<>'lobby' then raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_IN_LOBBY'; end if;
  if p_ready is null then raise exception using errcode='22023',message='Ready value required'; end if;
  select p.avatar_id into v_avatar from public.trottl_special_players as p where p.session_id=p_session_id and p.user_id=auth.uid();
  if p_ready and not coalesce(public.is_valid_trottl_avatar_id(v_avatar),false) then
    raise exception using errcode='P0001',message='TROTTL_SPECIAL_AVATAR_REQUIRED';
  end if;
  update public.trottl_special_players as p set is_ready=p_ready,last_seen_at=pg_catalog.clock_timestamp()
    where p.session_id=p_session_id and p.user_id=auth.uid();
  return p_ready;
end; $$;

create function public.set_trottl_special_avatar(p_session_id uuid,p_avatar_id text)
returns text language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  if v_session.status<>'lobby' then raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_IN_LOBBY'; end if;
  if not coalesce(public.is_valid_trottl_avatar_id(p_avatar_id),false) then
    raise exception using errcode='22023',message='TROTTL_SPECIAL_INVALID_AVATAR';
  end if;
  if exists(select 1 from public.trottl_special_players as p where p.session_id=p_session_id and p.user_id=auth.uid() and p.is_ready) then
    raise exception using errcode='P0001',message='TROTTL_SPECIAL_PLAYER_ALREADY_READY';
  end if;
  update public.trottl_special_players as p set avatar_id=p_avatar_id,last_seen_at=pg_catalog.clock_timestamp()
    where p.session_id=p_session_id and p.user_id=auth.uid();
  update public.app_profiles as p set trottl_avatar_id=p_avatar_id where p.user_id=auth.uid();
  return p_avatar_id;
end; $$;

create function public.start_trottl_special_session(p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions; v_count smallint; v_first smallint;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  if v_session.status<>'lobby' then raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_IN_LOBBY'; end if;
  update public.trottl_special_players as p set last_seen_at=pg_catalog.clock_timestamp()
    where p.session_id=p_session_id and p.user_id=auth.uid();
  perform public.cleanup_trottl_special_lobby(p_session_id);
  select s.* into v_session from public.trottl_special_sessions as s where s.id=p_session_id for update;
  if v_session.host_user_id<>auth.uid() then raise exception using errcode='42501',message='Only the host may start'; end if;
  select pg_catalog.count(*)::smallint,pg_catalog.min(p.seat_index)::smallint into v_count,v_first
    from public.trottl_special_players as p where p.session_id=p_session_id;
  if v_count<3 or v_count>8 then raise exception using errcode='P0001',message='TROTTL_SPECIAL_INVALID_PLAYER_COUNT'; end if;
  if exists(select 1 from public.trottl_special_players as p where p.session_id=p_session_id
    and (not p.is_ready or not coalesce(public.is_valid_trottl_avatar_id(p.avatar_id),false))) then
    raise exception using errcode='P0001',message='TROTTL_SPECIAL_PLAYERS_NOT_READY';
  end if;
  update public.trottl_special_sessions as s set status='playing',started_at=pg_catalog.clock_timestamp(),
    player_count=v_count,current_turn_seat=v_first where s.id=p_session_id;
  return p_session_id;
end; $$;

create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  delete from public.trottl_special_players as p where p.session_id=p_session_id and p.user_id=auth.uid();
  perform public.reconcile_trottl_special_members_locked(p_session_id);
  return true;
end; $$;

create function public.kick_trottl_special_player(p_session_id uuid,p_target_player_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions;
begin
  v_session:=public.lock_trottl_special_session(p_session_id);
  if v_session.status<>'lobby' or v_session.host_user_id<>auth.uid() or p_target_player_id=auth.uid() then
    raise exception using errcode='42501',message='TROTTL_SPECIAL_KICK_NOT_ALLOWED';
  end if;
  delete from public.trottl_special_players as p where p.session_id=p_session_id and p.user_id=p_target_player_id;
  if not found then raise exception using errcode='P0001',message='TROTTL_SPECIAL_TARGET_NOT_FOUND'; end if;
  perform public.reconcile_trottl_special_members_locked(p_session_id);
  return true;
end; $$;

-- Only public lifecycle RPCs callable by authenticated clients. Helpers are internal.
revoke all on function public.lock_trottl_special_session(uuid),
  public.reconcile_trottl_special_members_locked(uuid) from public,anon,authenticated;
revoke all on function public.is_trottl_special_member(uuid), public.get_trottl_special_rooms(),
  public.join_trottl_special_room(smallint),public.heartbeat_trottl_special_session(uuid),
  public.cleanup_trottl_special_lobby(uuid),public.set_trottl_special_ready(uuid,boolean),
  public.set_trottl_special_avatar(uuid,text),public.start_trottl_special_session(uuid),
  public.leave_trottl_special_session(uuid),public.kick_trottl_special_player(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_trottl_special_member(uuid), public.get_trottl_special_rooms(),
  public.join_trottl_special_room(smallint),public.heartbeat_trottl_special_session(uuid),
  public.cleanup_trottl_special_lobby(uuid),public.set_trottl_special_ready(uuid,boolean),
  public.set_trottl_special_avatar(uuid,text),public.start_trottl_special_session(uuid),
  public.leave_trottl_special_session(uuid),public.kick_trottl_special_player(uuid,uuid) to authenticated;
alter table public.trottl_special_sessions replica identity full;
alter table public.trottl_special_players replica identity full;
do $$ begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.trottl_special_sessions,public.trottl_special_players;
  end if;
end; $$;
commit;
