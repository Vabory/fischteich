begin;

create table public.trottl_special_reaction_runs (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null,
 player_id uuid not null,
 delay_ms integer not null check (delay_ms between 2000 and 8500),
 signal_at timestamptz not null,
 status text not null default 'open' check (status in ('open','completed','false_start','timeout')),
 reaction_ms integer check (reaction_ms is null or reaction_ms between 0 and 8000),
 tap_elapsed_ms integer check (tap_elapsed_ms is null or tap_elapsed_ms between 0 and 10000),
 finished_at timestamptz,
 primary key (session_id,round_id,player_id),
 check ((status='completed' and reaction_ms is not null and tap_elapsed_ms is not null and finished_at is not null)
   or (status in ('false_start','timeout') and reaction_ms is null and finished_at is not null)
   or (status='open' and reaction_ms is null and tap_elapsed_ms is null and finished_at is null))
);
alter table public.trottl_special_reaction_runs enable row level security;
revoke all on public.trottl_special_reaction_runs from anon,authenticated;

update public.trottl_special_minigame_registry
set title='Reaktionstest',implemented=true,enabled=true
where id='special_minigame_03';

create function public.special_reaction_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare round_id uuid;g jsonb;runs jsonb:='{}'::jsonb;p jsonb;delay integer;
 started timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_03','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  delay:=2000+floor(pg_catalog.random()*6501)::integer;
  insert into public.trottl_special_reaction_runs(session_id,round_id,player_id,delay_ms,signal_at)
   values(p_id,round_id,(p->>'player_id')::uuid,delay,started+delay*interval '1 millisecond');
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('status','open','completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Reaktionstest','title_started_at',started-interval '5 seconds','title_ends_at',started-interval '3 seconds',
  'start_at',started,'end_at',started+interval '10 seconds','runs',runs),'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_reaction_view(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_reaction_runs;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 if s.status<>'playing' or s.game_state->'minigame'->>'minigame_type' is distinct from 'special_minigame_03' then return null; end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical')) then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;
 else raise exception 'SPECIAL_REACTION_VIEW_REQUIRED'; end if;
 select * into r from public.trottl_special_reaction_runs where session_id=p_session_id
  and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid and player_id=target;
 if not found then return null; end if;
 return jsonb_build_object('player_id',r.player_id,'delay_ms',r.delay_ms,'signal_at',r.signal_at,
  'status',r.status,'reaction_ms',r.reaction_ms);
end; $$;

create function public.special_reaction_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;v_round uuid;valid_count integer;penalty_count integer;best integer;worst integer;
 results jsonb;winners jsonb;losers jsonb;automatic jsonb;distributions jsonb;all_tied boolean;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_03' then return; end if;
 v_round:=(m->>'minigame_id')::uuid;
 if jsonb_array_length(m->'participants')=0 then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;
 end if;
 if exists(select 1 from public.trottl_special_reaction_runs where session_id=p_id and round_id=v_round and status='open') then return; end if;
 select count(*) filter(where r.status='completed'),count(*) filter(where r.status<>'completed'),
  min(r.reaction_ms) filter(where r.status='completed'),max(r.reaction_ms) filter(where r.status='completed')
  into valid_count,penalty_count,best,worst
 from public.trottl_special_reaction_runs r where r.session_id=p_id and r.round_id=v_round;
 all_tied:=penalty_count=0 and valid_count>0 and best=worst;
 with participant as (
  select p->>'player_id' player_id,p->>'display_name' display_name,ordinality seat_order
  from jsonb_array_elements(m->'participants') with ordinality item(p,ordinality)
 ), ranked as (
  select participant.*,r.status,r.reaction_ms,
   case when r.status='completed' then rank() over(order by case when r.status='completed' then r.reaction_ms end nulls last) end as rank
  from participant join public.trottl_special_reaction_runs r on r.player_id=participant.player_id::uuid
   and r.session_id=p_id and r.round_id=v_round
 )
 select jsonb_agg(jsonb_build_object('player_id',player_id,'display_name',display_name,'raw_value',reaction_ms,'reaction_ms',reaction_ms,
   'status',status,'display_value',case status when 'completed' then reaction_ms||' ms' when 'false_start' then 'FEHLSTART' else 'ZEIT ABGELAUFEN' end,
   'rank',rank,'is_penalty',status<>'completed','is_winner',status='completed' and reaction_ms=best,
   'is_loser',status<>'completed' or (best is distinct from worst and status='completed' and reaction_ms=worst))
   order by (status<>'completed'),reaction_ms nulls last,seat_order)
 into results from ranked;
 select coalesce(jsonb_agg(p.p->>'player_id' order by p.ordinality) filter(where r.status='completed' and r.reaction_ms=best),'[]'::jsonb),
  coalesce(jsonb_agg(p.p->>'player_id' order by p.ordinality) filter(where r.status<>'completed' or (best is distinct from worst and r.status='completed' and r.reaction_ms=worst)),'[]'::jsonb)
 into winners,losers from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_reaction_runs r on r.player_id=(p.p->>'player_id')::uuid and r.session_id=p_id and r.round_id=v_round;
 select coalesce(jsonb_object_agg(value,2),'{}'::jsonb) into automatic from jsonb_array_elements_text(losers);
 select coalesce(jsonb_object_agg(value,jsonb_build_object('drinks','{}'::jsonb,'confirmed',false,'cancelled',false)),'{}'::jsonb)
  into distributions from jsonb_array_elements_text(winners);
 m:=m||jsonb_build_object('results',results,'winners',winners,'losers',losers,'draw',false,'all_tied',all_tied,
  'finished_at',clock_timestamp(),'status','results','result_seen','{}'::jsonb,'automatic_drinks',automatic,'distributions',distributions,'settlement','drinks');
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('phase','minigame_results','minigame',m,
  'drinks',automatic,'acks','{}'::jsonb,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.submit_trottl_special_reaction(p_session_id uuid,p_round_id uuid,p_tap_elapsed_ms integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_reaction_runs;slot smallint;now_at timestamptz;
 server_elapsed integer;outcome text;reaction integer;public_run jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';now_at:=clock_timestamp();
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or m->>'minigame_type' is distinct from 'special_minigame_03' or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then raise exception 'SPECIAL_INVALID_REACTION_PARTICIPANT'; end if;
 select * into r from public.trottl_special_reaction_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;
 if not found then raise exception 'SPECIAL_INVALID_REACTION_RUN'; end if;
 if r.status<>'open' then return p_session_id; end if;
 server_elapsed:=floor(extract(epoch from (now_at-(m->>'start_at')::timestamptz))*1000)::integer;
 if p_tap_elapsed_ms is null or p_tap_elapsed_ms<0 or p_tap_elapsed_ms>10000 or p_tap_elapsed_ms>server_elapsed+1000 then raise exception 'SPECIAL_INVALID_REACTION_TIME'; end if;
 if now_at>=(m->>'end_at')::timestamptz or p_tap_elapsed_ms>=10000 then outcome:='timeout';reaction:=null;
 elsif p_tap_elapsed_ms<r.delay_ms then outcome:='false_start';reaction:=null;
 else outcome:='completed';reaction:=p_tap_elapsed_ms-r.delay_ms;
 end if;
 update public.trottl_special_reaction_runs set status=outcome,reaction_ms=reaction,tap_elapsed_ms=p_tap_elapsed_ms,finished_at=now_at
  where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();
 public_run=jsonb_build_object('status',outcome,'completed',true);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,public_run));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_reaction_finalize_locked(p_session_id);return p_session_id;
