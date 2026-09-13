-- Owner-only native PostgreSQL regression, dedicated disposable DB after migrations.
-- SET fischteich.test_session_id='UUID' to a four-member awaiting-roll Special room.
-- Controlled timestamps and measured test scores ONLY here. No production execution.
begin;
do $$ declare c jsonb;r jsonb;
begin
 for c in select value from jsonb_array_elements('[
  {"values":[1,1,3,4],"winners":2,"losers":1},
  {"values":[1,2,4,4],"winners":1,"losers":2},
  {"values":[5,5,5,5],"winners":4,"losers":0}]') loop
  r:=public.special_minigame_rank_drinks((select jsonb_agg(jsonb_build_object('player_id',n::text,'raw_value',c->'values'->(n-1))) from generate_series(1,4) n),'lower_is_better');
  if jsonb_array_length(r->'winners')<>(c->>'winners')::integer or jsonb_array_length(r->'losers')<>(c->>'losers')::integer
   or (r->>'draw')::boolean then raise exception 'Drink ranking tie regression %',c; end if;
 end loop;
 r:=public.special_minigame_rank('[{"player_id":"a","raw_value":1},{"player_id":"b","raw_value":1}]','higher_is_better');
 if not (r->>'draw')::boolean then raise exception 'PANIK original tie policy changed'; end if;
 if has_function_privilege('authenticated','public.special_number_hunt_begin_locked(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.act_trottl_special_phase_four(uuid,text,bigint,uuid)','EXECUTE') then raise exception 'Private helper exposed'; end if;
end; $$;
create temp table hunt_baseline as select * from public.trottl_special_sessions where id=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
do $$ declare s public.trottl_special_sessions;
begin
 select * into s from hunt_baseline;
 if s.id is null or s.status<>'playing' or s.game_state->>'phase'<>'awaiting_roll'
  or (select count(*) from public.trottl_special_players where session_id=s.id)<>4 then raise exception 'Dedicated four-member awaiting-roll room required'; end if;
end; $$;
create function pg_temp.hunt_prepare() returns jsonb language plpgsql as $$
declare s public.trottl_special_sessions;g jsonb;ids uuid[];r uuid;
begin
 select * into s from hunt_baseline;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 update public.trottl_special_players set lives=3,lifecycle_status='alive',critical_used=false where session_id=s.id;
 update public.trottl_special_sessions set current_turn_seat=s.current_turn_seat,game_state=s.game_state||jsonb_build_object('phase','rolling','result',4,'rescue',false,'deadline',clock_timestamp()-interval '1 second') where id=s.id;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.act_trottl_special_game(s.id,'resolve',(s.game_state->>'roll_seq')::bigint);
 select game_state into g from public.trottl_special_sessions where id=s.id;
 if g->>'phase'<>'minigame_active' or g->'minigame'->>'minigame_type'<>'special_minigame_01'
  or g->'minigame'->>'ranking_direction'<>'lower_is_better' then raise exception 'Productive four must start Zahlenjagd'; end if;
 if exists(select 1 from jsonb_each(g->'minigame'->'runs') run where
  (select jsonb_agg(v order by v) from jsonb_array_elements(run.value->'board') v)<>'[1,2,3,4,5,6,7,8,9]'::jsonb) then raise exception 'Invalid shuffled board'; end if;
 r:=(g->'minigame'->>'minigame_id')::uuid;
 return jsonb_build_object('id',s.id,'ids',to_jsonb(ids),'round',r,'seq',g->'roll_seq');
end; $$;
create function pg_temp.hunt_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
 begin execute p_sql;exception when others then if position(p_error in sqlerrm)=0 then raise; end if;return;end;
 raise exception 'Expected %: %',p_error,p_sql;
end; $$;
create function pg_temp.hunt_tap(p_id uuid,p_round uuid,p_number integer,p_elapsed bigint default null) returns uuid language plpgsql as $$
declare v_input uuid:=gen_random_uuid();v_seq bigint;
begin
 select coalesce((game_state->'minigame'->'runs'->auth.uid()::text->>'input_seq')::bigint,0) into v_seq from public.trottl_special_sessions where id=p_id;
 perform public.tap_trottl_special_number_hunt(p_id,p_round,p_number,p_elapsed,v_input,v_seq);
 perform public.tap_trottl_special_number_hunt(p_id,p_round,p_number,p_elapsed,v_input,v_seq); -- Exact input retry is idempotent.
 return p_id;
end; $$;
do $$ declare f jsonb;v_id uuid;r uuid;u uuid;before_run jsonb;g jsonb;start_value jsonb;
begin
 f:=pg_temp.hunt_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;u:=(f->'ids'->>0)::uuid;
 update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{minigame,start_at}',to_jsonb(clock_timestamp()-interval '10 seconds')) where id=v_id;
 perform set_config('request.jwt.claim.sub',u::text,true);
 for n in 1..3 loop perform pg_temp.hunt_tap(v_id,r,n);end loop;
 select game_state into g from public.trottl_special_sessions where id=v_id;
 before_run:=g->'minigame'->'runs'->u::text;start_value:=g->'minigame'->'start_at';
 perform pg_temp.hunt_tap(v_id,r,7);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'minigame'->'runs'->u::text->>'progress'<>'0'
  or g->'minigame'->'runs'->u::text->'board'<>before_run->'board'
  or g->'minigame'->'start_at'<>start_value
  or g->'minigame'->>'minigame_id'<>r::text then raise exception 'Reset changed board, clock or round'; end if;
 perform pg_temp.hunt_tap(v_id,r,1);
 if (select game_state->'minigame'->'runs'->u::text->>'progress' from public.trottl_special_sessions where id=v_id)<>'1' then raise exception 'Reset must restart at one'; end if;
