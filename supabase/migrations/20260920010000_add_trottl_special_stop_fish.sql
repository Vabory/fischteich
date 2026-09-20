begin;

create table public.trottl_special_stop_fish_runs (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,round_id uuid not null,player_id uuid not null,
 status text not null default 'open' check(status in('open','stopped','timeout')),tap_elapsed_ms integer check(tap_elapsed_ms between 0 and 15000),
 distance_units integer not null default 100001 check(distance_units between 0 and 100001),perfect boolean not null default false,finished_at timestamptz,
 primary key(session_id,round_id,player_id),check((status='open' and tap_elapsed_ms is null and finished_at is null) or (status='stopped' and tap_elapsed_ms is not null and finished_at is not null) or (status='timeout' and tap_elapsed_ms is null and finished_at is not null))
);
alter table public.trottl_special_stop_fish_runs enable row level security;
revoke all on public.trottl_special_stop_fish_runs from anon,authenticated;
update public.trottl_special_minigame_registry set title='Stop den Fisch',implemented=true,enabled=true where id='special_minigame_06';

create function public.special_stop_fish_distance(p_elapsed integer) returns integer language plpgsql immutable security definer set search_path='' as $$
declare cycle_time integer:=mod(p_elapsed,2250);center numeric;
begin
 if p_elapsed not between 0 and 15000 then raise exception 'SPECIAL_INVALID_STOP_FISH_TIME'; end if;
 if cycle_time>=1750 then return 100001; end if;
 center:=1.25-1.5*cycle_time::numeric/1750;return round(abs(center-.5)*100000)::integer;
end; $$;

create function public.special_stop_fish_begin_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r uuid;g jsonb;p jsonb;runs jsonb:='{}'::jsonb;start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 r:=public.special_minigame_begin_locked(p_id,'special_minigame_06','lower_is_better');select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  insert into public.trottl_special_stop_fish_runs(session_id,round_id,player_id) values(p_id,r,(p->>'player_id')::uuid);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('status','open','completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object('title','Stop den Fisch','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds','start_at',start_at,'end_at',start_at+interval '15 seconds','runs',runs),'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_stop_fish_view(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_stop_fish_runs;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active' or s.game_state->'minigame'->>'minigame_type'<>'special_minigame_06' then return null; end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;else raise exception 'SPECIAL_STOP_FISH_VIEW_REQUIRED';end if;
 select * into r from public.trottl_special_stop_fish_runs where session_id=p_session_id and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid and player_id=target;
 return jsonb_build_object('player_id',r.player_id,'status',r.status,'tap_elapsed_ms',r.tap_elapsed_ms,'distance_units',r.distance_units,'perfect',r.perfect);
end; $$;

create function public.special_stop_fish_finalize_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;v uuid;best integer;worst integer;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_06' then return;end if;v:=(m->>'minigame_id')::uuid;
 if exists(select 1 from public.trottl_special_stop_fish_runs where session_id=p_id and round_id=v and status='open') then return;end if;
 select min(distance_units) filter(where status='stopped'),max(distance_units) filter(where status='stopped') into best,worst from public.trottl_special_stop_fish_runs where session_id=p_id and round_id=v;
 select jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',r.distance_units,'display_value',case when r.status='timeout' then 'ZEIT ABGELAUFEN' else to_char(r.distance_units/1000.0,'FM999990.0')||' % Abstand' end,'perfect',r.perfect,'is_penalty',r.status='timeout','is_winner',r.status='stopped' and r.distance_units=best,'is_loser',r.status='timeout' or (best is distinct from worst and r.status='stopped' and r.distance_units=worst)) order by (r.status='timeout'),r.distance_units,p.ordinality)
 into inputs from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality) join public.trottl_special_stop_fish_runs r on r.player_id=(p.p->>'player_id')::uuid and r.session_id=p_id and r.round_id=v;
 perform public.special_minigame_finalize_locked(p_id,v,inputs);
end; $$;

create function public.stop_trottl_special_stop_fish(p_session_id uuid,p_round_id uuid,p_tap_elapsed_ms integer) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_stop_fish_runs;slot smallint;now_at timestamptz:=clock_timestamp();server_elapsed integer;units integer;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;select room_slot into slot from public.trottl_special_sessions where id=p_session_id;if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type'<>'special_minigame_06' or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then raise exception 'SPECIAL_INVALID_STOP_FISH_PARTICIPANT';end if;
 select * into r from public.trottl_special_stop_fish_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;if r.status<>'open' then return p_session_id;end if;server_elapsed:=floor(extract(epoch from(now_at-(m->>'start_at')::timestamptz))*1000)::integer;
 if p_tap_elapsed_ms is null or p_tap_elapsed_ms<0 or p_tap_elapsed_ms>15000 or p_tap_elapsed_ms>server_elapsed+1000 then raise exception 'SPECIAL_INVALID_STOP_FISH_TIME';end if;
 if now_at>=(m->>'end_at')::timestamptz or p_tap_elapsed_ms>=15000 then update public.trottl_special_stop_fish_runs set status='timeout',finished_at=now_at where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();else units:=public.special_stop_fish_distance(p_tap_elapsed_ms);update public.trottl_special_stop_fish_runs set status='stopped',tap_elapsed_ms=p_tap_elapsed_ms,distance_units=units,perfect=units<=500,finished_at=now_at where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,jsonb_build_object('status','stopped','completed',true))),'revision',(g->>'revision')::bigint+1) where id=p_session_id;perform public.special_stop_fish_finalize_locked(p_session_id);return p_session_id;
end; $$;

create function public.finalize_trottl_special_stop_fish(p_session_id uuid,p_round_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;now_at timestamptz:=clock_timestamp();
begin
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';if m->>'minigame_type'<>'special_minigame_06' or now_at<(m->>'end_at')::timestamptz then raise exception 'SPECIAL_STOP_FISH_NOT_FINISHED';end if;update public.trottl_special_stop_fish_runs set status='timeout',finished_at=now_at where session_id=p_session_id and round_id=p_round_id and status='open';perform public.special_stop_fish_finalize_locked(p_session_id);return p_session_id;
end; $$;

create or replace function public.special_number_hunt_begin_locked(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare chosen text;override_value text;begin select debug_test->>'next_minigame' into override_value from public.trottl_special_sessions where id=p_id for update;chosen:=public.special_minigame_pick(case when override_value is null then pg_catalog.random() else 0 end,override_value);if chosen='special_minigame_01' then perform public.special_number_hunt_original_begin_locked(p_id);elsif chosen='special_minigame_02' then perform public.special_fish_catch_begin_locked(p_id);elsif chosen='special_minigame_03' then perform public.special_reaction_begin_locked(p_id);elsif chosen='special_minigame_04' then perform public.special_color_chaos_begin_locked(p_id);elsif chosen='special_minigame_05' then perform public.special_fish_memory_begin_locked(p_id);elsif chosen='special_minigame_06' then perform public.special_stop_fish_begin_locked(p_id);else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME';end if;update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;end; $$;

revoke all on function public.special_stop_fish_distance(integer),public.special_stop_fish_begin_locked(uuid),public.special_stop_fish_finalize_locked(uuid),public.get_trottl_special_stop_fish_view(uuid),public.stop_trottl_special_stop_fish(uuid,uuid,integer),public.finalize_trottl_special_stop_fish(uuid,uuid),public.special_number_hunt_begin_locked(uuid) from public,anon,authenticated;
grant execute on function public.get_trottl_special_stop_fish_view(uuid),public.stop_trottl_special_stop_fish(uuid,uuid,integer),public.finalize_trottl_special_stop_fish(uuid,uuid) to authenticated;
commit;
