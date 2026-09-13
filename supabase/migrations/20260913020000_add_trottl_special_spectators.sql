begin;

-- Status vocabulary only. No elimination, finale or winner transitions.
alter table public.trottl_special_players add column lifecycle_status text not null default 'alive'
  check (lifecycle_status in ('alive','eliminated','left'));
create table public.trottl_special_spectators (
  session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
  user_id uuid not null references public.app_profiles(user_id),
  joined_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_seen_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(session_id,user_id)
);
create index trottl_special_spectators_reconnect on public.trottl_special_spectators(user_id,session_id);
alter table public.trottl_special_spectators enable row level security;
revoke all on public.trottl_special_spectators from public,anon,authenticated;
grant select on public.trottl_special_spectators to authenticated;

create function public.is_trottl_special_viewer(p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.trottl_special_players as p where p.session_id=p_session_id
      and p.user_id=(select auth.uid()) and p.lifecycle_status='alive')
    or exists(select 1 from public.trottl_special_spectators as v where v.session_id=p_session_id and v.user_id=(select auth.uid()));
$$;
create policy trottl_special_spectator_read on public.trottl_special_spectators for select to authenticated
  using(public.is_trottl_special_viewer(session_id));
drop policy trottl_special_members on public.trottl_special_players;
create policy trottl_special_members on public.trottl_special_players for select to authenticated
  using(public.is_trottl_special_viewer(session_id));

-- Both membership writers serialize on the same room and session row.
-- Prevents cross-table player+spectator duplication even under concurrent calls.
create function public.guard_trottl_special_membership_roles()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_slot smallint;
begin
  select s.room_slot into v_slot from public.trottl_special_sessions as s where s.id=new.session_id;
  perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
  perform 1 from public.trottl_special_sessions as s where s.id=new.session_id for update;
  if tg_table_name='trottl_special_spectators' then
    if exists(select 1 from public.trottl_special_players as p where p.session_id=new.session_id
      and p.user_id=new.user_id and p.lifecycle_status='alive') then
      raise exception using errcode='23514',message='TROTTL_SPECIAL_ALREADY_PLAYER';
    end if;
  elsif new.lifecycle_status='alive' and exists(select 1 from public.trottl_special_spectators as v
      where v.session_id=new.session_id and v.user_id=new.user_id) then
    raise exception using errcode='23514',message='TROTTL_SPECIAL_ALREADY_SPECTATOR';
  end if;
  return new;
end; $$;
create trigger trottl_special_spectator_role_guard before insert or update on public.trottl_special_spectators
  for each row execute function public.guard_trottl_special_membership_roles();
create trigger trottl_special_player_role_guard before insert or update of session_id,user_id,lifecycle_status on public.trottl_special_players
  for each row execute function public.guard_trottl_special_membership_roles();

-- Existing Ready/Avatar/Host/Start/Leave/Cleanup RPCs all call this player-only guard.
create or replace function public.lock_trottl_special_session(p_session_id uuid)
returns public.trottl_special_sessions language plpgsql security definer set search_path='' as $$
declare v_slot smallint; v_session public.trottl_special_sessions;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select s.room_slot into v_slot from public.trottl_special_sessions as s where s.id=p_session_id;
  if not found then raise exception using errcode='P0001',message='TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
  select s.* into v_session from public.trottl_special_sessions as s where s.id=p_session_id for update;
  if v_session.status='finished' or not exists(select 1 from public.trottl_special_players as p
    where p.session_id=p_session_id and p.user_id=auth.uid() and p.lifecycle_status='alive') then
    raise exception using errcode='42501',message='TROTTL_SPECIAL_NOT_MEMBER';
  end if;
  return v_session;
end; $$;

create function public.join_trottl_special_spectator(p_session_id uuid,p_room_slot smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_session public.trottl_special_sessions;
begin
  if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_room_slot is null or p_room_slot not in (1,2) then raise exception using errcode='22023',message='Invalid room'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,p_room_slot::integer);
  select s.* into v_session from public.trottl_special_sessions as s where s.id=p_session_id for update;
  if not found or v_session.room_slot<>p_room_slot or v_session.status<>'playing' then
    raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_PLAYING';
  end if;
  if exists(select 1 from public.trottl_special_players as p where p.session_id=p_session_id
    and p.user_id=v_user and p.lifecycle_status='alive') then
    raise exception using errcode='42501',message='TROTTL_SPECIAL_ALREADY_PLAYER';
  end if;
  insert into public.trottl_special_spectators(session_id,user_id) values(p_session_id,v_user)
    on conflict(session_id,user_id) do update set last_seen_at=pg_catalog.clock_timestamp();
  return p_session_id;
