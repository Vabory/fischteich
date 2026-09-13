-- Owner-only PostgreSQL regression fixture, AFTER migrations, against a dedicated test DB.
-- No public PWA entry. Everything rolls back. Never point this at an ongoing user game.
-- For integration tests, set fischteich.test_session_id to a dedicated playing session
-- with exactly four alive/critical members and an awaiting_roll phase before running.
begin;
do $$
declare c jsonb; inputs jsonb; ranked jsonb; expected_w jsonb; expected_l jsonb;
begin
 for c in select value from jsonb_array_elements('[
  {"values":[100,80,20],"direction":"higher_is_better","winners":["p0"],"losers":["p2"]},
  {"values":[100,100,80,40],"direction":"higher_is_better","winners":["p0","p1"],"losers":["p3"]},
  {"values":[100,100,100,40],"direction":"higher_is_better","winners":["p0","p1","p2"],"losers":["p3"]},
  {"values":[100,80,20,20],"direction":"higher_is_better","winners":["p0"],"losers":["p2","p3"]},
  {"values":[100,100,20,20],"direction":"higher_is_better","winners":["p0","p1"],"losers":["p2","p3"]},
  {"values":[10,20,40],"direction":"lower_is_better","winners":["p0"],"losers":["p2"]},
  {"values":[10,10,40,40],"direction":"lower_is_better","winners":["p0","p1"],"losers":["p2","p3"]},
  {"values":[7,7,7],"direction":"higher_is_better","winners":[],"losers":[]},
  {"values":[7,7,7],"direction":"lower_is_better","winners":[],"losers":[]},
  {"values":[-1.5,-1.5,-5],"direction":"higher_is_better","winners":["p0","p1"],"losers":["p2"]}
 ]'::jsonb) loop
  select jsonb_agg(jsonb_build_object('player_id','p'||(ordinality-1)::text,'raw_value',value,'display_value',value::text||' units') order by ordinality)
   into inputs from jsonb_array_elements(c->'values') with ordinality;
  ranked:=public.special_minigame_rank(inputs,c->>'direction');
  if ranked->'winners'<>c->'winners' or ranked->'losers'<>c->'losers' then raise exception 'Ranking regression: %',c; end if;
  if jsonb_array_length(c->'winners')=0 and not (ranked->>'draw')::boolean then raise exception 'Missing draw'; end if;
 end loop;
 if public.special_minigame_aggregate('{"C":2}',
  '{"A":{"drinks":{"C":1,"D":1},"confirmed":true,"cancelled":false},"B":{"drinks":{"A":1,"C":1},"confirmed":true,"cancelled":false}}')
  <>'{"A":1,"C":4,"D":1}'::jsonb then raise exception 'Section 18 aggregation regression'; end if;
 if public.special_minigame_aggregate('{"C":2}',
  '{"A":{"drinks":{"C":2},"confirmed":true,"cancelled":false},"B":{"drinks":{"C":2},"confirmed":true,"cancelled":false}}')
  <>'{"C":6}'::jsonb then raise exception 'Multiple winner aggregation regression'; end if;
end; $$;

create function pg_temp.special_prepare_fixture(p_id uuid,p_finalize boolean default true)
returns jsonb language plpgsql as $$
declare ids uuid[]; v_round uuid; v_seq bigint;
begin
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=p_id and lifecycle_status in ('alive','critical');
 if cardinality(ids)<>4 then raise exception 'Four fixture participants required'; end if;
 v_round:=public.special_minigame_begin_locked(p_id,'special_minigame_01','higher_is_better');
 if p_finalize then
  perform public.special_minigame_finalize_locked(p_id,v_round,jsonb_build_array(
   jsonb_build_object('player_id',ids[1],'raw_value',100),jsonb_build_object('player_id',ids[2],'raw_value',100),
   jsonb_build_object('player_id',ids[3],'raw_value',20),jsonb_build_object('player_id',ids[4],'raw_value',50)));
 end if;
 select (game_state->>'roll_seq')::bigint into v_seq from public.trottl_special_sessions where id=p_id;
 if p_finalize then
  for i in 1..4 loop
   perform set_config('request.jwt.claim.sub',ids[i]::text,true);
   perform public.act_trottl_special_game(p_id,'results_ack',v_seq);
  end loop;
 end if;
 return jsonb_build_object('ids',to_jsonb(ids),'seq',v_seq);
