begin;

create table public.trottl_special_poison_fish_runs (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null, player_id uuid not null,
 simulation_version integer not null default 1 check (simulation_version=1),
 movement_seed bigint not null check (movement_seed between 1 and 2147483646),
 events jsonb not null default '[]'::jsonb check (jsonb_typeof(events)='array'),
 score integer not null default 0, completed boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(session_id,round_id,player_id), unique(session_id,round_id,movement_seed)
);
alter table public.trottl_special_poison_fish_runs enable row level security;
revoke all on public.trottl_special_poison_fish_runs from anon,authenticated;
update public.trottl_special_minigame_registry set title='Giftfisch',implemented=true,enabled=true where id='special_minigame_07';

create function public.special_poison_fish_config(p_version integer) returns jsonb language plpgsql immutable security definer set search_path='' as $$
begin
 if p_version<>1 then raise exception 'SPECIAL_POISON_FISH_VERSION'; end if;
 return jsonb_build_object('normal',8,'gold',2,'poison',3,'duration_ms',10000,'max_events',500,
  'hit_x',0.08,'hit_y',0.065,'speed_min_units',32,'speed_range_units',11);
end; $$;

create function public.special_poison_fish_hash(p_seed bigint,p_slot integer,p_spawn integer,p_channel integer)
returns bigint language sql immutable security definer set search_path='' as $$
 with seed_mix as (select mod((p_seed+p_slot::bigint*104729+p_spawn::bigint*1000003+p_channel::bigint*7919)*48271,2147483647) as value)
 select mod(value*48271+mod(value,65521)*mod(value,32749),2147483647) from seed_mix;
$$;

-- All numbers use decimal arithmetic so replay is independent of SQL query timing.
create function public.special_poison_fish_state(p_seed bigint,p_slot integer,p_spawn integer,p_spawn_at integer,
 p_previous_x numeric,p_previous_y numeric,p_elapsed integer,p_version integer) returns numeric[]
language plpgsql immutable security definer set search_path='' as $$
declare c jsonb:=public.special_poison_fish_config(p_version);x numeric;y numeric;vx numeric;vy numeric;speed integer;travel numeric;px numeric;py numeric;
begin
 x:=0.1+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,1),801)::numeric/1000;
 y:=0.09+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,2),821)::numeric/1000;
 if p_previous_x is not null then
  x:=0.1+mod(mod(p_previous_x+0.25+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,1),201)::numeric/1000-0.1,0.8)+0.8,0.8);
  y:=0.09+mod(mod(p_previous_y+0.19+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,2),201)::numeric/1000-0.09,0.82)+0.82,0.82);
 end if;
 speed:=(c->>'speed_min_units')::integer+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,3),(c->>'speed_range_units')::integer)::integer;
 vx:=(case when mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,5),2)=1 then 1 else -1 end)*speed*(65+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,4),11))/10000000::numeric;
 vy:=(case when mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,7),2)=1 then 1 else -1 end)*speed*(65+mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,6),11))/10000000::numeric;
 travel:=greatest(0,p_elapsed-p_spawn_at);
 px:=mod(mod(x-0.1+vx*travel,1.6)+1.6,1.6);
 py:=mod(mod(y-0.09+vy*travel,1.64)+1.64,1.64);
 return array[0.1+case when px<=0.8 then px else 1.6-px end,
  0.09+case when py<=0.82 then py else 1.64-py end,
  mod(public.special_poison_fish_hash(p_seed,p_slot,p_spawn,8),100000)::numeric,vx,vy];
end; $$;

-- A complete server replay, including misses, overlap ordering and same-type respawn.
create function public.special_poison_fish_replay(p_seed bigint,p_events jsonb,p_version integer) returns integer
language plpgsql immutable security definer set search_path='' as $$
declare c jsonb:=public.special_poison_fish_config(p_version);v jsonb;t integer;x numeric;y numeric;last_t integer:=-1;window_start integer:=-100;window_count integer:=0;
 normal_count integer:=(c->>'normal')::integer;gold_count integer:=(c->>'gold')::integer;total integer:=((c->>'normal')::integer+(c->>'gold')::integer+(c->>'poison')::integer);
 indices integer[]:='{}';spawn_times integer[]:='{}';previous_x numeric[]:='{}';previous_y numeric[]:='{}';slot integer;point numeric[];best_slot integer;best_z numeric;best_x numeric;best_y numeric;score integer:=0;
