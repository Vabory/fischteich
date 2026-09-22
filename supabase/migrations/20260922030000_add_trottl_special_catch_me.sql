begin;

create table public.trottl_special_catch_me_rounds (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null, seed bigint not null check(seed between 1 and 2147483646),
 positions jsonb not null check(jsonb_typeof(positions)='array' and jsonb_array_length(positions)=10),
 started_at timestamptz not null, deadline timestamptz not null,
 primary key(session_id,round_id)
);
create table public.trottl_special_catch_me_runs (
 session_id uuid not null, round_id uuid not null, player_id uuid not null,
 progress integer not null default 0 check(progress between 0 and 10), events jsonb not null default '[]'::jsonb check(jsonb_typeof(events)='array' and jsonb_array_length(events)<=10),
 status text not null default 'open' check(status in('open','completed','timeout')),
 elapsed_ms integer check(elapsed_ms is null or elapsed_ms between 0 and 29999), finished_at timestamptz,
 primary key(session_id,round_id,player_id),
 foreign key(session_id,round_id) references public.trottl_special_catch_me_rounds(session_id,round_id) on delete cascade,
 check((status='open' and progress<10 and elapsed_ms is null and finished_at is null)
  or (status='completed' and progress=10 and elapsed_ms is not null and finished_at is not null)
  or (status='timeout' and progress<10 and elapsed_ms is null and finished_at is not null))
);
alter table public.trottl_special_catch_me_rounds enable row level security;
alter table public.trottl_special_catch_me_runs enable row level security;
revoke all on public.trottl_special_catch_me_rounds,public.trottl_special_catch_me_runs from anon,authenticated;

create function public.special_catch_me_hash(p_seed bigint,p_index integer,p_attempt integer,p_channel integer) returns bigint
language sql immutable security definer set search_path='' as $$
 with first_value as (select mod(p_seed*48271+(p_index+1)::bigint*104729+(p_attempt+1)::bigint*1000003+p_channel::bigint*7919,2147483647) value)
 select mod(value*48271+mod(value,65521)*mod(value,32749),2147483647) from first_value;
$$;
create function public.special_catch_me_positions(p_seed bigint) returns jsonb
language plpgsql immutable security definer set search_path='' as $$
declare result jsonb:='[]'::jsonb;i integer;attempt integer;zone integer;offset_value integer;step_value integer;
 x_units integer;y_units integer;previous_x integer;previous_y integer;accepted boolean;
begin
 if p_seed not between 1 and 2147483646 then raise exception 'SPECIAL_INVALID_CATCH_ME_SEED';end if;
 offset_value:=mod(public.special_catch_me_hash(p_seed,0,0,7),4)::integer;
 step_value:=case when mod(public.special_catch_me_hash(p_seed,0,0,8),2)=1 then 1 else 3 end;
 for i in 0..9 loop
  zone:=mod(offset_value+i*step_value+floor(i/4.0)::integer*2,4);accepted:=false;
  for attempt in 0..63 loop
   x_units:=(case when mod(zone,2)=0 then 1600 else 5200 end)+mod(public.special_catch_me_hash(p_seed,i,attempt,1),3201)::integer;
   y_units:=(case when zone<2 then 1300 else 5200 end)+mod(public.special_catch_me_hash(p_seed,i,attempt,2),3501)::integer;
   if i=0 or ((x_units-previous_x)::bigint*(x_units-previous_x)+(y_units-previous_y)::bigint*(y_units-previous_y))>=9000000 then accepted:=true;exit;end if;
  end loop;
  if not accepted then x_units:=case when mod(zone,2)=0 then 3000 else 7000 end;y_units:=case when zone<2 then 2800 else 7200 end;end if;
  result:=result||jsonb_build_array(jsonb_build_object('x',x_units/10000.0,'y',y_units/10000.0));previous_x:=x_units;previous_y:=y_units;
 end loop;
 return result;
end; $$;

update public.trottl_special_minigame_registry set title='Fang mich!',implemented=true,enabled=true where id='special_minigame_09';

