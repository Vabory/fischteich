-- Owner-only PostgreSQL regression. Dedicated disposable DB after all migrations.
-- Requires SET fischteich.test_session_id='UUID': four-member playing awaiting-roll room,
-- first seat must be current actor. No production use. Controlled result/time writes ONLY here.
begin;
do $$ declare c jsonb;
begin
 for c in select value from jsonb_array_elements('[[0,"RED"],[0.000000001,"RED"],[0.449999999,"RED"],
  [0.45,"BLACK"],[0.450000001,"BLACK"],[0.899999999,"BLACK"],[0.90,"GREEN"],[0.900000001,"GREEN"],[0.999999999,"GREEN"]') loop
  if public.special_roulette_color((c->>0)::double precision)<>c->>1 then raise exception 'Boundary mapping: %',c; end if;
 end loop;
 if has_function_privilege('authenticated','public.special_heal_life_locked(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.act_trottl_special_phase_three(uuid,text,bigint,uuid)','EXECUTE')
  or has_function_privilege('anon','public.act_trottl_special_roulette(uuid,uuid,text,text,uuid)','EXECUTE') then raise exception 'Private helper privilege'; end if;
end; $$;
create temp table roulette_baseline as select * from public.trottl_special_sessions
 where id=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
do $$ declare s public.trottl_special_sessions;ids uuid[];
begin
 select * into s from roulette_baseline;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 if s.id is null or s.status<>'playing' or s.game_state->>'phase'<>'awaiting_roll' or cardinality(ids)<>4
  or s.game_state->>'actor'<>ids[1]::text then raise exception 'Dedicated four-member first-actor awaiting-roll test session required'; end if;
end; $$;
create function pg_temp.roulette_prepare(p_chosen text default 'RED',p_result text default 'RED') returns jsonb language plpgsql as $$
declare s public.trottl_special_sessions;ids uuid[];g jsonb;r jsonb;shots jsonb;
begin
 select * into s from roulette_baseline;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 update public.trottl_special_players set lives=3,critical_used=false,lifecycle_status='alive' where session_id=s.id;
 update public.trottl_special_sessions set current_turn_seat=s.current_turn_seat,game_state=s.game_state||jsonb_build_object('trottl',null,'points',0) where id=s.id;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.special_roulette_begin_locked(s.id);
 select game_state->'roulette' into r from public.trottl_special_sessions where id=s.id;
 if p_chosen is not null then
  perform public.act_trottl_special_roulette(s.id,(r->>'round_id')::uuid,'color',p_chosen);
  select game_state into g from public.trottl_special_sessions where id=s.id;r:=g->'roulette';
  shots:=case when p_chosen<>p_result then jsonb_build_object(ids[1]::text,1) when p_chosen='GREEN' then
   jsonb_build_object(ids[2]::text,1,ids[3]::text,1,ids[4]::text,1) else '{}'::jsonb end;
  -- Controlled outcomes, never a production RPC input.
  r:=r||jsonb_build_object('result_color',p_result,'reward_done',p_chosen<>p_result,'shots',shots,
   'spin_started_at',clock_timestamp()-interval '6 seconds','spin_ends_at',clock_timestamp()-interval '1 second');
  update public.trottl_special_sessions set game_state=g||jsonb_build_object('roulette',r) where id=s.id;
  perform public.special_roulette_settle_locked(s.id);
 end if;
 select game_state into g from public.trottl_special_sessions where id=s.id;
 return jsonb_build_object('id',s.id,'ids',to_jsonb(ids),'round',(g->'roulette'->>'round_id')::uuid,'seq',g->'roll_seq');
end; $$;
create function pg_temp.roulette_expect_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
 begin execute p_sql; exception when others then
  if position(p_error in sqlerrm)=0 then raise; end if;return;
 end;
 raise exception 'Expected %: %',p_error,p_sql;
end; $$;

-- Attack transition matrix, same central engine, explicit target/confirm and single effect.
do $$ declare f jsonb;v_id uuid;ids uuid[];r uuid;c jsonb;before_lives integer;after_lives integer;status text;g jsonb;
begin
 for c in select value from jsonb_array_elements('[[3,false,2,"alive"],[2,false,1,"alive"],[1,false,0,"critical"],[1,true,0,"eliminated"]') loop
  f:=pg_temp.roulette_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  update public.trottl_special_players set lives=(c->>0)::integer,critical_used=(c->>1)::boolean where session_id=v_id and user_id=ids[2];
  update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('trottl',ids[2],'points',2) where id=v_id;
  perform public.act_trottl_special_roulette(v_id,r,'reward','attack');
  perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''target'',null,%L)',v_id,r,ids[1]),'SPECIAL_INVALID_REWARD_TARGET');
  perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''confirm'')',v_id,r),'SPECIAL_INVALID_REWARD_TARGET');
  perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
  select lives into before_lives from public.trottl_special_players where session_id=v_id and user_id=ids[2];
  if before_lives<>(c->>0)::integer then raise exception 'Selection mutated life'; end if;
  perform public.act_trottl_special_roulette(v_id,r,'undo');
  if (select game_state->'roulette'->>'target' from public.trottl_special_sessions where id=v_id) is not null then raise exception 'Undo target'; end if;
  perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
  perform public.act_trottl_special_roulette(v_id,r,'confirm');
  perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''confirm'')',v_id,r),'SPECIAL_STALE_ROULETTE');
  select lives,lifecycle_status into after_lives,status from public.trottl_special_players where session_id=v_id and user_id=ids[2];
  if after_lives<>(c->>2)::integer or status<>c->>3 then raise exception 'Attack matrix %',c; end if;
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if after_lives=0 and (g->>'trottl' is not null or (g->>'points')::integer<>0) then raise exception 'Central Trottl reset'; end if;
 end loop;
