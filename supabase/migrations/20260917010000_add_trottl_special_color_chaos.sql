begin;

create table public.trottl_special_color_chaos_runs (
 session_id uuid not null references public.trottl_special_sessions(id) on delete cascade,
 round_id uuid not null,
 player_id uuid not null,
 seed bigint not null check (seed between 1 and 2147483646),
 progress integer not null default 0 check (progress between 0 and 5),
 challenge_index integer not null default 0 check (challenge_index >= 0),
 started_at timestamptz not null,
 completed boolean not null default false,
 elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (session_id,round_id,player_id),
 check ((completed and progress=5 and elapsed_ms is not null) or (not completed and progress<5 and elapsed_ms is null))
);
alter table public.trottl_special_color_chaos_runs enable row level security;
revoke all on public.trottl_special_color_chaos_runs from anon,authenticated;

create function public.special_color_chaos_value(p_seed bigint,p_index integer,p_salt integer)
returns integer language sql immutable security definer set search_path='' as $$
 select mod(p_seed::numeric*48271+(p_index+1)::numeric*69621+p_salt::numeric*12345,2147483647)::integer;
$$;

create function public.special_color_chaos_challenge(p_seed bigint,p_index integer)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare colors text[]:=array['RED','BLUE','GREEN','YELLOW'];target text;ink_options text[];ink text;
 order_colors text[]:=array['RED','BLUE','GREEN','YELLOW'];i integer;j integer;swap_color text;
begin
 if p_seed not between 1 and 2147483646 or p_index<0 then raise exception 'SPECIAL_INVALID_COLOR_CHAOS_SEED'; end if;
 target:=colors[1+mod(public.special_color_chaos_value(p_seed,p_index,1),4)];
 ink_options:=array_remove(colors,target);
 ink:=ink_options[1+mod(public.special_color_chaos_value(p_seed,p_index,2),3)];
 for i in reverse 4..2 loop
  j:=1+mod(public.special_color_chaos_value(p_seed,p_index,10+i),i);
  swap_color:=order_colors[i];order_colors[i]:=order_colors[j];order_colors[j]:=swap_color;
 end loop;
 return jsonb_build_object('target_color',target,'ink_color',ink,'fish_order',to_jsonb(order_colors));
end; $$;

update public.trottl_special_minigame_registry
set title='Farbenchaos',implemented=true,enabled=true
where id='special_minigame_04';

create function public.special_color_chaos_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare round_id uuid;g jsonb;runs jsonb:='{}'::jsonb;p jsonb;seed_value bigint;
 start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_04','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  seed_value:=1+floor(pg_catalog.random()*2147483646)::bigint;
  insert into public.trottl_special_color_chaos_runs(session_id,round_id,player_id,seed,started_at)
   values(p_id,round_id,(p->>'player_id')::uuid,seed_value,start_at);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('progress',0,'challenge_index',0,'completed',false,'elapsed_ms',null));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Farbenchaos','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds',
  'start_at',start_at,'runs',runs),'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

create function public.get_trottl_special_color_chaos_view(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.trottl_special_sessions;target uuid;r public.trottl_special_color_chaos_runs;challenge jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active'
  or s.game_state->'minigame'->>'minigame_type' is distinct from 'special_minigame_04' then return null; end if;
 if exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then target:=auth.uid();
 elsif exists(select 1 from public.trottl_special_spectators where session_id=p_session_id and user_id=auth.uid())
  then target:=s.host_user_id;
 else raise exception 'SPECIAL_COLOR_CHAOS_VIEW_REQUIRED'; end if;
 select * into r from public.trottl_special_color_chaos_runs where session_id=p_session_id
  and round_id=(s.game_state->'minigame'->>'minigame_id')::uuid and player_id=target;
 if not found then return null; end if;
 if not r.completed then challenge:=public.special_color_chaos_challenge(r.seed,r.challenge_index); end if;
 return jsonb_build_object('player_id',r.player_id,'progress',r.progress,'challenge_index',r.challenge_index,
  'completed',r.completed,'elapsed_ms',r.elapsed_ms,'started_at',r.started_at)
  ||coalesce(challenge,'{}'::jsonb);
end; $$;

create function public.special_color_chaos_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;m jsonb;inputs jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_04' then return; end if;
 if jsonb_array_length(m->'participants')=0 then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);return;
 end if;
 if exists(select 1 from public.trottl_special_color_chaos_runs where session_id=p_id
  and round_id=(m->>'minigame_id')::uuid and not completed) then return; end if;
 select jsonb_agg(jsonb_build_object('player_id',p->>'player_id','raw_value',r.elapsed_ms,
  'display_value',to_char(r.elapsed_ms/1000.0,'FM999999990.000')||' s') order by p.ordinality)
 into inputs from jsonb_array_elements(m->'participants') with ordinality p(p,ordinality)
 join public.trottl_special_color_chaos_runs r on r.player_id=(p.p->>'player_id')::uuid
  and r.session_id=p_id and r.round_id=(m->>'minigame_id')::uuid;
 perform public.special_minigame_finalize_locked(p_id,(m->>'minigame_id')::uuid,inputs);
