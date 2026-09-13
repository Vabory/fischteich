begin;
-- Final counts are private until settlement, and are NOT in the Realtime publication.
create table public.trottl_special_panic_submissions (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null,user_id uuid not null references public.app_profiles(user_id),
 tap_count integer not null check(tap_count between 0 and 400),submitted_at timestamptz not null default clock_timestamp(),
 primary key(session_id,round_id,user_id)
);
alter table public.trottl_special_panic_submissions enable row level security;
revoke all on public.trottl_special_panic_submissions from public,anon,authenticated;
grant select on public.trottl_special_panic_submissions to authenticated;
create policy special_panic_own_receipt on public.trottl_special_panic_submissions for select to authenticated
 using(user_id=auth.uid() and public.is_trottl_special_viewer(session_id));

create function public.get_trottl_special_server_time(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 return clock_timestamp();
end; $$;

create function public.special_panic_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; participants jsonb; v_start timestamptz:=clock_timestamp()+interval '3 seconds';
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 select jsonb_agg(jsonb_build_object('player_id',user_id,'display_name',display_name_snapshot) order by seat_index)
  into participants from public.trottl_special_players where session_id=p_id and lifecycle_status in ('alive','critical');
 update public.trottl_special_sessions set game_state=(g-'deadline')||jsonb_build_object('phase','panic_active',
  'revision',(g->>'revision')::bigint+1,'minigame',jsonb_build_object('minigame_id',pg_catalog.gen_random_uuid(),
  'minigame_type','panic','title','PANIK','ranking_direction','higher_is_better','settlement','life_loss',
  'participants',coalesce(participants,'[]'::jsonb),'started_at',clock_timestamp(),'start_at',v_start,
  'end_at',v_start+interval '10 seconds','submit_until',v_start+interval '14 seconds','status','active')) where id=p_id;
end; $$;

create function public.special_panic_finalize_locked(p_id uuid,p_draw boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; m jsonb; inputs jsonb; ranked jsonb; v_loser uuid; losses jsonb:='{}'::jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 if g->>'phase'<>'panic_active' then return; end if;
 m:=g->'minigame';
 if not p_draw and (clock_timestamp()<(m->>'end_at')::timestamptz or
  (clock_timestamp()<(m->>'submit_until')::timestamptz and exists(select 1 from jsonb_array_elements(m->'participants') p
   where not exists(select 1 from public.trottl_special_panic_submissions t where t.session_id=p_id
    and t.round_id=(m->>'minigame_id')::uuid and t.user_id::text=p->>'player_id')))) then return; end if;
 select coalesce(jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',case when p_draw then 0 else coalesce(t.tap_count,0) end,
  'display_value',(case when p_draw then 0 else coalesce(t.tap_count,0) end)::text||' Taps')),'[]'::jsonb)
  into inputs from jsonb_array_elements(m->'participants') p left join public.trottl_special_panic_submissions t
   on t.session_id=p_id and t.round_id=(m->>'minigame_id')::uuid and t.user_id::text=p->>'player_id';
 if inputs='[]'::jsonb then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint); return;
 end if;
 ranked:=public.special_minigame_rank(inputs,'higher_is_better');
 for v_loser in select value::uuid from jsonb_array_elements_text(ranked->'losers') loop
  if exists(select 1 from public.trottl_special_players where session_id=p_id and user_id=v_loser and lifecycle_status='alive' and lives>0) then
   perform public.special_lose_life_locked(p_id,v_loser);
   losses:=losses||jsonb_build_object(v_loser::text,1);
  end if;
 end loop;
 -- Re-read after the central engine: never overwrite its Trottl reset.
 select game_state into g from public.trottl_special_sessions where id=p_id;
 ranked:=ranked||jsonb_build_object('results',(select jsonb_agg(r||jsonb_build_object('display_name',p->>'display_name','life_loss',coalesce(losses->(r->>'player_id'),'0'::jsonb))
  order by (r->>'rank')::integer,r->>'player_id') from jsonb_array_elements(ranked->'results') r
  join jsonb_array_elements(m->'participants') p on p->>'player_id'=r->>'player_id'));
 m:=m||ranked||jsonb_build_object('status','results','finished_at',clock_timestamp(),'result_seen','{}'::jsonb);
 if not exists(select 1 from public.trottl_special_players where session_id=p_id and user_id=(g->>'actor')::uuid and lifecycle_status in ('alive','critical')) then
  g:=g||jsonb_build_object('actor',null);
  update public.trottl_special_sessions set current_turn_seat=null where id=p_id;
 end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('phase','panic_results','minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.submit_trottl_special_panic(p_session_id uuid,p_round_id uuid,p_tap_count integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; m jsonb; v_slot smallint; v_previous integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 m:=s.game_state->'minigame';
 if s.status<>'playing' or s.game_state->>'phase'<>'panic_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or p_tap_count is null or p_tap_count not between 0 and 400
  or clock_timestamp()<(m->>'end_at')::timestamptz or clock_timestamp()>(m->>'submit_until')::timestamptz
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text) then raise exception 'SPECIAL_INVALID_PANIC_SUBMIT'; end if;
 select tap_count into v_previous from public.trottl_special_panic_submissions where session_id=p_session_id and round_id=p_round_id and user_id=auth.uid();
 if found then
  if v_previous<>p_tap_count then raise exception 'SPECIAL_PANIC_ALREADY_SUBMITTED'; end if;
  return p_session_id;
 end if;
 insert into public.trottl_special_panic_submissions(session_id,round_id,user_id,tap_count) values(p_session_id,p_round_id,auth.uid(),p_tap_count);
 perform public.special_panic_finalize_locked(p_session_id);
 return p_session_id;
