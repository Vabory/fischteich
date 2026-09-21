begin;

create table public.trottl_special_fish_count_rounds (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null, seed bigint not null check(seed between 1 and 2147483646),
 fish_count integer not null check(fish_count between 5 and 18),
 reveal_duration_ms integer not null check(reveal_duration_ms between 1000 and 2000),
 choices jsonb not null check(jsonb_typeof(choices)='array' and jsonb_array_length(choices)=4),
 answer_started_at timestamptz not null, answer_deadline timestamptz not null,
 primary key(session_id,round_id)
);
create table public.trottl_special_fish_count_runs (
 session_id uuid not null, round_id uuid not null, player_id uuid not null,
 selected_answer integer, response_ms integer, correct boolean,
 completed boolean not null default false, completed_at timestamptz,
 primary key(session_id,round_id,player_id),
 foreign key(session_id,round_id) references public.trottl_special_fish_count_rounds(session_id,round_id) on delete cascade,
 check ((not completed and selected_answer is null and response_ms is null and correct is null and completed_at is null)
  or (completed and completed_at is not null and (selected_answer is null or response_ms is not null) and correct is not null))
);
alter table public.trottl_special_fish_count_rounds enable row level security;
alter table public.trottl_special_fish_count_runs enable row level security;
revoke all on public.trottl_special_fish_count_rounds,public.trottl_special_fish_count_runs from anon,authenticated;

create function public.special_fish_count_for_seed(p_seed bigint) returns integer
language sql immutable security definer set search_path='' as $$ select 5+mod(p_seed,14)::integer $$;
create function public.special_fish_count_reveal_ms(p_count integer) returns integer
language sql immutable security definer set search_path='' as $$ select 1000+round((p_count-5)*1000.0/13)::integer $$;
create function public.special_fish_count_choices(p_seed bigint,p_count integer) returns jsonb
language sql immutable security definer set search_path='' as $$
 select jsonb_agg(value order by md5(p_seed::text||':'||value::text)) from (
  select p_count+delta as value from unnest(case when mod(p_seed,2)=0 then array[-2,-1,0,1] else array[-1,0,1,2] end) as offsets(delta)
 ) options;
$$;

update public.trottl_special_minigame_registry set title='Fische zählen',implemented=true,enabled=true where id='special_minigame_08';

create function public.special_fish_count_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_round uuid;g jsonb;m jsonb;v_seed bigint;v_count integer;v_reveal integer;
 v_title timestamptz:=clock_timestamp();v_start timestamptz;v_answer timestamptz;v_player jsonb;v_runs jsonb:='{}'::jsonb;
begin
 v_round:=public.special_minigame_begin_locked(p_id,'special_minigame_08','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 v_seed:=1+floor(pg_catalog.random()*2147483646)::bigint;
 v_count:=public.special_fish_count_for_seed(v_seed);v_reveal:=public.special_fish_count_reveal_ms(v_count);
 v_start:=v_title+interval '5 seconds';v_answer:=v_start+(1100+v_reveal)*interval '1 millisecond';
 insert into public.trottl_special_fish_count_rounds values
  (p_id,v_round,v_seed,v_count,v_reveal,public.special_fish_count_choices(v_seed,v_count),v_answer,v_answer+interval '10 seconds');
 for v_player in select value from jsonb_array_elements(m->'participants') loop
  insert into public.trottl_special_fish_count_runs(session_id,round_id,player_id)
   values(p_id,v_round,(v_player->>'player_id')::uuid);
  v_runs:=v_runs||jsonb_build_object(v_player->>'player_id',jsonb_build_object('completed',false));
 end loop;
 m:=m||jsonb_build_object('title','Fische zählen','title_started_at',v_title,'title_ends_at',v_title+interval '2 seconds',
  'start_at',v_start,'runs',v_runs);
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_fish_count_view(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;r public.trottl_special_fish_count_rounds;
 target uuid;answered boolean;is_spectator boolean:=false;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active' or s.game_state->'minigame'->>'minigame_type'<>'special_minigame_08' then return null;end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical')) then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()) then target:=s.host_user_id;is_spectator:=true;
 else raise exception 'SPECIAL_FISH_COUNT_VIEW_REQUIRED';end if;
 select * into r from public.trottl_special_fish_count_rounds where session_id=p_session_id and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid;
 select completed into answered from public.trottl_special_fish_count_runs where session_id=p_session_id and round_id=r.round_id and player_id=target;
 -- No selected answer or correctness leaves the private tables until the common result phase.
 return jsonb_build_object('seed',r.seed,'reveal_duration_ms',r.reveal_duration_ms,'choices',r.choices,
  'answer_started_at',r.answer_started_at,'answer_deadline',r.answer_deadline,'answered',coalesce(answered,false),
  'player_id',target,'spectator',is_spectator);
