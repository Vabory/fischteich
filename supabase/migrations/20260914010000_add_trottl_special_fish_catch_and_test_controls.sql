begin;
-- Active production pool. Slots are enabled only after an implementation ships.
create table public.trottl_special_minigame_registry (
 id text primary key check (id ~ '^special_minigame_(0[1-9]|10)$'),
 title text, implemented boolean not null default false, enabled boolean not null default false,
 check (not enabled or implemented)
);
insert into public.trottl_special_minigame_registry(id,title,implemented,enabled)
select 'special_minigame_'||lpad(n::text,2,'0'),case n when 1 then 'Zahlenjagd' when 2 then 'Fischfang' end,n<=2,n<=2 from generate_series(1,10) n;
alter table public.trottl_special_minigame_registry enable row level security;
revoke all on public.trottl_special_minigame_registry from anon,authenticated;

-- TEMPORARY DEBUG: separate column survives ordinary turn/state replacement.
alter table public.trottl_special_sessions add column debug_test jsonb not null default '{}'::jsonb;
create function public.set_trottl_special_debug_next(p_session_id uuid,p_roll integer default null,p_minigame text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if s.status<>'playing' or s.host_user_id is distinct from auth.uid()
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status<>'left') then raise exception 'SPECIAL_DEBUG_HOST_REQUIRED'; end if;
 if (p_roll is not null and p_roll not between 1 and 6) or (p_minigame is not null and not exists(
  select 1 from public.trottl_special_minigame_registry where id=p_minigame and implemented and enabled)) then raise exception 'SPECIAL_DEBUG_INVALID_OVERRIDE'; end if;
 update public.trottl_special_sessions set debug_test=jsonb_strip_nulls(jsonb_build_object('next_roll',p_roll,'next_minigame',p_minigame)),
  game_state=s.game_state||jsonb_build_object('revision',coalesce((s.game_state->>'revision')::bigint,0)+1) where id=p_session_id;
 return p_session_id;
end; $$;

-- Pure selector: controlled random boundaries can be exercised without live RNG.
create function public.special_minigame_pick(p_random double precision,p_override text default null)
returns text language plpgsql stable security definer set search_path='' as $$
declare pool text[];
begin
 select array_agg(id order by id) into pool from public.trottl_special_minigame_registry where implemented and enabled;
 if pool is null or p_random is null or p_random<0 or p_random>=1 then raise exception 'SPECIAL_INVALID_MINIGAME_POOL'; end if;
 if p_override is not null then
  if not p_override=any(pool) then raise exception 'SPECIAL_INVALID_MINIGAME_OVERRIDE'; end if;
  return p_override;
 end if;
 return pool[1+floor(p_random*array_length(pool,1))::integer];
end; $$;

create function public.special_fish_catch_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r uuid;g jsonb;runs jsonb:='{}'::jsonb;u uuid;t timestamptz:=clock_timestamp();
begin
 r:=public.special_minigame_begin_locked(p_id,'special_minigame_02','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for u in select (p->>'player_id')::uuid from jsonb_array_elements(g->'minigame'->'participants') p loop
  runs:=runs||jsonb_build_object(u::text,jsonb_build_object('seed',1+floor(pg_catalog.random()*2147483646)::bigint,'score',0,'hits','[]'::jsonb,'completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Fischfang','title_started_at',t,'title_ends_at',t+interval '2 seconds','start_at',t+interval '5 seconds','end_at',t+interval '15 seconds','runs',runs),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

-- Existing normal-4 gateway now chooses from the implemented production pool.
alter function public.special_number_hunt_begin_locked(uuid) rename to special_number_hunt_original_begin_locked;
create function public.special_number_hunt_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare chosen text;override_value text;
begin
 select debug_test->>'next_minigame' into override_value from public.trottl_special_sessions where id=p_id for update;
 -- TEMPORARY DEBUG CONSUMPTION: only a matching normal four reaches this helper.
 chosen:=public.special_minigame_pick(case when override_value is null then pg_catalog.random() else 0 end,override_value);
 if chosen='special_minigame_01' then perform public.special_number_hunt_original_begin_locked(p_id);
 elsif chosen='special_minigame_02' then perform public.special_fish_catch_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME'; end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

-- TEMPORARY DEBUG WRAPPER. Prior gateway enforces membership/actor/phase/sequence.
alter function public.act_trottl_special_game(uuid,text,bigint,uuid) rename to act_trottl_special_before_test_controls;
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare slot smallint;s public.trottl_special_sessions;g jsonb;forced integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 perform public.act_trottl_special_before_test_controls(p_session_id,p_action,p_roll_seq,p_target);
 if p_action='roll' and s.game_state->>'phase' in ('awaiting_roll','rescue_roll') and s.debug_test ? 'next_roll' then
  forced:=(s.debug_test->>'next_roll')::integer;
  select game_state into g from public.trottl_special_sessions where id=p_session_id;
  if forced between 1 and 6 and g->>'phase'='rolling' then
   update public.trottl_special_sessions set game_state=g||jsonb_build_object('result',forced,'last_roll',forced),debug_test=debug_test-'next_roll' where id=p_session_id;
  end if;
 end if;
 return p_session_id;
end; $$;

create function public.special_fish_catch_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_02' then return; end if;
 if jsonb_array_length(m->'participants')=0 then perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return; end if;
 if exists(select 1 from jsonb_array_elements(m->'participants') p where not coalesce((m->'runs'->(p->>'player_id')->>'completed')::boolean,false)) then return; end if;
 select jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',m->'runs'->(p->>'player_id')->'score',
  'display_value',(m->'runs'->(p->>'player_id')->>'score')||' Fische')) into inputs from jsonb_array_elements(m->'participants') p;
 perform public.special_minigame_finalize_locked(p_id,(m->>'minigame_id')::uuid,inputs);