create function public.special_catch_me_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_round uuid;g jsonb;m jsonb;v_seed bigint;v_title timestamptz:=clock_timestamp();v_started timestamptz;v_player jsonb;v_runs jsonb:='{}'::jsonb;
begin
 v_round:=public.special_minigame_begin_locked(p_id,'special_minigame_09','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 v_seed:=1+floor(pg_catalog.random()*2147483646)::bigint;v_started:=v_title+interval '5.4 seconds';
 insert into public.trottl_special_catch_me_rounds values(p_id,v_round,v_seed,public.special_catch_me_positions(v_seed),v_started,v_started+interval '30 seconds');
 for v_player in select value from jsonb_array_elements(m->'participants') loop
  insert into public.trottl_special_catch_me_runs(session_id,round_id,player_id) values(p_id,v_round,(v_player->>'player_id')::uuid);
  v_runs:=v_runs||jsonb_build_object(v_player->>'player_id',jsonb_build_object('progress',0,'status','open','completed',false));
 end loop;
 m:=m||jsonb_build_object('title','Fang mich!','title_started_at',v_title,'title_ends_at',v_title+interval '2 seconds',
  'start_at',v_title+interval '5 seconds','end_at',v_started+interval '30 seconds','runs',v_runs);
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_catch_me_view(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_catch_me_rounds;run public.trottl_special_catch_me_runs;is_spectator boolean:=false;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active' or s.game_state->'minigame'->>'minigame_type'<>'special_minigame_09' then return null;end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;is_spectator:=true;
 else raise exception 'SPECIAL_CATCH_ME_VIEW_REQUIRED';end if;
 select * into r from public.trottl_special_catch_me_rounds where session_id=p_session_id and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid;
 select * into run from public.trottl_special_catch_me_runs where session_id=p_session_id and round_id=r.round_id and player_id=target;
 if not found then return null;end if;
 return jsonb_build_object('player_id',target,'spectator',is_spectator,'seed',r.seed,'positions',r.positions,'started_at',r.started_at,
  'deadline',r.deadline,'progress',run.progress,'status',run.status);
end; $$;

create function public.special_catch_me_finalize_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;v_round uuid;inputs jsonb;patched jsonb;all_timeout boolean;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_09' then return;end if;
 v_round:=(m->>'minigame_id')::uuid;
 if jsonb_array_length(m->'participants')=0 then perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;end if;
 if exists(select 1 from public.trottl_special_catch_me_runs where session_id=p_id and round_id=v_round and status='open') then return;end if;
 select bool_and(r.status='timeout') into all_timeout from public.trottl_special_catch_me_runs r where r.session_id=p_id and r.round_id=v_round;
 select jsonb_agg(jsonb_build_object('player_id',p.p->>'player_id','raw_value',coalesce(r.elapsed_ms,30001),
  'display_value',case when r.status='timeout' then 'Zeit abgelaufen' else replace(to_char(r.elapsed_ms/1000.0,'FM999990.000'),'.',',')||' s' end)
  order by coalesce(r.elapsed_ms,30001),p.ordinality) into inputs
 from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_catch_me_runs r on r.player_id=(p.p->>'player_id')::uuid and r.session_id=p_id and r.round_id=v_round;
 perform public.special_minigame_finalize_locked(p_id,v_round,inputs);
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 select jsonb_agg(item||jsonb_build_object('raw_value',case when r.status='completed' then r.elapsed_ms else null end,
  'elapsed_ms',r.elapsed_ms,'status',r.status,'is_penalty',r.status='timeout' and not all_timeout,
  'display_value',case when r.status='timeout' then 'Zeit abgelaufen' else replace(to_char(r.elapsed_ms/1000.0,'FM999990.000'),'.',',')||' s' end) order by ordinality)
 into patched from jsonb_array_elements(m->'results') with ordinality result(item,ordinality)
 join public.trottl_special_catch_me_runs r on r.player_id=(item->>'player_id')::uuid and r.session_id=p_id and r.round_id=v_round;
 m:=m||jsonb_build_object('results',patched,'all_timeout',all_timeout);
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.submit_trottl_special_catch_me(p_session_id uuid,p_round_id uuid,p_events jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_catch_me_rounds;run public.trottl_special_catch_me_runs;
 slot smallint;now_at timestamptz:=clock_timestamp();server_elapsed integer;event jsonb;event_id uuid;fish_index integer;tap_ms integer;
 tap_x numeric;tap_y numeric;expected jsonb;previous_ms integer;new_events jsonb;new_progress integer;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';now_at:=clock_timestamp();
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_09'
  or (m->>'minigame_id')::uuid is distinct from p_round_id
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical'))
  then raise exception 'SPECIAL_INVALID_CATCH_ME_PARTICIPANT';end if;
 select * into r from public.trottl_special_catch_me_rounds where session_id=p_session_id and round_id=p_round_id;
 select * into run from public.trottl_special_catch_me_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;
 if run.status<>'open' then return p_session_id;end if;
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)<1 or jsonb_array_length(p_events)>10 then raise exception 'SPECIAL_INVALID_CATCH_ME_EVENTS';end if;
 if now_at<r.started_at or now_at>=r.deadline+interval '3 seconds' then raise exception 'SPECIAL_INVALID_CATCH_ME_TIME';end if;
 server_elapsed:=floor(extract(epoch from(now_at-r.started_at))*1000)::integer;new_events:=run.events;new_progress:=run.progress;
 previous_ms:=case when jsonb_array_length(new_events)>0 then (new_events->(jsonb_array_length(new_events)-1)->>'t')::integer else -1 end;
 for event in select value from jsonb_array_elements(p_events) loop
  event_id:=(event->>'input_id')::uuid;fish_index:=(event->>'fish_index')::integer;tap_ms:=(event->>'t')::integer;
  tap_x:=(event->>'x')::numeric;tap_y:=(event->>'y')::numeric;
  if event_id is null or fish_index is null or tap_ms is null or tap_x is null or tap_y is null then raise exception 'SPECIAL_INVALID_CATCH_ME_EVENT';end if;
  if exists(select 1 from jsonb_array_elements(new_events) old where old->>'input_id'=event_id::text) then continue;end if;
  if fish_index<new_progress then continue;end if;
  if fish_index<>new_progress or fish_index not between 0 and 9 then raise exception 'SPECIAL_INVALID_CATCH_ME_SEQUENCE';end if;
  if tap_ms<previous_ms or tap_ms<0 or tap_ms>=30000 or tap_ms>server_elapsed+1000 then raise exception 'SPECIAL_INVALID_CATCH_ME_TIME';end if;
  expected:=r.positions->fish_index;
  if tap_x<0 or tap_x>1 or tap_y<0 or tap_y>1 or abs(tap_x-(expected->>'x')::numeric)>.15 or abs(tap_y-(expected->>'y')::numeric)>.13
   then raise exception 'SPECIAL_INVALID_CATCH_ME_HIT';end if;
  new_events:=new_events||jsonb_build_array(jsonb_build_object('input_id',event_id,'fish_index',fish_index,'t',tap_ms,'x',tap_x,'y',tap_y));
  new_progress:=new_progress+1;previous_ms:=tap_ms;
 end loop;
 if new_progress=10 and server_elapsed-previous_ms>5000 then raise exception 'SPECIAL_STALE_CATCH_ME_FINISH';end if;
 update public.trottl_special_catch_me_runs set progress=new_progress,events=new_events,
  status=case when new_progress=10 then 'completed' else 'open' end,elapsed_ms=case when new_progress=10 then previous_ms else null end,
  finished_at=case when new_progress=10 then r.started_at+previous_ms*interval '1 millisecond' else null end
 where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,jsonb_build_object('progress',new_progress,
  'status',case when new_progress=10 then 'completed' else 'open' end,'completed',new_progress=10)));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_catch_me_finalize_locked(p_session_id);return p_session_id;