end; $$;
savepoint minigame_fixture;

do $$
declare v_id uuid; s public.trottl_special_sessions; ids uuid[]; seq bigint; round_id uuid; inputs jsonb; g jsonb; baseline jsonb; after_players jsonb;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
 if v_id is null then raise notice 'Ranking/aggregation checked; integration requires fischteich.test_session_id'; return; end if;
 select * into s from public.trottl_special_sessions where id=v_id for update;
 if s.status<>'playing' or s.game_state->>'phase'<>'awaiting_roll' then raise exception 'Dedicated awaiting_roll test session required'; end if;
 select array_agg(user_id order by seat_index),jsonb_agg(jsonb_build_object('id',user_id,'lives',lives,'critical_used',critical_used,'status',lifecycle_status) order by seat_index)
  into ids,baseline from public.trottl_special_players where session_id=v_id and lifecycle_status in ('alive','critical');
 if cardinality(ids)<>4 then raise exception 'Exactly four eligible fixture players required'; end if;
 round_id:=public.special_minigame_begin_locked(v_id,'special_minigame_01','higher_is_better');
 inputs:=jsonb_build_array(jsonb_build_object('player_id',ids[1],'raw_value',100),jsonb_build_object('player_id',ids[2],'raw_value',100),
  jsonb_build_object('player_id',ids[3],'raw_value',20),jsonb_build_object('player_id',ids[4],'raw_value',50));
 perform public.special_minigame_finalize_locked(v_id,round_id,inputs);
 select (game_state->>'roll_seq')::bigint into seq from public.trottl_special_sessions where id=v_id;
 for i in 1..4 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);
  perform public.act_trottl_special_game(v_id,'results_ack',seq);
 end loop;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 begin
  perform public.act_trottl_special_game(v_id,'confirm',seq); raise exception 'Early confirm accepted';
 exception when others then if sqlerrm<>'SPECIAL_INCOMPLETE_DISTRIBUTION' then raise; end if; end;
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[4]);
 begin
  perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]); raise exception 'Third assignment accepted';
 exception when others then if sqlerrm<>'SPECIAL_INVALID_DRINK_TARGET' then raise; end if; end;
 perform public.act_trottl_special_game(v_id,'confirm',seq);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase'<>'minigame_distribution' or g->'drinks'<>jsonb_build_object(ids[3]::text,3,ids[4]::text,1) or g->'acks'<>'{}'::jsonb
  then raise exception 'Premature ACK / intermediate aggregation regression'; end if;
 begin
  perform public.act_trottl_special_game(v_id,'reset',seq); raise exception 'Confirmed winner reset accepted';
 exception when others then if sqlerrm<>'SPECIAL_NOT_PENDING_WINNER' then raise; end if; end;
 begin
  perform public.act_trottl_special_game(v_id,'confirm',seq); raise exception 'Double winner confirm accepted';
 exception when others then if sqlerrm<>'SPECIAL_NOT_PENDING_WINNER' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);
 begin
  perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]); raise exception 'Non-winner assignment accepted';
 exception when others then if sqlerrm<>'SPECIAL_NOT_PENDING_WINNER' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',ids[2]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[2]);
 perform public.act_trottl_special_game(v_id,'reset',seq);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[1]);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase'<>'drink_ack' or g->'drinks'<>jsonb_build_object(ids[1]::text,1,ids[3]::text,4,ids[4]::text,1)
  then raise exception 'Final section 18 settlement regression'; end if;
 for i in 1..4 loop
  if i<>2 then
   perform set_config('request.jwt.claim.sub',ids[i]::text,true);
   perform public.act_trottl_special_game(v_id,'ack',seq);
  end if;
 end loop;
 select jsonb_agg(jsonb_build_object('id',user_id,'lives',lives,'critical_used',critical_used,'status',lifecycle_status) order by seat_index)
  into after_players from public.trottl_special_players where session_id=v_id and lifecycle_status in ('alive','critical');
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if after_players<>baseline or g->'trottl' is distinct from s.game_state->'trottl' or g->'points' is distinct from s.game_state->'points'
  then raise exception 'Life / critical / Trottl regression'; end if;
 if g->>'phase' not in ('awaiting_roll','rescue_roll') then raise exception 'Missing turn advance'; end if;