end; $$;

-- Small cumulative view checkpoints (client batches at 500ms), one final submission.
-- Scores are device measurements with plausibility checks, as in PANIK; no anti-cheat claim.
create function public.save_trottl_special_fish_catch(p_session_id uuid,p_round_id uuid,p_score integer,p_hits jsonb,p_final boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;m jsonb;r jsonb;slot smallint;t timestamptz;elapsed bigint;
 h jsonb;prev_index integer:=-1;prev_at integer:=-1;i integer;a integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;m:=s.game_state->'minigame';r:=m->'runs'->auth.uid()::text;
 if s.status<>'playing' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type' is distinct from 'special_minigame_02'
  or s.game_state->>'phase' not in ('minigame_active','minigame_results') or r is null
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text) then raise exception 'SPECIAL_INVALID_FISH_CATCH_PARTICIPANT'; end if;
 if p_score is null or p_score<0 or p_score>63 or jsonb_typeof(p_hits) is distinct from 'array' or p_score<>jsonb_array_length(p_hits) or p_final is null then raise exception 'SPECIAL_INVALID_FISH_CATCH_SCORE'; end if;
 t:=clock_timestamp();elapsed:=floor(extract(epoch from (t-(m->>'start_at')::timestamptz))*1000)::bigint;
 if elapsed<0 or (p_final and t<(m->>'end_at')::timestamptz) then raise exception 'SPECIAL_FISH_CATCH_NOT_FINISHED'; end if;
 for h in select value from jsonb_array_elements(p_hits) loop
  if jsonb_typeof(h->'index') is distinct from 'number' or jsonb_typeof(h->'at') is distinct from 'number'
   or (h->>'index') !~ '^[0-9]+$' or (h->>'at') !~ '^[0-9]+$' then raise exception 'SPECIAL_INVALID_FISH_CATCH_HIT'; end if;
  i:=(h->>'index')::integer;a:=(h->>'at')::integer;
  if i<=prev_index or i>62 or a<=prev_at or a>=10000 or a>elapsed+1000 or (prev_at>=0 and a-prev_at<160) then raise exception 'SPECIAL_INVALID_FISH_CATCH_HIT'; end if;
  prev_index:=i;prev_at:=a;
 end loop;
 if coalesce((r->>'completed')::boolean,false) then
  if p_final and p_score=(r->>'score')::integer and p_hits=r->'hits' then return p_session_id; end if;
  raise exception 'SPECIAL_FISH_CATCH_ALREADY_SUBMITTED';
 end if;
 -- Old replies/checkpoints cannot overwrite newer accepted catches.
 if p_score<(r->>'score')::integer then return p_session_id; end if;
 if exists(select 1 from jsonb_array_elements(r->'hits') with ordinality oldhit(v,n) where p_hits->(oldhit.n::integer-1) is distinct from oldhit.v) then raise exception 'SPECIAL_FISH_CATCH_CONFLICT'; end if;
 r:=r||jsonb_build_object('score',p_score,'hits',p_hits,'completed',p_final,'updated_at',t);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,r));
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('minigame',m,'revision',(s.game_state->>'revision')::bigint+1) where id=p_session_id;
 if p_final then perform public.special_fish_catch_finalize_locked(p_session_id); end if;
 return p_session_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_fish_catch;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_02' then return public.leave_trottl_special_before_fish_catch(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text));
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 perform public.special_fish_catch_finalize_locked(p_session_id);return true;
end; $$;

revoke all on function public.special_minigame_pick(double precision,text),public.special_fish_catch_begin_locked(uuid),
 public.special_number_hunt_original_begin_locked(uuid),public.special_number_hunt_begin_locked(uuid),public.special_fish_catch_finalize_locked(uuid),
 public.act_trottl_special_before_test_controls(uuid,text,bigint,uuid),public.leave_trottl_special_before_fish_catch(uuid),
 public.set_trottl_special_debug_next(uuid,integer,text),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean),public.leave_trottl_special_session(uuid) from public,anon,authenticated;
grant execute on function public.set_trottl_special_debug_next(uuid,integer,text),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean),public.leave_trottl_special_session(uuid) to authenticated;
commit;
