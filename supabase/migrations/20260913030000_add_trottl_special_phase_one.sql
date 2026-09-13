begin;

alter table public.trottl_special_players drop constraint trottl_special_players_lifecycle_status_check;
alter table public.trottl_special_players add column lives smallint not null default 3;
alter table public.trottl_special_players add column critical_used boolean not null default false;
alter table public.trottl_special_players add constraint trottl_special_player_life_state check (
  lives between 0 and 3 and (
    (lifecycle_status='alive' and lives>0) or
    (lifecycle_status='critical' and lives=0 and critical_used) or
    (lifecycle_status='eliminated' and lives=0) or lifecycle_status='left'));

-- Seated eliminated members retain read access and presence, never gameplay authority.
create or replace function public.is_trottl_special_viewer(p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id
   and p.user_id=auth.uid() and p.lifecycle_status<>'left') or exists(
   select 1 from public.trottl_special_spectators v where v.session_id=p_session_id and v.user_id=auth.uid());
$$;
create or replace function public.get_trottl_special_membership(p_session_id uuid)
returns table(membership_role text,spectator_count integer)
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id
   and p.user_id=auth.uid() and p.lifecycle_status<>'left') then 'player'
   when exists(select 1 from public.trottl_special_spectators v where v.session_id=p_session_id
   and v.user_id=auth.uid()) then 'spectator' else 'none' end,
   (select count(*)::integer from public.trottl_special_spectators v join public.trottl_special_sessions s on s.id=v.session_id
    where v.session_id=p_session_id and s.status='playing' and v.last_seen_at>clock_timestamp()-interval '120 seconds')
 where auth.uid() is not null;
$$;
create or replace function public.get_trottl_special_memberships()
returns table(session_id uuid,membership_role text,room_slot smallint)
language sql stable security definer set search_path='' as $$
 select p.session_id,'player'::text,s.room_slot from public.trottl_special_players p
 join public.trottl_special_sessions s on s.id=p.session_id where p.user_id=auth.uid()
 and p.lifecycle_status<>'left' and s.status in ('lobby','playing') union all
 select v.session_id,'spectator'::text,s.room_slot from public.trottl_special_spectators v
 join public.trottl_special_sessions s on s.id=v.session_id where v.user_id=auth.uid() and s.status='playing';
$$;
create or replace function public.guard_trottl_special_membership_roles()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_slot smallint;
begin
 select room_slot into v_slot from public.trottl_special_sessions where id=new.session_id;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 perform 1 from public.trottl_special_sessions where id=new.session_id for update;
 if tg_table_name='trottl_special_spectators' then
  if exists(select 1 from public.trottl_special_players p where p.session_id=new.session_id and p.user_id=new.user_id
    and p.lifecycle_status<>'left') then raise exception 'TROTTL_SPECIAL_ALREADY_PLAYER'; end if;
 elsif new.lifecycle_status<>'left' and exists(select 1 from public.trottl_special_spectators v
    where v.session_id=new.session_id and v.user_id=new.user_id) then raise exception 'TROTTL_SPECIAL_ALREADY_SPECTATOR';
 end if;
 return new;
end; $$;