end; $$;

create function public.finalize_trottl_special_reaction(p_session_id uuid,p_round_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;now_at timestamptz:=clock_timestamp();runs jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or m->>'minigame_type' is distinct from 'special_minigame_03'
  or (not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid())
    and not exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()))
  then raise exception 'SPECIAL_INVALID_REACTION_FINALIZE'; end if;
 if now_at<(m->>'end_at')::timestamptz then raise exception 'SPECIAL_REACTION_NOT_FINISHED'; end if;
 update public.trottl_special_reaction_runs set status='timeout',reaction_ms=null,tap_elapsed_ms=10000,finished_at=now_at
  where session_id=p_session_id and round_id=p_round_id and status='open';
 select jsonb_object_agg(e.key,case when e.value->>'status'='open' then jsonb_build_object('status','timeout','completed',true) else e.value end)
  into runs from jsonb_each(m->'runs') e;
 m:=m||jsonb_build_object('runs',coalesce(runs,'{}'::jsonb));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_reaction_finalize_locked(p_session_id);return p_session_id;
end; $$;

create or replace function public.special_number_hunt_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare chosen text;override_value text;
begin
 select debug_test->>'next_minigame' into override_value from public.trottl_special_sessions where id=p_id for update;
 chosen:=public.special_minigame_pick(case when override_value is null then pg_catalog.random() else 0 end,override_value);
 if chosen='special_minigame_01' then perform public.special_number_hunt_original_begin_locked(p_id);
 elsif chosen='special_minigame_02' then perform public.special_fish_catch_begin_locked(p_id);
 elsif chosen='special_minigame_03' then perform public.special_reaction_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME'; end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_reaction_test;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_03' then return public.leave_trottl_special_before_reaction_test(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 delete from public.trottl_special_reaction_runs where session_id=p_session_id and round_id=(m->>'minigame_id')::uuid and player_id=auth.uid();
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text),
  'runs',(m->'runs')-auth.uid()::text);
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 perform public.special_reaction_finalize_locked(p_session_id);return true;
end; $$;

revoke all on function public.special_reaction_begin_locked(uuid),public.special_reaction_finalize_locked(uuid),
 public.special_number_hunt_begin_locked(uuid),public.leave_trottl_special_before_reaction_test(uuid),public.leave_trottl_special_session(uuid),
 public.get_trottl_special_reaction_view(uuid),public.submit_trottl_special_reaction(uuid,uuid,integer),public.finalize_trottl_special_reaction(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.leave_trottl_special_session(uuid),public.get_trottl_special_reaction_view(uuid),
 public.submit_trottl_special_reaction(uuid,uuid,integer),public.finalize_trottl_special_reaction(uuid,uuid) to authenticated;

commit;