end; $$;

create function public.special_fish_count_finalize_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;r public.trottl_special_fish_count_rounds;v_round uuid;v_input jsonb;v_results jsonb;
 v_winners jsonb;v_losers jsonb;v_auto jsonb;v_dist jsonb;v_all_wrong boolean;v_best integer;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_08' then return;end if;
 v_round:=(m->>'minigame_id')::uuid;
 if jsonb_array_length(m->'participants')=0 then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;
 end if;
 select * into r from public.trottl_special_fish_count_rounds where session_id=p_id and round_id=v_round;
 if clock_timestamp()<r.answer_deadline and exists(select 1 from jsonb_array_elements(m->'participants') p
  join public.trottl_special_fish_count_runs run on run.player_id=(p->>'player_id')::uuid and run.session_id=p_id and run.round_id=v_round
  where not run.completed) then return;end if;
 update public.trottl_special_fish_count_runs set completed=true,completed_at=r.answer_deadline,correct=false
  where session_id=p_id and round_id=v_round and not completed;
 select min(run.response_ms) into v_best from public.trottl_special_fish_count_runs run
  join jsonb_array_elements(m->'participants') p on p->>'player_id'=run.player_id::text
  where run.session_id=p_id and run.round_id=v_round and run.correct;
 v_all_wrong:=v_best is null;
 select jsonb_agg(jsonb_build_object('player_id',p.p->>'player_id','raw_value',case when run.correct then 20000-run.response_ms else 0 end,
  'display_value',case when run.selected_answer is null then 'Falsch · Zeit abgelaufen'
   when run.correct then 'Richtig · '||replace(to_char(run.response_ms/1000.0,'FM999990.00'),'.',',')||' s'
   else 'Falsch · Antwort: '||run.selected_answer::text end) order by p.ordinality) into v_input
 from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_fish_count_runs run on run.player_id=(p.p->>'player_id')::uuid and run.session_id=p_id and run.round_id=v_round;
 perform public.special_minigame_finalize_locked(p_id,v_round,v_input);
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 select jsonb_agg(item||jsonb_build_object('is_winner',run.correct and run.response_ms=v_best,
  'is_loser',not run.correct,'rank',case when run.correct then 1+(select count(distinct faster.response_ms) from public.trottl_special_fish_count_runs faster
    where faster.session_id=p_id and faster.round_id=v_round and faster.correct and faster.response_ms<run.response_ms) else null end)
  order by case when run.correct then 0 else 1 end,run.response_ms nulls last,item->>'player_id') into v_results
 from jsonb_array_elements(m->'results') item
 join public.trottl_special_fish_count_runs run on run.player_id=(item->>'player_id')::uuid and run.session_id=p_id and run.round_id=v_round;
 select coalesce(jsonb_agg(item->'player_id' order by item->>'player_id') filter(where (item->>'is_winner')::boolean),'[]'::jsonb),
  coalesce(jsonb_agg(item->'player_id' order by item->>'player_id') filter(where (item->>'is_loser')::boolean),'[]'::jsonb)
  into v_winners,v_losers from jsonb_array_elements(v_results) item;
 select coalesce(jsonb_object_agg(value,case when v_all_wrong then 4 else 2 end),'{}'::jsonb) into v_auto from jsonb_array_elements_text(v_losers);
 select coalesce(jsonb_object_agg(value,jsonb_build_object('drinks','{}'::jsonb,'confirmed',false,'cancelled',false)),'{}'::jsonb)
  into v_dist from jsonb_array_elements_text(v_winners);
 m:=m||jsonb_build_object('results',v_results,'winners',v_winners,'losers',v_losers,'draw',false,
  'all_wrong',v_all_wrong,'loser_drink_count',case when v_all_wrong then 4 else 2 end,
  'correct_count',r.fish_count,'automatic_drinks',v_auto,'distributions',v_dist);
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'drinks',v_auto,
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.answer_trottl_special_fish_count(p_session_id uuid,p_round_id uuid,p_selected_answer integer,p_tap_elapsed_ms integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_fish_count_rounds;
 slot smallint;now_at timestamptz:=clock_timestamp();server_elapsed integer;response integer;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or m->>'minigame_type'<>'special_minigame_08'
  or (m->>'minigame_id')::uuid is distinct from p_round_id
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in('alive','critical'))
  then raise exception 'SPECIAL_INVALID_FISH_COUNT_PARTICIPANT';end if;
 select * into r from public.trottl_special_fish_count_rounds where session_id=p_session_id and round_id=p_round_id;
 if exists(select 1 from public.trottl_special_fish_count_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() and completed) then return p_session_id;end if;
 if now_at<r.answer_started_at or now_at>=r.answer_deadline or p_selected_answer is null
  or not (r.choices @> jsonb_build_array(p_selected_answer)) then raise exception 'SPECIAL_INVALID_FISH_COUNT_ANSWER';end if;
 server_elapsed:=floor(extract(epoch from(now_at-r.answer_started_at))*1000)::integer;
 if p_tap_elapsed_ms is null or p_tap_elapsed_ms<0 or p_tap_elapsed_ms>10000
  or p_tap_elapsed_ms<server_elapsed-1000 or p_tap_elapsed_ms>server_elapsed+1000 then raise exception 'SPECIAL_INVALID_FISH_COUNT_TIME';end if;
 response:=p_tap_elapsed_ms;
 update public.trottl_special_fish_count_runs set selected_answer=p_selected_answer,response_ms=response,
  correct=p_selected_answer=r.fish_count,completed=true,completed_at=now_at
  where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,jsonb_build_object('completed',true)));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_fish_count_finalize_locked(p_session_id);
 return p_session_id;
