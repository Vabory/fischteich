-- Owner-only native PostgreSQL regression, after migrations, dedicated test DB only.
-- Set fischteich.test_session_id to a disposable playing Special session with four members.
-- Window timestamps are backdated ONLY in this fixture. All changes roll back.
begin;
do $$
declare v_id uuid; ids uuid[]; baseline public.trottl_special_sessions; c jsonb; g jsonb; m jsonb; v_lives integer; v_status text;
begin
 v_id:=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
 if v_id is null then raise exception 'Dedicated fischteich.test_session_id required'; end if;
 select * into baseline from public.trottl_special_sessions where id=v_id for update;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=v_id;
 if baseline.status<>'playing' or cardinality(ids)<>4 or baseline.game_state->>'phase'<>'awaiting_roll'
  or baseline.current_turn_seat is null then raise exception 'Four-member awaiting-roll test session required'; end if;
 for c in select value from jsonb_array_elements('[
  {"lives":3,"used":false,"status":"alive","scores":[30,20,0,10],"expected_lives":2,"expected_status":"alive"},
  {"lives":2,"used":false,"status":"alive","scores":[30,20,0,10],"expected_lives":1,"expected_status":"alive"},
  {"lives":1,"used":false,"status":"alive","scores":[30,20,0,10],"expected_lives":0,"expected_status":"critical"},
  {"lives":1,"used":true,"status":"alive","scores":[30,20,0,10],"expected_lives":0,"expected_status":"eliminated"},
  {"lives":0,"used":true,"status":"critical","scores":[30,20,0,10],"expected_lives":0,"expected_status":"critical"},
  {"lives":3,"used":false,"status":"alive","scores":[30,30,0,10],"expected_lives":2,"expected_status":"alive"},
  {"lives":3,"used":false,"status":"alive","scores":[30,20,0,0],"expected_lives":2,"expected_status":"alive"},
  {"lives":3,"used":false,"status":"alive","scores":[7,7,7,7],"expected_lives":3,"expected_status":"alive"},
  {"lives":3,"used":false,"status":"alive","scores":[30,20,null,10],"expected_lives":2,"expected_status":"alive"}
 ]'::jsonb) loop
  update public.trottl_special_players set lives=3,lifecycle_status='alive',critical_used=false where session_id=v_id;
  update public.trottl_special_players set lives=(c->>'lives')::integer,lifecycle_status=c->>'status',critical_used=(c->>'used')::boolean
   where session_id=v_id and user_id=ids[3];
  update public.trottl_special_sessions set current_turn_seat=baseline.current_turn_seat,
   game_state=baseline.game_state||jsonb_build_object('actor',baseline.game_state->'actor','phase','awaiting_roll','trottl',null,'points',0) where id=v_id;
  if c->>'status'='alive' then
   update public.trottl_special_sessions set game_state=game_state||jsonb_build_object('trottl',ids[3],'points',2) where id=v_id;
  end if;
  perform public.special_panic_begin_locked(v_id);
  update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{minigame}',game_state->'minigame'||jsonb_build_object(
   'start_at',clock_timestamp()-interval '15 seconds','end_at',clock_timestamp()-interval '5 seconds','submit_until',clock_timestamp()-interval '1 second')) where id=v_id;
  select game_state->'minigame' into m from public.trottl_special_sessions where id=v_id;
  for i in 1..4 loop
   if jsonb_typeof(c->'scores'->(i-1))='number' then
    insert into public.trottl_special_panic_submissions(session_id,round_id,user_id,tap_count)
     values(v_id,(m->>'minigame_id')::uuid,ids[i],(c->'scores'->>(i-1))::integer);
   end if;
  end loop;
  perform public.special_panic_finalize_locked(v_id);
  perform public.special_panic_finalize_locked(v_id); -- Repeated finalize must not lose another life.
  select lives,lifecycle_status into v_lives,v_status from public.trottl_special_players where session_id=v_id and user_id=ids[3];
  if v_lives<>(c->>'expected_lives')::integer or v_status<>c->>'expected_status' then raise exception 'Life regression: %',c; end if;
  select game_state into g from public.trottl_special_sessions where id=v_id;
  if g->>'phase'<>'panic_results' then raise exception 'Result phase missing'; end if;
  if c->>'status'='alive' and (c->>'expected_lives')::integer=0 and (g->>'trottl' is not null or (g->>'points')::integer<>0)
   then raise exception 'Central Trottl reset missing'; end if;
  if c->'scores'='[30,20,0,0]'::jsonb and (select lives from public.trottl_special_players where session_id=v_id and user_id=ids[4])<>2
   then raise exception 'Multiple loser tie missing'; end if;
  if c->'scores'='[7,7,7,7]'::jsonb and not (g->'minigame'->>'draw')::boolean then raise exception 'Draw regression'; end if;
  if c->'scores'='[30,20,null,10]'::jsonb and not exists(select 1 from jsonb_array_elements(g->'minigame'->'results') r
   where r->>'player_id'=ids[3]::text and (r->>'raw_value')::integer=0) then raise exception 'Missing submission did not become zero'; end if;
 end loop;
end; $$;
set constraints all immediate;
rollback;
