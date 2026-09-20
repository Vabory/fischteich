begin;

create table public.trottl_special_fish_memory_rounds (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null,
 seed bigint not null check (seed between 1 and 2147483646),
 pattern jsonb not null check (jsonb_typeof(pattern)='array' and jsonb_array_length(pattern)=12),
 created_at timestamptz not null default clock_timestamp(),
 primary key (session_id,round_id)
);
create table public.trottl_special_fish_memory_runs (
 session_id uuid not null,
 round_id uuid not null,
 player_id uuid not null,
 memory_round integer not null default 1 check (memory_round between 1 and 3),
 phase text not null default 'watch' check (phase in ('watch','input','finished')),
 phase_started_at timestamptz not null,
 phase_ends_at timestamptz,
 input_deadline timestamptz,
 guesses jsonb not null default '[]'::jsonb check (jsonb_typeof(guesses)='array' and jsonb_array_length(guesses)<=12),
 accumulated_errors integer not null default 0 check (accumulated_errors between 0 and 24),
 completed boolean not null default false,
 completed_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 primary key (session_id,round_id,player_id),
 foreign key (session_id,round_id) references public.trottl_special_fish_memory_rounds(session_id,round_id) on delete cascade,
 check ((phase='watch' and phase_ends_at is not null and input_deadline is null and not completed and completed_at is null)
  or (phase='input' and phase_ends_at is null and input_deadline is not null and not completed and completed_at is null)
  or (phase='finished' and phase_ends_at is null and input_deadline is null and completed and completed_at is not null))
);
alter table public.trottl_special_fish_memory_rounds enable row level security;
alter table public.trottl_special_fish_memory_runs enable row level security;
revoke all on public.trottl_special_fish_memory_rounds,public.trottl_special_fish_memory_runs from anon,authenticated;

create function public.special_fish_memory_pattern(p_seed bigint)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare colors text[]:=array['RED','BLUE','GREEN','YELLOW'];answer text[]:='{}';i integer;value bigint:=p_seed;color_index integer;
begin
 if p_seed not between 1 and 2147483646 then raise exception 'SPECIAL_INVALID_FISH_MEMORY_SEED'; end if;
 for i in 1..12 loop
  value:=mod(value::numeric*48271,2147483647)::bigint;
  color_index:=1+mod(value,4)::integer;
  if i>=3 and answer[i-1]=answer[i-2] and colors[color_index]=answer[i-1] then
   color_index:=1+mod((color_index-1)+1+mod(value/4,3)::integer,4);
  end if;
  answer:=array_append(answer,colors[color_index]);
 end loop;
 return to_jsonb(answer);
end; $$;

create function public.special_fish_memory_timeout_ms(p_memory_round integer)
returns integer language sql immutable security definer set search_path='' as $$
 select case p_memory_round when 1 then 8000 when 2 then 13000 when 3 then 18000 else null end;
$$;
create function public.special_fish_memory_watch_ms(p_memory_round integer)
returns integer language sql immutable security definer set search_path='' as $$
 select case when p_memory_round between 1 and 3 then p_memory_round*4*1020 else null end;
