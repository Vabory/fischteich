begin;
-- Input IDs/version distinguish a deliberate wrong tap from an idempotent network retry.
alter function public.tap_trottl_special_number_hunt(uuid,uuid,integer,bigint) rename to tap_trottl_special_number_hunt_original;
revoke all on function public.tap_trottl_special_number_hunt_original(uuid,uuid,integer,bigint) from public,anon,authenticated;
create function public.tap_trottl_special_number_hunt(p_session_id uuid,p_round_id uuid,p_number integer,p_elapsed_ms bigint default null,
 p_input_id uuid default null,p_input_seq bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;m jsonb;r jsonb;v_slot smallint;v_progress integer;v_seq bigint;v_now timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;m:=s.game_state->'minigame';
 if s.status<>'playing' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type'<>'special_minigame_01'
  or jsonb_typeof(m->'runs') is distinct from 'object' or p_input_id is null or p_input_seq is null
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or p_number is null or p_number not between 1 and 9 then raise exception 'SPECIAL_INVALID_NUMBER_HUNT_TAP'; end if;
 r:=m->'runs'->auth.uid()::text;v_progress:=(r->>'progress')::integer;v_seq:=coalesce((r->>'input_seq')::bigint,0);
 if s.game_state->>'phase' not in ('minigame_active','minigame_results') then raise exception 'SPECIAL_STALE_NUMBER_HUNT'; end if;
 if r->>'last_input_id'=p_input_id::text then return p_session_id; end if;
 if p_input_seq<>v_seq then raise exception 'SPECIAL_STALE_NUMBER_HUNT_INPUT'; end if;
 v_now:=clock_timestamp();
 if s.game_state->>'phase'<>'minigame_active' or (r->>'completed')::boolean or v_now<(m->>'start_at')::timestamptz then raise exception 'SPECIAL_NUMBER_HUNT_NOT_STARTED'; end if;
 r:=r||jsonb_build_object('input_seq',v_seq+1,'last_input_id',p_input_id,'last_tap_at',v_now);
 if p_number<>v_progress+1 then
  r:=r||jsonb_build_object('progress',0,'error_at',v_now,'error_serial',v_seq+1);
 else
  r:=r||jsonb_build_object('progress',p_number);
  if p_number=9 then
   if p_elapsed_ms is null or p_elapsed_ms<0 or p_elapsed_ms>9007199254740991
    or p_elapsed_ms>floor(extract(epoch from (v_now-(m->>'start_at')::timestamptz))*1000)::bigint+1000 then raise exception 'SPECIAL_INVALID_NUMBER_HUNT_TIME'; end if;
   r:=r||jsonb_build_object('completed',true,'finished_at',v_now,'elapsed_ms',p_elapsed_ms);
  end if;
 end if;
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,r));
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('minigame',m,'revision',(s.game_state->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_number_hunt_finalize_locked(p_session_id);return p_session_id;
end; $$;
revoke all on function public.tap_trottl_special_number_hunt(uuid,uuid,integer,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.tap_trottl_special_number_hunt(uuid,uuid,integer,bigint,uuid,bigint) to authenticated;
commit;