end; $$;
-- Heal capped, no effect until confirm; Trottl transfer carries points.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];n integer;g jsonb;
begin
 for n in 1..2 loop
  f:=pg_temp.roulette_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  update public.trottl_special_players set lives=n where session_id=v_id and user_id=ids[1];
  perform public.act_trottl_special_roulette(v_id,r,'reward','heal');
  if (select lives from public.trottl_special_players where session_id=v_id and user_id=ids[1])<>n then raise exception 'Heal selection mutated'; end if;
  perform public.act_trottl_special_roulette(v_id,r,'undo');perform public.act_trottl_special_roulette(v_id,r,'reward','heal');
  perform public.act_trottl_special_roulette(v_id,r,'confirm');
  if (select lives from public.trottl_special_players where session_id=v_id and user_id=ids[1])<>n+1 then raise exception 'Heal +1'; end if;
 end loop;
 f:=pg_temp.roulette_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''reward'',''heal'')',v_id,r),'SPECIAL_REWARD_UNAVAILABLE');
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''reward'',''transfer'')',v_id,r),'SPECIAL_REWARD_UNAVAILABLE');
 perform pg_temp.roulette_expect_error(format('select public.special_heal_life_locked(%L,%L)',v_id,ids[1]),'SPECIAL_INVALID_HEAL');
 update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('trottl',ids[1],'points',2) where id=v_id;
 perform public.act_trottl_special_roulette(v_id,r,'reward','transfer');
 update public.trottl_special_players set lives=0,lifecycle_status='critical',critical_used=true where session_id=v_id and user_id=ids[2];
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''target'',null,%L)',v_id,r,ids[2]),'SPECIAL_INVALID_REWARD_TARGET');
 perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[3]);perform public.act_trottl_special_roulette(v_id,r,'confirm');
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'trottl'<>ids[3]::text or (g->>'points')::integer<>2 then raise exception 'Transfer points lost'; end if;
end; $$;
-- Wrong guesses, including either one-sided green, impose ONLY actor shot/no life mutation.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];c jsonb;g jsonb;
begin
 for c in select value from jsonb_array_elements('[["GREEN","RED"],["RED","GREEN"],["RED","BLACK"]') loop
  f:=pg_temp.roulette_prepare(c->>0,c->>1);v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if g->'roulette'->'shots'<>jsonb_build_object(ids[1]::text,1) or not (g->'roulette'->>'reward_done')::boolean then raise exception 'Wrong green'; end if;
  perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''reward'',''attack'')',v_id,r),'SPECIAL_INVALID_REWARD_ACTOR');
  perform set_config('request.jwt.claim.sub',ids[2]::text,true);
  perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''shot_ack'')',v_id,r),'SPECIAL_INVALID_SHOT_ACK');
  perform set_config('request.jwt.claim.sub',ids[1]::text,true);perform public.act_trottl_special_roulette(v_id,r,'shot_ack');
  if exists(select 1 from public.trottl_special_players where session_id=v_id and lives<>3) then raise exception 'Wrong guess changed life'; end if;
 end loop;