begin
 if p_seed not between 1 and 2147483646 or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>(c->>'max_events')::integer then raise exception 'SPECIAL_INVALID_POISON_FISH_EVENTS';end if;
 for slot in 1..total loop indices:=array_append(indices,0);spawn_times:=array_append(spawn_times,0);previous_x:=array_append(previous_x,null);previous_y:=array_append(previous_y,null);end loop;
 for v in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'t') is distinct from 'number' or jsonb_typeof(v->'x') is distinct from 'number' or jsonb_typeof(v->'y') is distinct from 'number' then raise exception 'SPECIAL_INVALID_POISON_FISH_EVENT';end if;
  t:=(v->>'t')::integer;x:=(v->>'x')::numeric;y:=(v->>'y')::numeric;
  if t<last_t or t<0 or t>=10000 or x<0 or x>1 or y<0 or y>1 then raise exception 'SPECIAL_INVALID_POISON_FISH_EVENT';end if;
  if t>=window_start+100 then window_start:=t;window_count:=0;end if;
  window_count:=window_count+1;
  if window_count>25 then raise exception 'SPECIAL_POISON_FISH_EVENT_SPAM';end if;
  last_t:=t;best_slot:=null;best_z:=null;
  for slot in 0..total-1 loop
   point:=public.special_poison_fish_state(p_seed,slot,indices[slot+1],spawn_times[slot+1],previous_x[slot+1],previous_y[slot+1],t,p_version);
   if abs(x-point[1])<=(c->>'hit_x')::numeric and abs(y-point[2])<=(c->>'hit_y')::numeric
    and (best_slot is null or point[3]>best_z or (point[3]=best_z and slot>best_slot)) then
    best_slot:=slot;best_z:=point[3];best_x:=point[1];best_y:=point[2];
   end if;
  end loop;
  if best_slot is not null then
   score:=score+case when best_slot<normal_count then 1 when best_slot<normal_count+gold_count then 3 else -3 end;
   indices[best_slot+1]:=indices[best_slot+1]+1;spawn_times[best_slot+1]:=t;previous_x[best_slot+1]:=best_x;previous_y[best_slot+1]:=best_y;
  end if;
 end loop;
 return score;
end; $$;