-- All internal helpers are revoked below. Caller must already hold room + session lock.
create function public.special_advance_locked(p_id uuid,p_after integer,p_seq bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_player public.trottl_special_players; v_state jsonb; v_count integer; v_alive integer;
begin
 select game_state into v_state from public.trottl_special_sessions where id=p_id;
 select count(*),count(*) filter(where lifecycle_status='alive') into v_count,v_alive from public.trottl_special_players where session_id=p_id and lifecycle_status in ('alive','critical');
 -- Future finale hook: v_alive=2, with v_count distinguishing pending rescues. No match completion here.
 select * into v_player from public.trottl_special_players where session_id=p_id and lifecycle_status in ('alive','critical')
 order by case when seat_index>p_after then 0 else 1 end,seat_index limit 1;
 update public.trottl_special_sessions set current_turn_seat=v_player.seat_index,
 game_state=jsonb_build_object('phase',case when v_count=0 then 'awaiting_players' when v_player.lifecycle_status='critical'
   then 'rescue_roll' else 'awaiting_roll' end,'actor',v_player.user_id,'actor_seat',v_player.seat_index,'roll_seq',p_seq,
   'trottl',v_state->'trottl','points',coalesce((v_state->>'points')::integer,0),'eligible_count',v_count,'alive_count',v_alive,'revision',coalesce((v_state->>'revision')::bigint,0)+1,
   'last_roll',v_state->'last_roll','last_roll_seq',v_state->'last_roll_seq') where id=p_id;
end; $$;

create function public.special_lose_life_locked(p_id uuid,p_target uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_player public.trottl_special_players; v_status text;
begin
 select * into v_player from public.trottl_special_players where session_id=p_id and user_id=p_target for update;
 if not found or v_player.lifecycle_status<>'alive' or v_player.lives<1 then raise exception 'TROTTL_SPECIAL_INVALID_LIFE_TARGET'; end if;
 v_status:=case when v_player.lives>1 then 'alive' when v_player.critical_used then 'eliminated' else 'critical' end;
 update public.trottl_special_players set lives=lives-1,lifecycle_status=v_status,
   critical_used=critical_used or v_status='critical' where session_id=p_id and user_id=p_target;
 if v_player.lives=1 then
  update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('trottl',null,'points',0)
   where id=p_id and game_state->>'trottl'=p_target::text;
 end if;
 return v_status;
end; $$;
create function public.special_restore_life_locked(p_id uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.trottl_special_players set lives=1,lifecycle_status='alive' where session_id=p_id and user_id=p_target
   and lifecycle_status='critical' and lives=0 and critical_used;
 if not found then raise exception 'TROTTL_SPECIAL_INVALID_RESCUE'; end if;
end; $$;

create function public.special_initialize_game()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='lobby' and new.status='playing' then
  update public.trottl_special_players set lives=3,critical_used=false,lifecycle_status='alive' where session_id=new.id;
  perform public.special_advance_locked(new.id,-1,0);
 end if;
 return new;
end; $$;
create trigger special_initialize_game after update of status on public.trottl_special_sessions
 for each row execute function public.special_initialize_game();

-- Single intent gateway: no client can supply die result, life count, points or turn.
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.trottl_special_sessions; g jsonb; v_user uuid:=auth.uid(); v_actor uuid; v_trottl uuid;
 v_slot smallint; v_seat integer; v_lifecycle text; v_result integer; v_seq bigint; v_total integer; v_used integer;
 v_drinks jsonb; v_acks jsonb; v_status text; v_now timestamptz:=clock_timestamp();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into v_session from public.trottl_special_sessions where id=p_session_id for update;
 if v_session.status<>'playing' or not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_PLAYING'; end if;
 g:=v_session.game_state; v_seq:=coalesce((g->>'roll_seq')::bigint,0);
 if p_roll_seq is distinct from v_seq then raise exception 'TROTTL_SPECIAL_STALE_ACTION'; end if;
 v_actor:=(g->>'actor')::uuid; v_trottl:=(g->>'trottl')::uuid;
 select seat_index,lifecycle_status into v_seat,v_lifecycle from public.trottl_special_players where session_id=p_session_id and user_id=v_actor;
 v_seat:=coalesce(v_seat,(g->>'actor_seat')::integer);
 if p_action='resolve' then
  if g->>'phase' not in ('rolling','trottl_peak','placeholder') or v_now<(g->>'deadline')::timestamptz then return p_session_id; end if;
  if g->>'phase'='placeholder' then perform public.special_advance_locked(p_session_id,v_seat,v_seq); return p_session_id; end if;
  if g->>'phase'='trottl_peak' then
   v_status:=public.special_lose_life_locked(p_session_id,v_trottl);
   select game_state into g from public.trottl_special_sessions where id=p_session_id;
   g:=g||jsonb_build_object('points',0,'phase','drink_ack','deadline',null);
   if v_status='eliminated' then
    update public.trottl_special_sessions set game_state=g||jsonb_build_object('drinks','{}'::jsonb,'ack_waived',v_trottl) where id=p_session_id;
    perform public.special_advance_locked(p_session_id,v_seat,v_seq); return p_session_id;
   end if;
  else
   v_result:=(g->>'result')::integer;
   if coalesce((g->>'rescue')::boolean,false) then
    if v_result=6 then
     perform public.special_restore_life_locked(p_session_id,v_actor);
     g:=g||jsonb_build_object('phase','awaiting_roll','rescue',false,'deadline',null,'rescued',true);
    else
     update public.trottl_special_players set lifecycle_status='eliminated' where session_id=p_session_id and user_id=v_actor and lifecycle_status='critical';
     perform public.special_advance_locked(p_session_id,v_seat,v_seq); return p_session_id;
    end if;
   elsif v_result in (1,2) then g:=g||jsonb_build_object('phase','distribution','total',v_result,'drinks','{}'::jsonb,'acks','{}'::jsonb);
   elsif v_result=3 then
    if v_trottl is null or v_trottl=v_actor then
     if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id<>v_actor and lifecycle_status='alive' and lives>0) then
      g:=g||jsonb_build_object('phase','placeholder','deadline',v_now+interval '1 second');
     else g:=g||jsonb_build_object('phase','choose_trottl'); end if;
    else
     g:=g||jsonb_build_object('points',(g->>'points')::integer+1,'drinks',jsonb_build_object(v_trottl::text,1),'acks','{}'::jsonb,
       'phase',case when (g->>'points')::integer=2 then 'trottl_peak' else 'drink_ack' end,'deadline',v_now+interval '600 milliseconds');
    end if;
   else g:=g||jsonb_build_object('phase','placeholder','deadline',v_now+interval '1 second'); end if;
  end if;
 else
  if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=v_user and lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_PLAYER_REQUIRED'; end if;
  if p_action<>'ack' and v_actor is distinct from v_user then raise exception 'TROTTL_SPECIAL_NOT_ACTOR'; end if;
  if p_action='roll' and g->>'phase' in ('awaiting_roll','rescue_roll') then
   if v_lifecycle not in ('alive','critical') then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR'; end if;
   v_result:=floor(random()*6)::integer+1;
   g:=g||jsonb_build_object('phase','rolling','rescue',v_lifecycle='critical','result',v_result,'roll_seq',v_seq+1,
     'last_roll',v_result,'last_roll_seq',v_seq+1,'roll_started_at',v_now,'deadline',v_now+interval '2600 milliseconds');
  elsif p_action in ('assign','reset','confirm') and g->>'phase'='distribution' then
   v_drinks:=g->'drinks'; v_total:=(g->>'total')::integer;
   select coalesce(sum(value::integer),0) into v_used from jsonb_each_text(v_drinks);
   if p_action='assign' then
    if v_used>=v_total or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=p_target
      and lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_INVALID_DRINK_TARGET'; end if;
    g:=g||jsonb_build_object('drinks',v_drinks||jsonb_build_object(p_target::text,coalesce((v_drinks->>p_target::text)::integer,0)+1));
   elsif p_action='reset' then g:=g||jsonb_build_object('drinks','{}'::jsonb);
   else
    if v_used<>v_total then raise exception 'TROTTL_SPECIAL_INCOMPLETE_DISTRIBUTION'; end if;
    g:=g||jsonb_build_object('phase','drink_ack','acks','{}'::jsonb);
   end if;
  elsif p_action='choose' and g->>'phase'='choose_trottl' then
   if p_target=v_user or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=p_target
    and lifecycle_status='alive' and lives>0) then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_TARGET'; end if;
   g:=g||jsonb_build_object('trottl',p_target,'phase','drink_ack','drinks',jsonb_build_object(p_target::text,1),'acks','{}'::jsonb);
  elsif p_action='ack' and g->>'phase'='drink_ack' then
   if not (g->'drinks' ? v_user::text) or g->'acks' ? v_user::text then raise exception 'TROTTL_SPECIAL_INVALID_ACK'; end if;
   v_acks:=(g->'acks')||jsonb_build_object(v_user::text,true); g:=g||jsonb_build_object('acks',v_acks);
   if not exists(select 1 from jsonb_each_text(g->'drinks') d where not (v_acks ? d.key)) then
    update public.trottl_special_sessions set game_state=g where id=p_session_id;
    perform public.special_advance_locked(p_session_id,v_seat,v_seq); return p_session_id;
   end if;
  else raise exception 'TROTTL_SPECIAL_INVALID_PHASE'; end if;
 end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_session_id;
 return p_session_id;
end; $$;

create or replace function public.heartbeat_trottl_special_session(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id and status in ('lobby','playing');
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 perform 1 from public.trottl_special_sessions where id=p_session_id for update;
 update public.trottl_special_players set last_seen_at=v_now where session_id=p_session_id and user_id=auth.uid() and lifecycle_status<>'left';
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 return v_now;
end; $$;

-- Leave must also work for eliminated players; pending ACKs cannot strand a turn.
create or replace function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; v_slot smallint; v_user uuid:=auth.uid(); v_seat integer; g jsonb;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 select seat_index into v_seat from public.trottl_special_players where session_id=p_session_id and user_id=v_user;
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=v_user;
 g:=s.game_state;
 if g->>'phase'='trottl_peak' and g->>'actor'=v_user::text and g->>'trottl'<>v_user::text then
  perform public.special_lose_life_locked(p_session_id,(g->>'trottl')::uuid);
  select game_state into g from public.trottl_special_sessions where id=p_session_id;
  g:=g||jsonb_build_object('points',0,'phase','drink_ack');
  if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=(s.game_state->>'trottl')::uuid and lifecycle_status='eliminated') then
   g:=g||jsonb_build_object('drinks','{}'::jsonb);
  end if;
 end if;
 if g->>'trottl'=v_user::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 g:=g||jsonb_build_object('drinks',coalesce(g->'drinks','{}'::jsonb)-v_user::text,'acks',coalesce(g->'acks','{}'::jsonb)-v_user::text);
 if s.status='playing' and g->>'actor'=v_user::text and g->>'phase'='drink_ack' then
  g:=g||jsonb_build_object('actor',null,'actor_seat',v_seat);
 end if;
 g:=g||jsonb_build_object('revision',coalesce((g->>'revision')::bigint,0)+1);
 update public.trottl_special_sessions set game_state=g where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if s.status='playing' then
  if g->>'actor'=v_user::text or (g->>'phase'='drink_ack' and not exists(select 1 from jsonb_each_text(g->'drinks') d where not (g->'acks' ? d.key))) then
   perform public.special_advance_locked(p_session_id,coalesce((g->>'actor_seat')::integer,v_seat),(g->>'roll_seq')::bigint);
  elsif g->>'phase'='trottl_peak' and g->>'trottl' is null then
   update public.trottl_special_sessions set game_state=g||jsonb_build_object('phase','drink_ack') where id=p_session_id;
   perform public.special_advance_locked(p_session_id,(select seat_index from public.trottl_special_players where session_id=p_session_id and user_id=(g->>'actor')::uuid),(g->>'roll_seq')::bigint);
  elsif g->>'phase'='choose_trottl' and not exists(select 1 from public.trottl_special_players where session_id=p_session_id
    and lifecycle_status='alive' and user_id<>(g->>'actor')::uuid) then
   update public.trottl_special_sessions set game_state=g||jsonb_build_object('phase','placeholder','deadline',clock_timestamp()+interval '1 second') where id=p_session_id;
  end if;
  if exists(select 1 from public.trottl_special_sessions where id=p_session_id and game_state->>'actor' is null and game_state->>'phase'='drink_ack') then
   update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id;
  end if;
 end if;
 return true;
end; $$;

-- Deferred invariant covers both state writes and life changes, including future life-engine callers.
create function public.special_validate_game_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; s public.trottl_special_sessions;
begin
 if tg_table_name='trottl_special_sessions' then v_id:=new.id; else v_id:=coalesce(new.session_id,old.session_id); end if;
 select * into s from public.trottl_special_sessions where id=v_id;
 if not found or s.status<>'playing' then return null; end if;
 if s.game_state->>'phase' is null or s.game_state->>'phase' not in
  ('awaiting_roll','rescue_roll','rolling','distribution','choose_trottl','drink_ack','trottl_peak','placeholder','awaiting_players')
  or coalesce((s.game_state->>'points')::integer,-1) not between 0 and 3
  or coalesce((s.game_state->>'roll_seq')::bigint,-1)<0 then raise exception 'TROTTL_SPECIAL_INVALID_STATE'; end if;
 if s.game_state->>'trottl' is not null and not exists(select 1 from public.trottl_special_players p
  where p.session_id=v_id and p.user_id=(s.game_state->>'trottl')::uuid and p.lifecycle_status='alive' and p.lives>0)
  then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_STATE'; end if;
 if s.game_state->>'phase'<>'awaiting_players' and not (s.game_state->>'phase'='drink_ack' and s.game_state->>'actor' is null)
  and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id
  and p.user_id=(s.game_state->>'actor')::uuid and p.seat_index=s.current_turn_seat and p.lifecycle_status in ('alive','critical'))
  then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR_STATE'; end if;
 return null;
end; $$;
create constraint trigger special_validate_session after insert or update on public.trottl_special_sessions
 deferrable initially deferred for each row execute function public.special_validate_game_state();
create constraint trigger special_validate_player after insert or update or delete on public.trottl_special_players
 deferrable initially deferred for each row execute function public.special_validate_game_state();
do $$ declare s record; begin
 for s in select id from public.trottl_special_sessions where status='playing' loop
  perform public.special_advance_locked(s.id,-1,0);
 end loop;
end; $$;

revoke all on function public.special_advance_locked(uuid,integer,bigint),public.special_lose_life_locked(uuid,uuid),
 public.special_restore_life_locked(uuid,uuid),public.special_initialize_game(),public.special_validate_game_state(),public.act_trottl_special_game(uuid,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.act_trottl_special_game(uuid,text,bigint,uuid) to authenticated;
-- Existing FULL replica identity/publication already covers session game_state and player updates.
commit;