end; $$;
-- Green settlement in BOTH orders, critical included, eliminated dropped; actor excluded.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];reward_first boolean;g jsonb;
begin
 foreach reward_first in array array[true,false] loop
  f:=pg_temp.roulette_prepare('GREEN','GREEN');v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  update public.trottl_special_players set lives=0,lifecycle_status='critical',critical_used=true where session_id=v_id and user_id=ids[3];
  update public.trottl_special_players set lives=0,lifecycle_status='eliminated',critical_used=true where session_id=v_id and user_id=ids[4];
  perform public.special_roulette_settle_locked(v_id);
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if g->'roulette'->'shots'<>jsonb_build_object(ids[2]::text,1,ids[3]::text,1) then raise exception 'Green recipients'; end if;
  perform public.act_trottl_special_roulette(v_id,r,'reward','attack');perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
  if reward_first then perform public.act_trottl_special_roulette(v_id,r,'confirm'); end if;
  for i in 2..3 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_roulette(v_id,r,'shot_ack');end loop;
  if not reward_first then
   if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'roulette_settlement' then raise exception 'Shots advanced before reward'; end if;
   perform set_config('request.jwt.claim.sub',ids[1]::text,true);perform public.act_trottl_special_roulette(v_id,r,'confirm');
  end if;
  if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'awaiting_roll' then raise exception 'Parallel green stalled'; end if;
 end loop;
end; $$;
-- Unusable reward waives cleanly; attack elimination also removes that player's shot obligation.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];g jsonb;
begin
 f:=pg_temp.roulette_prepare();v_id:=(f->>'id')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 update public.trottl_special_players set lives=0,lifecycle_status='critical',critical_used=true where session_id=v_id and user_id<>ids[1];
 perform public.special_roulette_settle_locked(v_id);
 if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'rescue_roll' then raise exception 'No available reward deadlock'; end if;
 f:=pg_temp.roulette_prepare('GREEN','GREEN');v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 update public.trottl_special_players set lives=1,critical_used=true where session_id=v_id and user_id=ids[2];
 perform public.act_trottl_special_roulette(v_id,r,'reward','attack');perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
 perform public.act_trottl_special_roulette(v_id,r,'confirm');
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'roulette'->'shots' ? ids[2]::text or not (g->'roulette'->>'reward_done')::boolean then raise exception 'Dead shot obligation retained'; end if;
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''confirm'')',v_id,r),'SPECIAL_INVALID_REWARD_ACTOR');
 for i in 3..4 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_roulette(v_id,r,'shot_ack');end loop;