end; $$;

alter function public.act_trottl_special_game(uuid,text,bigint,uuid) rename to act_trottl_special_phase_two;
revoke all on function public.act_trottl_special_phase_two(uuid,text,bigint,uuid) from public,anon,authenticated;
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; g jsonb; m jsonb; v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 g:=s.game_state;
 if s.status<>'playing' or p_roll_seq is distinct from (g->>'roll_seq')::bigint then raise exception 'TROTTL_SPECIAL_STALE_ACTION'; end if;
 if g->>'phase' in ('panic_active','panic_results') then
  if not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
  if p_action='resolve' and g->>'phase'='panic_active' then perform public.special_panic_finalize_locked(p_session_id);
  elsif p_action='results_ack' and g->>'phase'='panic_results' then
   if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
    then raise exception 'SPECIAL_INVALID_PANIC_ACK'; end if;
   m:=g->'minigame';
   if not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text) then raise exception 'SPECIAL_NOT_PARTICIPANT'; end if;
   m:=m||jsonb_build_object('result_seen',(m->'result_seen')||jsonb_build_object(auth.uid()::text,true));
   update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
   if not exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id and p.lifecycle_status in ('alive','critical')
     and not (m->'result_seen' ? p.user_id::text)) then perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,p_roll_seq); end if;
  else raise exception 'SPECIAL_INVALID_PANIC_ACTION'; end if;
 else
  perform public.act_trottl_special_phase_two(p_session_id,p_action,p_roll_seq,p_target);
  if p_action='resolve' and g->>'phase'='rolling' and (g->>'result')::integer=5 and not coalesce((g->>'rescue')::boolean,false) then
   select game_state into g from public.trottl_special_sessions where id=p_session_id;
   if g->>'phase'='placeholder' then perform public.special_panic_begin_locked(p_session_id); end if;
  end if;
 end if;
 return p_session_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_phase_two;
revoke all on function public.leave_trottl_special_phase_two(uuid) from public,anon,authenticated;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; g jsonb; m jsonb; participants jsonb; v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;
 if g->>'phase' not in ('panic_active','panic_results') then return public.leave_trottl_special_phase_two(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 m:=g->'minigame';select coalesce(jsonb_agg(p),'[]'::jsonb) into participants from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text;
 m:=m||jsonb_build_object('participants',participants);
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 if g->>'phase'='panic_active' then perform public.special_panic_finalize_locked(p_session_id,jsonb_array_length(participants)<2);
 elsif not exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id and p.lifecycle_status in ('alive','critical')
  and not (m->'result_seen' ? p.user_id::text)) then perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint); end if;
 return true;
end; $$;

-- Keep the previous invariant implementation, adding only the two panic phases.
create or replace function public.special_validate_game_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; s public.trottl_special_sessions; g jsonb;
begin
 if tg_table_name='trottl_special_sessions' then v_id:=new.id; else v_id:=coalesce(new.session_id,old.session_id); end if;
 select * into s from public.trottl_special_sessions where id=v_id;
 if not found or s.status<>'playing' then return null; end if;g:=s.game_state;
 if g->>'phase' is null or g->>'phase' not in ('awaiting_roll','rescue_roll','rolling','distribution','choose_trottl','drink_ack','trottl_peak','placeholder','awaiting_players',
  'minigame_active','minigame_results','minigame_distribution','panic_active','panic_results') or coalesce((g->>'points')::integer,-1) not between 0 and 3
  or coalesce((g->>'roll_seq')::bigint,-1)<0 then raise exception 'TROTTL_SPECIAL_INVALID_STATE'; end if;
 if g->>'trottl' is not null and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'trottl')::uuid
  and p.lifecycle_status='alive' and p.lives>0) then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_STATE'; end if;
 if g->>'phase'<>'awaiting_players' and not (g->>'phase' in ('drink_ack','minigame_active','minigame_results','minigame_distribution','panic_results','panic_active') and g->>'actor' is null)
  and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'actor')::uuid and p.seat_index=s.current_turn_seat
   and p.lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR_STATE'; end if;
 return null;
end; $$;
revoke all on function public.special_panic_begin_locked(uuid),public.special_panic_finalize_locked(uuid,boolean),
 public.submit_trottl_special_panic(uuid,uuid,integer),public.get_trottl_special_server_time(uuid),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.leave_trottl_special_session(uuid) from public,anon,authenticated;
grant execute on function public.submit_trottl_special_panic(uuid,uuid,integer),public.get_trottl_special_server_time(uuid),
 public.act_trottl_special_game(uuid,text,bigint,uuid),public.leave_trottl_special_session(uuid) to authenticated;
commit;