$$;
create function public.special_fish_memory_error_count(p_pattern jsonb,p_guesses jsonb,p_expected_count integer)
returns integer language sql immutable security definer set search_path='' as $$
 select p_expected_count-count(*)::integer+count(*) filter(where guess.value#>>'{}' is distinct from p_pattern->>((guess.ordinality-1)::integer))::integer
 from jsonb_array_elements(p_guesses) with ordinality as guess(value,ordinality);
$$;

update public.trottl_special_minigame_registry
set title='Fisch-Memory',implemented=true,enabled=true
where id='special_minigame_05';

create function public.special_fish_memory_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare memory_round_id uuid;g jsonb;runs jsonb:='{}'::jsonb;p jsonb;seed_value bigint;pattern_value jsonb;
 title_at timestamptz:=clock_timestamp();start_at timestamptz;
begin
 memory_round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_05','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 start_at:=title_at+interval '5 seconds';seed_value:=1+floor(pg_catalog.random()*2147483646)::bigint;
 pattern_value:=public.special_fish_memory_pattern(seed_value);
 insert into public.trottl_special_fish_memory_rounds(session_id,round_id,seed,pattern)
 values(p_id,memory_round_id,seed_value,pattern_value);
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  insert into public.trottl_special_fish_memory_runs(session_id,round_id,player_id,phase_started_at,phase_ends_at)
   values(p_id,memory_round_id,(p->>'player_id')::uuid,start_at+400*interval '1 millisecond',start_at+4480*interval '1 millisecond');
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('memory_round',1,'phase','watch','guess_count',0,'completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Fisch-Memory','title_started_at',title_at,'title_ends_at',title_at+interval '2 seconds','start_at',start_at,'runs',runs),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.special_fish_memory_advance_run_locked(p_session_id uuid,p_round_id uuid,p_player_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.trottl_special_fish_memory_runs;pattern_value jsonb;now_at timestamptz:=clock_timestamp();deadline timestamptz;
 expected_count integer;round_errors integer;next_round integer;watch_ms integer;
begin
 select * into r from public.trottl_special_fish_memory_runs where session_id=p_session_id and round_id=p_round_id and player_id=p_player_id for update;
 if not found or r.completed then return; end if;
 select pattern into pattern_value from public.trottl_special_fish_memory_rounds where session_id=p_session_id and round_id=p_round_id;
 loop
  if r.phase='watch' and now_at>=r.phase_ends_at then
   deadline:=r.phase_ends_at+public.special_fish_memory_timeout_ms(r.memory_round)*interval '1 millisecond';
   update public.trottl_special_fish_memory_runs set phase='input',phase_started_at=r.phase_ends_at,phase_ends_at=null,input_deadline=deadline,updated_at=now_at
    where session_id=p_session_id and round_id=p_round_id and player_id=p_player_id returning * into r;
   if now_at<deadline then return; end if;
  elsif r.phase='input' and now_at>=r.input_deadline then
   expected_count:=r.memory_round*4;round_errors:=public.special_fish_memory_error_count(pattern_value,r.guesses,expected_count);
   if r.memory_round<3 then
    next_round:=r.memory_round+1;watch_ms:=public.special_fish_memory_watch_ms(next_round);
    update public.trottl_special_fish_memory_runs set memory_round=next_round,phase='watch',phase_started_at=now_at,
     phase_ends_at=now_at+watch_ms*interval '1 millisecond',input_deadline=null,guesses='[]'::jsonb,
     accumulated_errors=r.accumulated_errors+round_errors,updated_at=now_at
     where session_id=p_session_id and round_id=p_round_id and player_id=p_player_id;
   else
    update public.trottl_special_fish_memory_runs set phase='finished',phase_started_at=now_at,phase_ends_at=null,input_deadline=null,
     accumulated_errors=r.accumulated_errors+round_errors,completed=true,completed_at=now_at,updated_at=now_at
     where session_id=p_session_id and round_id=p_round_id and player_id=p_player_id;
   end if;
   return;
  else return;
  end if;
 end loop;
end; $$;

create function public.get_trottl_special_fish_memory_view(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_fish_memory_runs;pattern_value jsonb;is_spectator boolean:=false;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active'
  or s.game_state->'minigame'->>'minigame_type' is distinct from 'special_minigame_05' then return null; end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;is_spectator:=true;
 else raise exception 'SPECIAL_FISH_MEMORY_VIEW_REQUIRED'; end if;
 select * into r from public.trottl_special_fish_memory_runs where session_id=p_session_id
  and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid and player_id=target;
 if not found then return null; end if;
 select pattern into pattern_value from public.trottl_special_fish_memory_rounds where session_id=p_session_id and round_id=r.round_id;
 return jsonb_build_object('player_id',r.player_id,'pattern',pattern_value,'memory_round',r.memory_round,'phase',r.phase,
  'phase_started_at',r.phase_started_at,'phase_ends_at',r.phase_ends_at,'input_deadline',r.input_deadline,
  'guess_count',jsonb_array_length(r.guesses),'completed',r.completed,'errors',case when r.completed and not is_spectator then r.accumulated_errors else null end);
end; $$;

create function public.special_fish_memory_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_05' then return; end if;
 if jsonb_array_length(m->'participants')=0 then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;
 end if;
 if exists(select 1 from public.trottl_special_fish_memory_runs where session_id=p_id
  and round_id=(m->>'minigame_id')::uuid and not completed) then return; end if;
 select jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',r.accumulated_errors,
  'display_value',r.accumulated_errors::text||' Fehler') order by p.ordinality)
 into inputs from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_fish_memory_runs r on r.player_id=(p.p->>'player_id')::uuid
  and r.session_id=p_id and r.round_id=(m->>'minigame_id')::uuid;
 perform public.special_minigame_finalize_locked(p_id,(m->>'minigame_id')::uuid,inputs);
end; $$;

create function public.sync_trottl_special_fish_memory(p_session_id uuid,p_round_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;target uuid;r public.trottl_special_fish_memory_runs;slot smallint;public_run jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or m->>'minigame_type' is distinct from 'special_minigame_05' then raise exception 'SPECIAL_STALE_FISH_MEMORY'; end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;
 else raise exception 'SPECIAL_FISH_MEMORY_VIEW_REQUIRED'; end if;
 perform public.special_fish_memory_advance_run_locked(p_session_id,p_round_id,target);
 select * into r from public.trottl_special_fish_memory_runs where session_id=p_session_id and round_id=p_round_id and player_id=target;
 public_run:=jsonb_build_object('memory_round',r.memory_round,'phase',r.phase,'guess_count',jsonb_array_length(r.guesses),'completed',r.completed);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(target::text,public_run));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 if r.completed then perform public.special_fish_memory_finalize_locked(p_session_id); end if;
 return p_session_id;
end; $$;

create function public.guess_trottl_special_fish_memory(
 p_session_id uuid,p_round_id uuid,p_memory_round integer,p_guess_index integer,p_selected_color text,p_client_timestamp_ms bigint default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_fish_memory_runs;pattern_value jsonb;slot smallint;
 expected_count integer;round_errors integer;next_round integer;watch_ms integer;now_at timestamptz:=clock_timestamp();public_run jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or m->>'minigame_type' is distinct from 'special_minigame_05'
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then raise exception 'SPECIAL_INVALID_FISH_MEMORY_PARTICIPANT'; end if;
 perform public.special_fish_memory_advance_run_locked(p_session_id,p_round_id,auth.uid());
 select * into r from public.trottl_special_fish_memory_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;
 if not found or r.completed or r.phase<>'input' or r.memory_round is distinct from p_memory_round then raise exception 'SPECIAL_STALE_FISH_MEMORY_GUESS'; end if;
 expected_count:=r.memory_round*4;
 if p_guess_index is distinct from jsonb_array_length(r.guesses) or p_guess_index not between 0 and expected_count-1
  or p_selected_color is null or p_selected_color not in ('RED','BLUE','GREEN','YELLOW')
  or (p_client_timestamp_ms is not null and p_client_timestamp_ms<0) then raise exception 'SPECIAL_INVALID_FISH_MEMORY_GUESS'; end if;
 r.guesses:=r.guesses||jsonb_build_array(p_selected_color);
 if jsonb_array_length(r.guesses)=expected_count then
  select pattern into pattern_value from public.trottl_special_fish_memory_rounds where session_id=p_session_id and round_id=p_round_id;
  round_errors:=public.special_fish_memory_error_count(pattern_value,r.guesses,expected_count);
  if r.memory_round<3 then
   next_round:=r.memory_round+1;watch_ms:=public.special_fish_memory_watch_ms(next_round);
   update public.trottl_special_fish_memory_runs set memory_round=next_round,phase='watch',phase_started_at=now_at,
    phase_ends_at=now_at+watch_ms*interval '1 millisecond',input_deadline=null,guesses='[]'::jsonb,
    accumulated_errors=r.accumulated_errors+round_errors,updated_at=now_at
    where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() returning * into r;
  else
   update public.trottl_special_fish_memory_runs set phase='finished',phase_started_at=now_at,phase_ends_at=null,input_deadline=null,
    guesses=r.guesses,accumulated_errors=r.accumulated_errors+round_errors,completed=true,completed_at=now_at,updated_at=now_at
    where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() returning * into r;
  end if;
 else
  update public.trottl_special_fish_memory_runs set guesses=r.guesses,updated_at=now_at
   where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() returning * into r;
 end if;
 public_run:=jsonb_build_object('memory_round',r.memory_round,'phase',r.phase,'guess_count',jsonb_array_length(r.guesses),'completed',r.completed);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,public_run));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 if r.completed then perform public.special_fish_memory_finalize_locked(p_session_id); end if;
 return p_session_id;
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
 elsif chosen='special_minigame_04' then perform public.special_color_chaos_begin_locked(p_id);
 elsif chosen='special_minigame_05' then perform public.special_fish_memory_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME'; end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_fish_memory;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_05'
  then return public.leave_trottl_special_before_fish_memory(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 delete from public.trottl_special_fish_memory_runs where session_id=p_session_id and round_id=(m->>'minigame_id')::uuid and player_id=auth.uid();
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text),
  'runs',(m->'runs')-auth.uid()::text);
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 perform public.special_fish_memory_finalize_locked(p_session_id);return true;
end; $$;

revoke all on function public.special_fish_memory_pattern(bigint),public.special_fish_memory_timeout_ms(integer),public.special_fish_memory_watch_ms(integer),
 public.special_fish_memory_error_count(jsonb,jsonb,integer),public.special_fish_memory_begin_locked(uuid),
 public.special_fish_memory_advance_run_locked(uuid,uuid,uuid),public.special_fish_memory_finalize_locked(uuid),public.special_number_hunt_begin_locked(uuid),
 public.leave_trottl_special_before_fish_memory(uuid),public.leave_trottl_special_session(uuid),public.get_trottl_special_fish_memory_view(uuid),
 public.sync_trottl_special_fish_memory(uuid,uuid),public.guess_trottl_special_fish_memory(uuid,uuid,integer,integer,text,bigint)
 from public,anon,authenticated;
grant execute on function public.leave_trottl_special_session(uuid),public.get_trottl_special_fish_memory_view(uuid),
 public.sync_trottl_special_fish_memory(uuid,uuid),public.guess_trottl_special_fish_memory(uuid,uuid,integer,integer,text,bigint) to authenticated;

commit;
