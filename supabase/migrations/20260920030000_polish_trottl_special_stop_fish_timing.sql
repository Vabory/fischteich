begin;

-- The shared countdown keeps START! on screen for 400 ms after start_at.
-- Stop Fish's 15-second playable window begins only when that label is gone.
create or replace function public.special_stop_fish_distance(p_elapsed integer) returns integer language plpgsql immutable security definer set search_path='' as $$
declare cycle_time integer:=mod(p_elapsed,1200);center numeric;
begin
 if p_elapsed not between 0 and 15000 then raise exception 'SPECIAL_INVALID_STOP_FISH_TIME'; end if;
 if cycle_time>=700 then return 100001; end if;
 -- Fish width is 50% of the track, plus 8% of its width outside each edge.
 center:=1.29-1.58*cycle_time::numeric/700;
 if center>=1.25 or center<=-.25 then return 100001; end if;
 return round(abs(center-.5)*100000)::integer;
end; $$;

create or replace function public.special_stop_fish_begin_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r uuid;g jsonb;p jsonb;runs jsonb:='{}'::jsonb;start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 r:=public.special_minigame_begin_locked(p_id,'special_minigame_06','lower_is_better');select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  insert into public.trottl_special_stop_fish_runs(session_id,round_id,player_id) values(p_id,r,(p->>'player_id')::uuid);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('status','open','completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object('title','Stop den Fisch','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds','start_at',start_at,'end_at',start_at+interval '15.4 seconds','runs',runs),'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create or replace function public.stop_trottl_special_stop_fish(p_session_id uuid,p_round_id uuid,p_tap_elapsed_ms integer) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_stop_fish_runs;slot smallint;now_at timestamptz:=clock_timestamp();play_at timestamptz;server_elapsed integer;units integer;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;select room_slot into slot from public.trottl_special_sessions where id=p_session_id;if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type'<>'special_minigame_06' or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then raise exception 'SPECIAL_INVALID_STOP_FISH_PARTICIPANT';end if;
 select * into r from public.trottl_special_stop_fish_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;if r.status<>'open' then return p_session_id;end if;
 play_at:=(m->>'start_at')::timestamptz+interval '400 milliseconds';server_elapsed:=floor(extract(epoch from(now_at-play_at))*1000)::integer;
 if now_at<play_at or p_tap_elapsed_ms is null or p_tap_elapsed_ms<0 or p_tap_elapsed_ms>15000 or p_tap_elapsed_ms>server_elapsed+1000 then raise exception 'SPECIAL_INVALID_STOP_FISH_TIME';end if;
 if now_at>=(m->>'end_at')::timestamptz or p_tap_elapsed_ms>=15000 then update public.trottl_special_stop_fish_runs set status='timeout',finished_at=now_at where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();else units:=public.special_stop_fish_distance(p_tap_elapsed_ms);update public.trottl_special_stop_fish_runs set status='stopped',tap_elapsed_ms=p_tap_elapsed_ms,distance_units=units,perfect=units<=500,finished_at=now_at where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,jsonb_build_object('status','stopped','completed',true))),'revision',(g->>'revision')::bigint+1) where id=p_session_id;perform public.special_stop_fish_finalize_locked(p_session_id);return p_session_id;
end; $$;

revoke all on function public.special_stop_fish_distance(integer),public.special_stop_fish_begin_locked(uuid),public.stop_trottl_special_stop_fish(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.stop_trottl_special_stop_fish(uuid,uuid,integer) to authenticated;
commit;