end; $$;

create function public.leave_trottl_special_spectator(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_slot smallint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select s.room_slot into v_slot from public.trottl_special_sessions as s where s.id=p_session_id;
  if found then perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer); end if;
  delete from public.trottl_special_spectators as v where v.session_id=p_session_id and v.user_id=auth.uid();
  return true;
end; $$;

create function public.heartbeat_trottl_special_spectator(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=pg_catalog.clock_timestamp(); v_slot smallint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select s.room_slot into v_slot from public.trottl_special_sessions as s where s.id=p_session_id and s.status='playing';
  if not found then raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_PLAYING'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
  perform 1 from public.trottl_special_sessions as s where s.id=p_session_id and s.status='playing' for update;
  if not found then raise exception using errcode='P0001',message='TROTTL_SPECIAL_NOT_PLAYING'; end if;
  update public.trottl_special_spectators as v set last_seen_at=v_now where v.session_id=p_session_id and v.user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='TROTTL_SPECIAL_NOT_SPECTATOR'; end if;
  return v_now;
end; $$;

create function public.get_trottl_special_membership(p_session_id uuid)
returns table(membership_role text,spectator_count integer)
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.trottl_special_players as p where p.session_id=p_session_id
      and p.user_id=(select auth.uid()) and p.lifecycle_status='alive') then 'player'
    when exists(select 1 from public.trottl_special_spectators as v where v.session_id=p_session_id
      and v.user_id=(select auth.uid())) then 'spectator' else 'none' end,
    (select pg_catalog.count(*)::integer from public.trottl_special_spectators as v
      join public.trottl_special_sessions as s on s.id=v.session_id
      where v.session_id=p_session_id and s.status='playing'
        and v.last_seen_at>pg_catalog.clock_timestamp()-interval '120 seconds')
  where (select auth.uid()) is not null;
$$;
create function public.get_trottl_special_memberships()
returns table(session_id uuid,membership_role text,room_slot smallint)
language sql stable security definer set search_path='' as $$
  select p.session_id,'player'::text,s.room_slot from public.trottl_special_players as p
    join public.trottl_special_sessions as s on s.id=p.session_id
    where p.user_id=(select auth.uid()) and p.lifecycle_status='alive' and s.status in ('lobby','playing')
  union all
  select v.session_id,'spectator'::text,s.room_slot from public.trottl_special_spectators as v
    join public.trottl_special_sessions as s on s.id=v.session_id
    where v.user_id=(select auth.uid()) and s.status='playing';
$$;
create or replace function public.get_trottl_special_rooms()
returns table(room_slot smallint,session_id uuid,session_status text,player_count smallint,is_member boolean)
language sql stable security definer set search_path='' as $$
  select slot.n,s.id,s.status,coalesce(s.player_count,0)::smallint,
    coalesce(public.is_trottl_special_viewer(s.id),false)
  from (values(1::smallint),(2::smallint)) as slot(n)
  left join public.trottl_special_sessions as s on s.room_slot=slot.n and s.status in ('lobby','playing')
  where (select auth.uid()) is not null order by slot.n;
$$;

revoke all on function public.guard_trottl_special_membership_roles() from public,anon,authenticated;
revoke all on function public.is_trottl_special_viewer(uuid),public.join_trottl_special_spectator(uuid,smallint),
  public.leave_trottl_special_spectator(uuid),public.heartbeat_trottl_special_spectator(uuid),
  public.get_trottl_special_membership(uuid),public.get_trottl_special_memberships() from public,anon,authenticated;
grant execute on function public.is_trottl_special_viewer(uuid),public.join_trottl_special_spectator(uuid,smallint),
  public.leave_trottl_special_spectator(uuid),public.heartbeat_trottl_special_spectator(uuid),
  public.get_trottl_special_membership(uuid),public.get_trottl_special_memberships() to authenticated;
alter table public.trottl_special_spectators replica identity full;
do $$ begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.trottl_special_spectators;
  end if;
end; $$;
commit;