end; $$;

create function public.answer_trottl_special_color_chaos(
 p_session_id uuid,p_round_id uuid,p_challenge_index integer,p_selected_color text,p_tap_elapsed_ms integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;r public.trottl_special_color_chaos_runs;slot smallint;
 now_at timestamptz:=clock_timestamp();server_elapsed bigint;challenge jsonb;correct boolean;next_progress integer;next_index integer;final_elapsed bigint;
 public_run jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if s.status<>'playing' or g->>'phase'<>'minigame_active' or (m->>'minigame_id')::uuid is distinct from p_round_id
  or m->>'minigame_type' is distinct from 'special_minigame_04'
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  then raise exception 'SPECIAL_INVALID_COLOR_CHAOS_PARTICIPANT'; end if;
 select * into r from public.trottl_special_color_chaos_runs where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid() for update;
 if not found then raise exception 'SPECIAL_INVALID_COLOR_CHAOS_RUN'; end if;
 if r.completed then raise exception 'SPECIAL_COLOR_CHAOS_ALREADY_COMPLETED'; end if;
 if p_challenge_index is distinct from r.challenge_index then raise exception 'SPECIAL_STALE_COLOR_CHAOS_CHALLENGE'; end if;
 if p_selected_color is null or p_selected_color not in ('RED','BLUE','GREEN','YELLOW') then raise exception 'SPECIAL_INVALID_COLOR_CHAOS_COLOR'; end if;
 server_elapsed:=floor(extract(epoch from (now_at-r.started_at))*1000)::bigint;
 if server_elapsed<0 or p_tap_elapsed_ms is null or p_tap_elapsed_ms<0 or p_tap_elapsed_ms>server_elapsed+1000
  then raise exception 'SPECIAL_INVALID_COLOR_CHAOS_TIME'; end if;
 challenge:=public.special_color_chaos_challenge(r.seed,r.challenge_index);
 correct:=p_selected_color=challenge->>'target_color';
 next_progress:=r.progress+case when correct then 1 else 0 end;next_index:=r.challenge_index+1;
 if next_progress=5 then final_elapsed:=server_elapsed; end if;
 update public.trottl_special_color_chaos_runs set progress=next_progress,challenge_index=next_index,
  completed=next_progress=5,elapsed_ms=final_elapsed,updated_at=now_at
  where session_id=p_session_id and round_id=p_round_id and player_id=auth.uid();
 public_run:=jsonb_build_object('progress',next_progress,'challenge_index',next_index,'completed',next_progress=5,'elapsed_ms',final_elapsed);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,public_run));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 if next_progress=5 then perform public.special_color_chaos_finalize_locked(p_session_id); end if;
 return jsonb_build_object('session_id',p_session_id,'correct',correct,'progress',next_progress,
  'challenge_index',next_index,'completed',next_progress=5);
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
 else raise exception 'SPECIAL_UNIMPLEMENTED_MINIGAME'; end if;
 update public.trottl_special_sessions set debug_test=debug_test-'next_minigame' where id=p_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_color_chaos;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;m jsonb;slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;m:=g->'minigame';
 if g->>'phase'<>'minigame_active' or m->>'minigame_type' is distinct from 'special_minigame_04'
  then return public.leave_trottl_special_before_color_chaos(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 delete from public.trottl_special_color_chaos_runs where session_id=p_session_id
  and round_id=(m->>'minigame_id')::uuid and player_id=auth.uid();
 m:=m||jsonb_build_object('participants',(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(m->'participants') p where p->>'player_id'<>auth.uid()::text),
  'runs',(m->'runs')-auth.uid()::text);
 if g->>'actor'=auth.uid()::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 perform public.special_color_chaos_finalize_locked(p_session_id);return true;
end; $$;

revoke all on function public.special_color_chaos_value(bigint,integer,integer),public.special_color_chaos_challenge(bigint,integer),
 public.special_color_chaos_begin_locked(uuid),public.special_color_chaos_finalize_locked(uuid),public.special_number_hunt_begin_locked(uuid),
 public.leave_trottl_special_before_color_chaos(uuid),public.leave_trottl_special_session(uuid),
 public.get_trottl_special_color_chaos_view(uuid),public.answer_trottl_special_color_chaos(uuid,uuid,integer,text,integer)
 from public,anon,authenticated;
grant execute on function public.leave_trottl_special_session(uuid),public.get_trottl_special_color_chaos_view(uuid),
 public.answer_trottl_special_color_chaos(uuid,uuid,integer,text,integer) to authenticated;

commit;