end; $$;
-- Productive six enters roulette; rescue 1..5 eliminates, while rescue six restores
-- exactly one life and advances past eliminated/left seats without an extra roll.
do $$ declare f jsonb;v_id uuid;ids uuid[];g jsonb;is_rescue boolean;n integer;rescue_result integer;
begin
 for rescue_result in 1..5 loop
  f:=pg_temp.roulette_prepare(null);v_id:=(f->>'id')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  update public.trottl_special_players set lives=0,lifecycle_status='critical',critical_used=true where session_id=v_id and user_id=ids[1];
  update public.trottl_special_players set lives=0,lifecycle_status='eliminated' where session_id=v_id and user_id=ids[2];
  update public.trottl_special_players set lifecycle_status='left' where session_id=v_id and user_id=ids[3];
  update public.trottl_special_sessions set game_state=(game_state-'roulette')||jsonb_build_object('phase','rolling','result',rescue_result,'rescue',true,
   'deadline',clock_timestamp()-interval '1 second') where id=v_id;
  perform public.act_trottl_special_game(v_id,'resolve',(f->>'seq')::bigint);
  select game_state into g from public.trottl_special_sessions where id=v_id;
  select lives into n from public.trottl_special_players where session_id=v_id and user_id=ids[1];
  if n<>0 or (select lifecycle_status from public.trottl_special_players where session_id=v_id and user_id=ids[1])<>'eliminated'
    or g->>'actor'<>ids[4]::text or g ? 'roulette' then raise exception 'Failed rescue 1-5 regression: %',rescue_result; end if;
 end loop;
 foreach is_rescue in array array[false,true] loop
  f:=pg_temp.roulette_prepare(null);v_id:=(f->>'id')::uuid;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
  if is_rescue then
   update public.trottl_special_players set lives=0,lifecycle_status='critical',critical_used=true where session_id=v_id and user_id=ids[1];
   update public.trottl_special_players set lives=0,lifecycle_status='eliminated' where session_id=v_id and user_id=ids[2];
   update public.trottl_special_players set lifecycle_status='left' where session_id=v_id and user_id=ids[3];
  end if;
  update public.trottl_special_sessions set game_state=(game_state-'roulette')||jsonb_build_object('phase','rolling','result',6,'rescue',is_rescue,
   'deadline',clock_timestamp()-interval '1 second') where id=v_id;
  perform public.act_trottl_special_game(v_id,'resolve',(f->>'seq')::bigint);
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if is_rescue then
   select lives into n from public.trottl_special_players where session_id=v_id and user_id=ids[1];
   if n<>1 or g->>'phase'<>'awaiting_roll' or g->>'actor'<>ids[4]::text or g ? 'roulette'
     or (select not critical_used from public.trottl_special_players where session_id=v_id and user_id=ids[1])
     then raise exception 'Rescue-six next-turn/reconnect regression'; end if;
  elsif g->>'phase'<>'roulette_choose_color' then raise exception 'Normal six not activated'; end if;
 end loop;
end; $$;
savepoint roulette_leave;
-- Leave before color: no result, no obligations.
do $$ declare f jsonb;v_id uuid;g jsonb;
begin
 f:=pg_temp.roulette_prepare(null);v_id:=(f->>'id')::uuid;perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'phase'<>'awaiting_roll' or g ? 'roulette' then raise exception 'Pre-color leave cancellation'; end if;
end; $$;
rollback to savepoint roulette_leave;
-- Confirmed transfer/points survives actor leave; outstanding green shots still gate advance.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];g jsonb;
begin
 f:=pg_temp.roulette_prepare('GREEN','GREEN');v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('trottl',ids[1],'points',2) where id=v_id;
 perform public.act_trottl_special_roulette(v_id,r,'reward','transfer');perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
 perform public.act_trottl_special_roulette(v_id,r,'confirm');perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->>'trottl'<>ids[2]::text or (g->>'points')::integer<>2 or g->'roulette'->>'reward_confirmed_at' is null
  or coalesce((g->'roulette'->>'reward_waived')::boolean,false) then raise exception 'Confirmed transfer lost on leave'; end if;
 for i in 2..4 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_roulette(v_id,r,'shot_ack');end loop;
end; $$;
rollback to savepoint roulette_leave;
-- Lost actor leaves: own shot disappears, no life penalty and no hang.
do $$ declare f jsonb;v_id uuid;
begin
 f:=pg_temp.roulette_prepare('GREEN','RED');v_id:=(f->>'id')::uuid;perform public.leave_trottl_special_session(v_id);
 if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'awaiting_roll' then raise exception 'Lost actor leave stalled'; end if;
