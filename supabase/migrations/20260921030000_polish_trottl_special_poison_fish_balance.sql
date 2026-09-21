begin;

-- Existing version-1 runs retain the deployed 20s / 8-2-3 / old-hitbox rules.
-- New runs use version 2, so a migration during an active round is safe.
alter table public.trottl_special_poison_fish_runs
 drop constraint trottl_special_poison_fish_runs_simulation_version_check;
alter table public.trottl_special_poison_fish_runs
 add constraint trottl_special_poison_fish_runs_simulation_version_check check (simulation_version in (1,2));
alter table public.trottl_special_poison_fish_runs alter column simulation_version set default 2;

create or replace function public.special_poison_fish_config(p_version integer) returns jsonb
language plpgsql immutable security definer set search_path='' as $$
begin
 if p_version is null or p_version not in (1,2) then raise exception 'SPECIAL_POISON_FISH_VERSION';end if;
 return jsonb_build_object('normal',8,'gold',2,'poison',case when p_version=1 then 3 else 5 end,
  'duration_ms',case when p_version=1 then 20000 else 30000 end,'max_events',500,
  'hit_x',case when p_version=1 then 0.08 else 0.10 end,
  'hit_y',case when p_version=1 then 0.065 else 0.08125 end,
  'hitbox_scale',case when p_version=1 then 1 else 1.25 end,
  'speed_min_units',32,'speed_range_units',11);
end; $$;

-- Keep the validated deterministic replay body; only make its time bound
-- version-dependent. The prior duration migration is already applied.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.special_poison_fish_replay(bigint,jsonb,integer)'::regprocedure);
 if strpos(definition,'t>=20000')=0 then raise exception 'Unexpected Giftfisch replay definition';end if;
 execute replace(definition,'t>=20000','t>=(c->>''duration_ms'')::integer');
end; $$;

create or replace function public.special_poison_fish_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_round_id uuid;g jsonb;p jsonb;runs jsonb:='{}'::jsonb;seed bigint;start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 v_round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_07','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  loop
   seed:=1+floor(pg_catalog.random()*2147483646)::bigint;
   exit when not exists(select 1 from public.trottl_special_poison_fish_runs where session_id=p_id and round_id=v_round_id and movement_seed=seed);
  end loop;
  insert into public.trottl_special_poison_fish_runs(session_id,round_id,player_id,movement_seed,simulation_version)
  values(p_id,v_round_id,(p->>'player_id')::uuid,seed,2);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Giftfisch','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds',
  'start_at',start_at,'end_at',start_at+interval '30.4 seconds','runs',runs,'simulation_version',2),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create or replace function public.submit_trottl_special_poison_fish(p_session_id uuid,p_round_id uuid,p_events jsonb,p_final boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_poison_fish_runs;slot smallint;c jsonb;
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
 c:=public.special_poison_fish_config(r.simulation_version);
 play_at:=(m->>'start_at')::timestamptz+interval '400 milliseconds';server_elapsed:=floor(extract(epoch from(now_at-play_at))*1000)::integer;
 if now_at<play_at or now_at>play_at+make_interval(secs=>(c->>'duration_ms')::integer/1000+3)
  or p_events is null or jsonb_typeof(p_events)<>'array' then raise exception 'SPECIAL_POISON_FISH_TIME';end if;
 incoming_count:=jsonb_array_length(p_events);existing_count:=jsonb_array_length(r.events);
 if incoming_count<existing_count then raise exception 'SPECIAL_POISON_FISH_STALE_EVENTS';end if;
 if existing_count>0 and (select jsonb_agg(value order by ordinality) from jsonb_array_elements(p_events) with ordinality e(value,ordinality) where ordinality<=existing_count) is distinct from r.events then raise exception 'SPECIAL_POISON_FISH_STALE_EVENTS';end if;
 score_value:=public.special_poison_fish_replay(r.movement_seed,p_events,r.simulation_version);
 if incoming_count>0 then
  last_event:=p_events->(incoming_count-1);
  if (last_event->>'t')::integer>server_elapsed+1000 then raise exception 'SPECIAL_POISON_FISH_FUTURE_EVENT';end if;
 end if;
 if p_final and now_at<play_at+make_interval(secs=>(c->>'duration_ms')::integer/1000) then raise exception 'SPECIAL_POISON_FISH_NOT_FINISHED';end if;
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

commit;