end; $$;

create function public.finalize_trottl_special_fish_count(p_session_id uuid,p_round_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active' or s.game_state->'minigame'->>'minigame_type'<>'special_minigame_08'
  or (s.game_state->'minigame'->>'minigame_id')::uuid is distinct from p_round_id
  or (not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid())
   and not exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid()))
  then raise exception 'SPECIAL_INVALID_FISH_COUNT_FINALIZE';end if;
 perform public.special_fish_count_finalize_locked(p_session_id);
 return p_session_id;
end; $$;

create or replace function public.special_number_hunt_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare chosen text;override_value text;
begin
 select debug_test->>'next_minigame' into override_value from public.trottl_special_sessions where id=p_id for update;
 chosen:=public.special_minigame_pick(case when override_value is null then pg_catalog.random() else 0 end,override_value);
 if chosen='special_minigame_01' then perform public.special_number_hunt_original_begin_locked(p_id);
 elsif chosen='special_minigame_02' then perform public.special_fish_catch_begin_locked(p_id);
 elsif chosen='special_minigame_03' then perform public.special_reaction_begin_locked(p_id);
 elsif chosen='special_minigame_04' then perform public.special_color_chaos_begin_locked(p_id);
 elsif chosen='special_minigame_05' then perform public.special_fish_memory_begin_locked(p_id);
 elsif chosen='special_minigame_06' then perform public.special_stop_fish_begin_locked(p_id);
 elsif chosen='special_minigame_07' then perform public.special_poison_fish_begin_locked(p_id);
 elsif chosen='special_minigame_08' then perform public.special_fish_count_begin_locked(p_id);
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME';end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

revoke all on function public.special_fish_count_for_seed(bigint),public.special_fish_count_reveal_ms(integer),
 public.special_fish_count_choices(bigint,integer),public.special_fish_count_begin_locked(uuid),
 public.special_fish_count_finalize_locked(uuid),public.get_trottl_special_fish_count_view(uuid),
 public.answer_trottl_special_fish_count(uuid,uuid,integer,integer),public.finalize_trottl_special_fish_count(uuid,uuid),
 public.special_number_hunt_begin_locked(uuid) from public,anon,authenticated;
grant execute on function public.get_trottl_special_fish_count_view(uuid),
 public.answer_trottl_special_fish_count(uuid,uuid,integer,integer),public.finalize_trottl_special_fish_count(uuid,uuid) to authenticated;
commit;