create function public.special_poison_fish_begin_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_round_id uuid;g jsonb;p jsonb;runs jsonb:='{}'::jsonb;seed bigint;start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 v_round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_07','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  loop
   seed:=1+floor(pg_catalog.random()*2147483646)::bigint;
   exit when not exists(select 1 from public.trottl_special_poison_fish_runs where session_id=p_id and round_id=v_round_id and movement_seed=seed);
  end loop;
  insert into public.trottl_special_poison_fish_runs(session_id,round_id,player_id,movement_seed)
  values(p_id,v_round_id,(p->>'player_id')::uuid,seed);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Giftfisch','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds',
  'start_at',start_at,'end_at',start_at+interval '10.4 seconds','runs',runs,'simulation_version',1),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_poison_fish_view(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_poison_fish_runs;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active' or s.game_state->'minigame'->>'minigame_type'<>'special_minigame_07' then return null;end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;
 else raise exception 'SPECIAL_POISON_FISH_VIEW_REQUIRED';end if;
 select * into r from public.trottl_special_poison_fish_runs where session_id=p_session_id and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid and player_id=target;
 if not found then return null;end if;
 return jsonb_build_object('player_id',r.player_id,'movement_seed',r.movement_seed,'simulation_version',r.simulation_version,
  'events',r.events,'score',r.score,'completed',r.completed);
end; $$;

create function public.special_poison_fish_finalize_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;v_round_id uuid;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_07' then return;end if;
 v_round_id:=(m->>'minigame_id')::uuid;
 if exists(select 1 from public.trottl_special_poison_fish_runs where session_id=p_id and round_id=v_round_id and not completed) then return;end if;
 select jsonb_agg(jsonb_build_object('player_id',p.p->>'player_id','raw_value',r.score,
  'display_value',r.score::text||case when r.score=1 then ' Punkt' else ' Punkte' end)
  order by r.score desc,p.ordinality) into inputs
 from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_poison_fish_runs r on r.session_id=p_id and r.round_id=v_round_id and r.player_id=(p.p->>'player_id')::uuid;
 if inputs is not null then perform public.special_minigame_finalize_locked(p_id,v_round_id,inputs);end if;
end; $$;

create function public.submit_trottl_special_poison_fish(p_session_id uuid,p_round_id uuid,p_events jsonb,p_final boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_poison_fish_runs;slot smallint;
 now_at timestamptz:=clock_timestamp();play_at timestamptz;server_elapsed integer;existing_count integer;incoming_count integer;score_value integer;last_event jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;now_at:=clock_timestamp();g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_07'
  or (m->>'minigame_id')::uuid is distinct from p_round_id
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical'))
  then raise exception 'SPECIAL_INVALID_POISON_FISH_PARTICIPANT';end if;
 select * into r from public.trottl_special_poison_fish_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;
 if not found then raise exception 'SPECIAL_POISON_FISH_RUN_NOT_FOUND';end if;
 if r.completed then return p_session_id;end if;
 play_at:=(m->>'start_at')::timestamptz+interval '400 milliseconds';server_elapsed:=floor(extract(epoch from(now_at-play_at))*1000)::integer;
 if now_at<play_at or now_at>play_at+interval '13 seconds' or p_events is null or jsonb_typeof(p_events)<>'array' then raise exception 'SPECIAL_POISON_FISH_TIME';end if;
 incoming_count:=jsonb_array_length(p_events);existing_count:=jsonb_array_length(r.events);
 if incoming_count<existing_count then raise exception 'SPECIAL_POISON_FISH_STALE_EVENTS';end if;
 if existing_count>0 and (select jsonb_agg(value order by ordinality) from jsonb_array_elements(p_events) with ordinality e(value,ordinality) where ordinality<=existing_count) is distinct from r.events then raise exception 'SPECIAL_POISON_FISH_STALE_EVENTS';end if;
 score_value:=public.special_poison_fish_replay(r.movement_seed,p_events,r.simulation_version);
 if incoming_count>0 then
  last_event:=p_events->(incoming_count-1);
  if (last_event->>'t')::integer>server_elapsed+1000 then raise exception 'SPECIAL_POISON_FISH_FUTURE_EVENT';end if;
 end if;
 if p_final and now_at<play_at+interval '10 seconds' then raise exception 'SPECIAL_POISON_FISH_NOT_FINISHED';end if;
 update public.trottl_special_poison_fish_runs set events=p_events,score=score_value,completed=p_final,updated_at=now_at
  where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();
 if p_final then
  update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m||jsonb_build_object('runs',m->'runs'||jsonb_build_object(auth.uid()::text,jsonb_build_object('completed',true))),'revision',(g->>'revision')::bigint+1) where id=p_session_id;
  perform public.special_poison_fish_finalize_locked(p_session_id);
 else
  update public.trottl_special_sessions set game_state=g||jsonb_build_object('revision',(g->>'revision')::bigint+1) where id=p_session_id;
 end if;
 return p_session_id;
end; $$;

create function public.finalize_trottl_special_poison_fish(p_session_id uuid,p_round_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;now_at timestamptz:=clock_timestamp();
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;now_at:=clock_timestamp();g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_07' or (m->>'minigame_id')::uuid is distinct from p_round_id then return p_session_id;end if;
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical'))
  and not exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then raise exception 'SPECIAL_POISON_FISH_VIEW_REQUIRED';end if;
 if now_at<(m->>'end_at')::timestamptz+interval '1.6 seconds' then raise exception 'SPECIAL_POISON_FISH_NOT_FINISHED';end if;
 update public.trottl_special_poison_fish_runs set completed=true,updated_at=now_at where session_id=p_session_id and round_id=p_round_id and not completed;
 perform public.special_poison_fish_finalize_locked(p_session_id);
 return p_session_id;
end; $$;

create or replace function public.special_number_hunt_begin_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare chosen text;override_value text;
begin
 select debug_test->>'next_minigame' into override_value from public.trottl_special_sessions where id=p_id for update;
 chosen:=public.special_minigame_pick(case when override_value is null then pg_catalog.random() else 0 end,override_value);
 if chosen='special_minigame_01' then perform public.special_number_hunt_original_begin_locked(p_id);
 elsif chosen='special_minigame_02' then perform public.special_fish_catch_begin_locked(p_id);
 elsif chosen='special_minigame_03' then perform public.special_reaction_begin_locked(p_id);
 elsif chosen='special_minigame_04' then perform public.special_color_chaos_begin_locked(p_id);
 elsif chosen='special_minigame_05' then perform public.special_fish_memory_begin_locked(p_id);
 elsif chosen='special_minigame_06' then perform public.special_stop_fish_begin_locked(p_id);
 elsif chosen='special_minigame_07' then perform public.special_poison_fish_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME';end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_poison_fish;
create function public.leave_trottl_special_session(p_session_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true;end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_07' then return public.leave_trottl_special_before_poison_fish(p_session_id);end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER';end if;
 delete from public.trottl_special_poison_fish_runs where session_id=p_session_id and round_id=(m->>'minigame_id')::uuid and player_id=auth.uid();
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text),'runs',(m->'runs')-auth.uid()::text);
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null);end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0);end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id;end if;
 perform public.special_poison_fish_finalize_locked(p_session_id);
 return true;
end; $$;

revoke all on function public.special_poison_fish_config(integer),public.special_poison_fish_hash(bigint,integer,integer,integer),
 public.special_poison_fish_state(bigint,integer,integer,integer,numeric,numeric,integer,integer),
 public.special_poison_fish_replay(bigint,jsonb,integer),public.special_poison_fish_begin_locked(uuid),
 public.special_poison_fish_finalize_locked(uuid),public.get_trottl_special_poison_fish_view(uuid),
 public.submit_trottl_special_poison_fish(uuid,uuid,jsonb,boolean),public.finalize_trottl_special_poison_fish(uuid,uuid),
 public.special_number_hunt_begin_locked(uuid),public.leave_trottl_special_before_poison_fish(uuid),public.leave_trottl_special_session(uuid)
 from public,anon,authenticated;
grant execute on function public.get_trottl_special_poison_fish_view(uuid),public.submit_trottl_special_poison_fish(uuid,uuid,jsonb,boolean),
 public.finalize_trottl_special_poison_fish(uuid,uuid),public.leave_trottl_special_session(uuid) to authenticated;
commit;