end; $$;

create function public.finalize_trottl_special_catch_me(p_session_id uuid,p_round_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_catch_me_rounds;slot smallint;runs jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_09' or (m->>'minigame_id')::uuid is distinct from p_round_id then return p_session_id;end if;
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid())
  and not exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then raise exception 'SPECIAL_CATCH_ME_VIEW_REQUIRED';end if;
 select * into r from public.trottl_special_catch_me_rounds where session_id=p_session_id and round_id=p_round_id;
 if clock_timestamp()<r.deadline then raise exception 'SPECIAL_CATCH_ME_NOT_FINISHED';end if;
 update public.trottl_special_catch_me_runs set status='timeout',finished_at=r.deadline where session_id=p_session_id and round_id=p_round_id and status='open';
 select jsonb_object_agg(entry.key,case when entry.value->>'status'='open' then entry.value||jsonb_build_object('status','timeout','completed',true) else entry.value end)
 into runs from jsonb_each(m->'runs') entry;
 m:=m||jsonb_build_object('runs',coalesce(runs,'{}'::jsonb));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_catch_me_finalize_locked(p_session_id);return p_session_id;
end; $$;

create or replace function public.special_number_hunt_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
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
 elsif chosen='special_minigame_08' then perform public.special_fish_count_begin_locked(p_id);
 elsif chosen='special_minigame_09' then perform public.special_catch_me_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME';end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

revoke all on function public.special_catch_me_hash(bigint,integer,integer,integer),public.special_catch_me_positions(bigint),
 public.special_catch_me_begin_locked(uuid),public.special_catch_me_finalize_locked(uuid),public.get_trottl_special_catch_me_view(uuid),
 public.submit_trottl_special_catch_me(uuid,uuid,jsonb),public.finalize_trottl_special_catch_me(uuid,uuid),public.special_number_hunt_begin_locked(uuid)
 from public,anon,authenticated;
grant execute on function public.get_trottl_special_catch_me_view(uuid),public.submit_trottl_special_catch_me(uuid,uuid,jsonb),
 public.finalize_trottl_special_catch_me(uuid,uuid) to authenticated;
commit;
