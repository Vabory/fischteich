begin;
-- New drink-ranking policy. PANIK deliberately keeps special_minigame_rank unchanged.
create function public.special_minigame_rank_drinks(p_results jsonb,p_direction text)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare r jsonb;
begin
 r:=public.special_minigame_rank(p_results,p_direction);
 if (r->>'draw')::boolean then
  r:=r||jsonb_build_object('draw',false,'all_tied',true,'losers','[]'::jsonb,
   'winners',(select jsonb_agg(v->'player_id' order by v->>'player_id') from jsonb_array_elements(r->'results') v),
   'results',(select jsonb_agg(v||jsonb_build_object('is_winner',true,'is_loser',false) order by v->>'player_id') from jsonb_array_elements(r->'results') v));
 else r:=r||jsonb_build_object('all_tied',false); end if;
 return r;
end; $$;

-- Reuse existing validated finalizer and its exact allocation/ACK pipeline.
alter function public.special_minigame_finalize_locked(uuid,uuid,jsonb) rename to special_minigame_finalize_original_locked;
create function public.special_minigame_finalize_locked(p_id uuid,p_round uuid,p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;r jsonb;
begin
 perform public.special_minigame_finalize_original_locked(p_id,p_round,p_results);
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if not (m->>'draw')::boolean then return; end if;
 r:=public.special_minigame_rank_drinks(p_results,m->>'ranking_direction');
 -- Keep the original cached names and all result fields, change only tie flags/allocations.
 m:=m||jsonb_build_object('draw',false,'all_tied',true,'winners',r->'winners','losers','[]'::jsonb,
  'results',(select jsonb_agg(v||jsonb_build_object('is_winner',true,'is_loser',false) order by v->>'player_id') from jsonb_array_elements(m->'results') v),
  'automatic_drinks','{}'::jsonb,'distributions',(select jsonb_object_agg(v,jsonb_build_object('drinks','{}'::jsonb,'confirmed',false,'cancelled',false))
   from jsonb_array_elements_text(r->'winners') v));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'drinks','{}'::jsonb,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.special_number_hunt_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare round_id uuid;g jsonb;runs jsonb:='{}'::jsonb;v_uid uuid;board jsonb;v_now timestamptz:=clock_timestamp();
begin
 -- Fixed game01 only. The other registered IDs remain private, unimplemented slots.
 round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_01','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for v_uid in select (p->>'player_id')::uuid from jsonb_array_elements(g->'minigame'->'participants') p loop
  select jsonb_agg(n order by pg_catalog.random()) into board from generate_series(1,9) as numbers(n);
  runs:=runs||jsonb_build_object(v_uid::text,jsonb_build_object('board',board,'progress',0,'completed',false,'elapsed_ms',null));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object('title','Zahlenjagd',
  'title_started_at',v_now,'title_ends_at',v_now+interval '2 seconds','start_at',v_now+interval '5 seconds','runs',runs),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.special_number_hunt_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_01' then return; end if;
 if jsonb_array_length(m->'participants')=0 then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;
 end if;
 if exists(select 1 from jsonb_array_elements(m->'participants') p where not coalesce((m->'runs'->(p->>'player_id')->>'completed')::boolean,false)) then return; end if;
 select jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',m->'runs'->(p->>'player_id')->'elapsed_ms',
  'display_value',to_char((m->'runs'->(p->>'player_id')->>'elapsed_ms')::numeric/1000,'FM999999999999990.000')||' s')) into inputs from jsonb_array_elements(m->'participants') p;
 perform public.special_minigame_finalize_locked(p_id,(m->>'minigame_id')::uuid,inputs);
end; $$;

create function public.tap_trottl_special_number_hunt(p_session_id uuid,p_round_id uuid,p_number integer,p_elapsed_ms bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;m jsonb;r jsonb;v_slot smallint;v_progress integer;v_now timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;m:=s.game_state->'minigame';
 if s.status<>'playing' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type'<>'special_minigame_01'
  or jsonb_typeof(m->'runs') is distinct from 'object'
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or p_number is null or p_number not between 1 and 9 then raise exception 'SPECIAL_INVALID_NUMBER_HUNT_TAP'; end if;
 r:=m->'runs'->auth.uid()::text;v_progress:=(r->>'progress')::integer;
 -- Idempotent retry after the final tap also works in the result phase.
 if s.game_state->>'phase' not in ('minigame_active','minigame_results') then raise exception 'SPECIAL_STALE_NUMBER_HUNT'; end if;
 if p_number<=v_progress then return p_session_id; end if;
 v_now:=clock_timestamp();
 if s.game_state->>'phase'<>'minigame_active' or v_now<(m->>'start_at')::timestamptz then raise exception 'SPECIAL_NUMBER_HUNT_NOT_STARTED'; end if;
 if p_number<>v_progress+1 then return p_session_id; end if; -- Wrong tap: ignored, no penalty.
 r:=r||jsonb_build_object('progress',p_number,'last_tap_at',v_now);
 if p_number=9 then
  -- Freeze the actual last-tap time, not the serial RPC queue/network delay.
  -- As with PANIK's tap counter this is a validated device measurement, not an anti-cheat proof.
  if p_elapsed_ms is null or p_elapsed_ms<0 or p_elapsed_ms>9007199254740991
   or p_elapsed_ms>floor(extract(epoch from (v_now-(m->>'start_at')::timestamptz))*1000)::bigint+1000
   then raise exception 'SPECIAL_INVALID_NUMBER_HUNT_TIME'; end if;
  r:=r||jsonb_build_object('completed',true,'finished_at',v_now,'elapsed_ms',p_elapsed_ms);
 end if;
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,r));
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('minigame',m,'revision',(s.game_state->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_number_hunt_finalize_locked(p_session_id);return p_session_id;
end; $$;

alter function public.act_trottl_special_game(uuid,text,bigint,uuid) rename to act_trottl_special_phase_four;
revoke all on function public.act_trottl_special_phase_four(uuid,text,bigint,uuid) from public,anon,authenticated;
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;
 perform public.act_trottl_special_phase_four(p_session_id,p_action,p_roll_seq,p_target);
 if p_action='resolve' and g->>'phase'='rolling' and (g->>'result')::integer=4 and not coalesce((g->>'rescue')::boolean,false) then
  select game_state into g from public.trottl_special_sessions where id=p_session_id;
  if g->>'phase'='placeholder' then perform public.special_number_hunt_begin_locked(p_session_id); end if;
 end if;
 return p_session_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_phase_four;
revoke all on function public.leave_trottl_special_phase_four(uuid) from public,anon,authenticated;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_01' or m->'runs' is null then return public.leave_trottl_special_phase_four(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text));
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 perform public.special_number_hunt_finalize_locked(p_session_id);return true;
end; $$;
revoke all on function public.special_minigame_rank_drinks(jsonb,text),public.special_minigame_finalize_original_locked(uuid,uuid,jsonb),
 public.special_minigame_finalize_locked(uuid,uuid,jsonb),public.special_number_hunt_begin_locked(uuid),public.special_number_hunt_finalize_locked(uuid),
 public.tap_trottl_special_number_hunt(uuid,uuid,integer,bigint),public.act_trottl_special_game(uuid,text,bigint,uuid),public.leave_trottl_special_session(uuid)
 from public,anon,authenticated;
grant execute on function public.tap_trottl_special_number_hunt(uuid,uuid,integer,bigint),public.act_trottl_special_game(uuid,text,bigint,uuid),public.leave_trottl_special_session(uuid) to authenticated;
commit;