end; $$;
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];g jsonb;score bigint;all_tied boolean;seq bigint;
begin
 foreach all_tied in array array[false,true] loop
  f:=pg_temp.hunt_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;seq:=(f->>'seq')::bigint;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  perform pg_temp.hunt_error(format('select pg_temp.hunt_tap(%L,%L,1)',v_id,r),'SPECIAL_NUMBER_HUNT_NOT_STARTED');
  perform pg_temp.hunt_error(format('select pg_temp.hunt_tap(%L,%L,1)',v_id,gen_random_uuid()),'SPECIAL_INVALID_NUMBER_HUNT_TAP');
  update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{minigame,start_at}',to_jsonb(clock_timestamp()-interval '10 seconds')) where id=v_id;
  for i in 1..4 loop
   perform set_config('request.jwt.claim.sub',ids[i]::text,true);
   perform pg_temp.hunt_tap(v_id,r,9,1000); -- Wrong order resets to zero without moving numbers.
   if (select game_state->'minigame'->'runs'->ids[i]::text->>'progress' from public.trottl_special_sessions where id=v_id)<>'0' then raise exception 'Wrong tap advanced'; end if;
   for n in 1..8 loop perform pg_temp.hunt_tap(v_id,r,n);end loop;
   perform pg_temp.hunt_error(format('select pg_temp.hunt_tap(%L,%L,9,-1)',v_id,r),'SPECIAL_INVALID_NUMBER_HUNT_TIME');
   score:=case when all_tied then 1234 else 1000*i end;
   perform pg_temp.hunt_tap(v_id,r,9,score);
   select game_state into g from public.trottl_special_sessions where id=v_id;
   if i<4 and g->>'phase'<>'minigame_active' then raise exception 'Result before all finished'; end if;
  end loop;
  if g->>'phase'<>'minigame_results' then raise exception 'Missing result phase'; end if;
  if all_tied then
   if jsonb_array_length(g->'minigame'->'winners')<>4 or g->'minigame'->'losers'<>'[]'::jsonb
    or g->'drinks'<>'{}'::jsonb then raise exception 'All equal must be winners without losers'; end if;
  elsif g->'minigame'->'winners'<>jsonb_build_array(ids[1]) or g->'minigame'->'losers'<>jsonb_build_array(ids[4]) then raise exception 'Lower time ranking'; end if;
  for i in 1..4 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_game(v_id,'results_ack',seq);end loop;
  if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'minigame_distribution' then raise exception 'Result ACK pipeline'; end if;
  for i in 1..(case when all_tied then 4 else 1 end) loop
   perform set_config('request.jwt.claim.sub',ids[i]::text,true);
   perform public.act_trottl_special_game(v_id,'assign',seq,ids[1]);perform public.act_trottl_special_game(v_id,'assign',seq,ids[1]);
   perform public.act_trottl_special_game(v_id,'confirm',seq);
  end loop;
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if g->>'phase'<>'drink_ack' or (g->'drinks'->>ids[1]::text)::integer<>(case when all_tied then 8 else 2 end) then raise exception 'Winner drink aggregation'; end if;
  perform set_config('request.jwt.claim.sub',ids[1]::text,true);perform public.act_trottl_special_game(v_id,'ack',seq);
  if not all_tied then perform set_config('request.jwt.claim.sub',ids[4]::text,true);perform public.act_trottl_special_game(v_id,'ack',seq);end if;
 end loop;
end; $$;
savepoint hunt_leave;
-- Leave removes unfinished obligation, host changes are available in the same public snapshot.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];g jsonb;
begin
 f:=pg_temp.hunt_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{minigame,start_at}',to_jsonb(clock_timestamp()-interval '10 seconds')) where id=v_id;
 for i in 1..3 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);for n in 1..8 loop perform pg_temp.hunt_tap(v_id,r,n);end loop;
  perform pg_temp.hunt_tap(v_id,r,9,1000*i);
 end loop;
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase'<>'minigame_results' or jsonb_array_length(g->'minigame'->'participants')<>3 then raise exception 'Leave obligation stalled'; end if;
end; $$;
rollback to savepoint hunt_leave;
-- Spectator and eliminated players cannot forge progress. Critical participants can play.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];
begin
 f:=pg_temp.hunt_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{minigame,start_at}',to_jsonb(clock_timestamp()-interval '10 seconds')) where id=v_id;
 update public.trottl_special_players set lives=0,critical_used=true,lifecycle_status='critical' where session_id=v_id and user_id=ids[3];
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);perform pg_temp.hunt_tap(v_id,r,1);
 if (select game_state->'minigame'->'runs'->ids[3]::text->>'progress' from public.trottl_special_sessions where id=v_id)<>'1' then raise exception 'Critical participant rejected'; end if;
 update public.trottl_special_players set lives=0,critical_used=true,lifecycle_status='eliminated' where session_id=v_id and user_id=ids[4];
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);
 perform pg_temp.hunt_error(format('select pg_temp.hunt_tap(%L,%L,1)',v_id,r),'SPECIAL_INVALID_NUMBER_HUNT_TAP');
 delete from public.trottl_special_players where session_id=v_id and user_id=ids[4];insert into public.trottl_special_spectators(session_id,user_id) values(v_id,ids[4]);
 perform pg_temp.hunt_error(format('select pg_temp.hunt_tap(%L,%L,1)',v_id,r),'SPECIAL_INVALID_NUMBER_HUNT_TAP');
end; $$;
rollback to savepoint hunt_leave;
set constraints all immediate;
rollback;
