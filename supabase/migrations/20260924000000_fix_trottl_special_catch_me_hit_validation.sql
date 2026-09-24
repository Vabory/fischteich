begin;

-- The client hitbox is pixel-based. At the widest supported fish size inside the
-- capped catch field it reaches roughly 0.148 on X; keep server validation
-- deliberately wider so every legitimate 1.25x client hit is accepted.
create or replace function public.submit_trottl_special_catch_me(p_session_id uuid,p_round_id uuid,p_events jsonb) returns uuid
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
  if tap_x<0 or tap_x>1 or tap_y<0 or tap_y>1 or abs(tap_x-(expected->>'x')::numeric)>.16 or abs(tap_y-(expected->>'y')::numeric)>.12
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

commit;