end; $$;
rollback to savepoint roulette_leave;
-- Committed green persists even if actor leaves MID SPIN; reward forfeited, shots remain.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];g jsonb;spin jsonb;
begin
 f:=pg_temp.roulette_prepare('GREEN','GREEN');v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('phase','roulette_spinning','roulette',game_state->'roulette'||
  jsonb_build_object('spin_ends_at',clock_timestamp()+interval '3 seconds')) where id=v_id;
 select game_state->'roulette'->'spin_id' into spin from public.trottl_special_sessions where id=v_id;
 perform public.leave_trottl_special_session(v_id);
 select game_state into g from public.trottl_special_sessions where id=v_id;
 if g->'roulette'->'shots'<>jsonb_build_object(ids[2]::text,1,ids[3]::text,1,ids[4]::text,1)
  or g->'roulette'->'spin_id'<>spin or not (g->'roulette'->>'reward_done')::boolean then raise exception 'Binding green spin lost'; end if;
 update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{roulette,spin_ends_at}',to_jsonb(clock_timestamp()-interval '1 second')) where id=v_id;
 perform public.special_roulette_settle_locked(v_id);
 for i in 2..4 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_roulette(v_id,r,'shot_ack');end loop;
 if (select game_state->>'phase' from public.trottl_special_sessions where id=v_id)<>'awaiting_roll' then raise exception 'Actor-less green hang'; end if;
end; $$;
rollback to savepoint roulette_leave;
-- Selected target leave invalidates target, NOT already confirmed effects.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];
begin
 f:=pg_temp.roulette_prepare();v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 perform public.act_trottl_special_roulette(v_id,r,'reward','attack');perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[2]);
 perform set_config('request.jwt.claim.sub',ids[2]::text,true);perform public.leave_trottl_special_session(v_id);
 if (select game_state->'roulette'->>'target' from public.trottl_special_sessions where id=v_id) is not null then raise exception 'Departed target retained'; end if;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''confirm'')',v_id,r),'SPECIAL_INVALID_REWARD_TARGET');
 perform public.act_trottl_special_roulette(v_id,r,'target',null,ids[3]);perform public.act_trottl_special_roulette(v_id,r,'confirm');
end; $$;
rollback to savepoint roulette_leave;
-- Color binding, stable stored spin, wrong actor/round/session; spectator and eliminated read-only.
do $$ declare f jsonb;v_id uuid;r uuid;ids uuid[];stored jsonb;
begin
 f:=pg_temp.roulette_prepare(null);v_id:=(f->>'id')::uuid;r:=(f->>'round')::uuid;
 select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(f->'ids') with ordinality;
 perform set_config('request.jwt.claim.sub',ids[2]::text,true);
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''color'',''RED'')',v_id,r),'SPECIAL_INVALID_COLOR');
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''color'',''RED'')',v_id,gen_random_uuid()),'SPECIAL_STALE_ROULETTE');
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''color'',''RED'')',gen_random_uuid(),r),'TROTTL_SPECIAL_SESSION_NOT_FOUND');
 perform public.act_trottl_special_roulette(v_id,r,'color','RED');
 select game_state->'roulette' into stored from public.trottl_special_sessions where id=v_id;
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''color'',''BLACK'')',v_id,r),'SPECIAL_INVALID_COLOR');
 perform public.act_trottl_special_roulette(v_id,r,'resolve');
 if (select game_state->'roulette'->>'spin_id' from public.trottl_special_sessions where id=v_id)<>stored->>'spin_id'
  or (select game_state->'roulette'->>'result_color' from public.trottl_special_sessions where id=v_id)<>stored->>'result_color' then raise exception 'Reconnect drew again'; end if;
 update public.trottl_special_players set lives=0,lifecycle_status='eliminated',critical_used=true where session_id=v_id and user_id=ids[4];
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''color'',''RED'')',v_id,r),'SPECIAL_ROULETTE_READ_ONLY');
 delete from public.trottl_special_players where session_id=v_id and user_id=ids[4];
 insert into public.trottl_special_spectators(session_id,user_id) values(v_id,ids[4]);
 perform pg_temp.roulette_expect_error(format('select public.act_trottl_special_roulette(%L,%L,''shot_ack'')',v_id,r),'SPECIAL_ROULETTE_READ_ONLY');
end; $$;
rollback to savepoint roulette_leave;
set constraints all immediate;
rollback;