end; $$;
rollback to savepoint minigame_fixture;

-- Unconfirmed winner leave cancels only its own allocation / obligation.
do $$ declare v_id uuid; f jsonb; ids uuid[]; seq bigint; g jsonb;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid; if v_id is null then return; end if;
 f:=pg_temp.special_prepare_fixture(v_id);select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 seq:=(f->>'seq')::bigint;perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if not (g->'minigame'->'distributions'->ids[1]::text->>'cancelled')::boolean
  or g->'minigame'->'distributions'->ids[1]::text->'drinks'<>'{}'::jsonb
  or g->>'phase'<>'minigame_distribution' then raise exception 'Unconfirmed winner leave regression'; end if;
 perform set_config('request.jwt.claim.sub',ids[2]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase'<>'drink_ack' or g->'drinks'<>jsonb_build_object(ids[3]::text,4) then raise exception 'Cancelled winner blocked settlement'; end if;
end; $$;
rollback to savepoint minigame_fixture;

-- Confirmed winner history survives leaving, including allocations to valid recipients.
do $$ declare v_id uuid; f jsonb; ids uuid[]; seq bigint; g jsonb; confirmed jsonb;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid; if v_id is null then return; end if;
 f:=pg_temp.special_prepare_fixture(v_id);select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 seq:=(f->>'seq')::bigint;perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);perform public.act_trottl_special_game(v_id,'assign',seq,ids[4]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);
 select game_state->'minigame'->'distributions'->ids[1]::text into confirmed from public.trottl_special_sessions where id=v_id;
 perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'minigame'->'distributions'->ids[1]::text<>confirmed then raise exception 'Confirmed winner history lost'; end if;
 perform set_config('request.jwt.claim.sub',ids[2]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'drinks'<>jsonb_build_object(ids[3]::text,5,ids[4]::text,1) then raise exception 'Confirmed allocations missing'; end if;
end; $$;
rollback to savepoint minigame_fixture;

-- Departed recipient disappears from confirmed aggregate, not from immutable history.
do $$ declare v_id uuid; f jsonb; ids uuid[]; seq bigint; g jsonb;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid; if v_id is null then return; end if;
 f:=pg_temp.special_prepare_fixture(v_id);select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 seq:=(f->>'seq')::bigint;perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[4]);perform public.act_trottl_special_game(v_id,'assign',seq,ids[4]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);perform set_config('request.jwt.claim.sub',ids[4]::text,true);
 perform public.leave_trottl_special_session(v_id);perform set_config('request.jwt.claim.sub',ids[2]::text,true);
 perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);perform public.act_trottl_special_game(v_id,'assign',seq,ids[3]);
 perform public.act_trottl_special_game(v_id,'confirm',seq);select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'drinks' ? ids[4]::text or g->'minigame'->'distributions'->ids[1]::text->'drinks'<>jsonb_build_object(ids[4]::text,2)
  then raise exception 'Departed recipient / immutable history regression'; end if;
end; $$;
rollback to savepoint minigame_fixture;

-- Leaving before results removes participant; <2 becomes draw, no drinks, no hang.
do $$ declare v_id uuid; f jsonb; ids uuid[]; seq bigint; g jsonb;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid; if v_id is null then return; end if;
 f:=pg_temp.special_prepare_fixture(v_id,false);select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 seq:=(f->>'seq')::bigint;
 for i in 1..3 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.leave_trottl_special_session(v_id);end loop;
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if not (g->'minigame'->>'draw')::boolean or jsonb_array_length(g->'minigame'->'participants')<>1 or g->'drinks'<>'{}'::jsonb
  then raise exception 'Pre-result departure draw regression'; end if;
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);perform public.act_trottl_special_game(v_id,'results_ack',seq);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase' not in ('awaiting_roll','rescue_roll') then raise exception 'Pre-result departure blocked advance'; end if;
end; $$;
rollback;
