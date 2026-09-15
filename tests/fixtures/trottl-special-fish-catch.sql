-- Owner-only regression in a disposable PostgreSQL DB after all migrations.
-- SET fischteich.test_session_id='UUID' to a four-player Special playing room.
-- Controlled clocks/state ONLY here. Never execute against production. Always rollback.
begin;
create temp table fish_baseline as select * from public.trottl_special_sessions where id=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
do $$ declare s public.trottl_special_sessions;
begin
 select * into s from fish_baseline;
 if s.id is null or s.status<>'playing' or (select count(*) from public.trottl_special_players where session_id=s.id)<>4 then raise exception 'Dedicated four-player Special room required'; end if;
 if public.special_minigame_pick(0)<>'special_minigame_01' or public.special_minigame_pick(0.499999)<>'special_minigame_01'
  or public.special_minigame_pick(0.5)<>'special_minigame_02' or public.special_minigame_pick(0.999999)<>'special_minigame_02'
  or public.special_minigame_pick(0,'special_minigame_02')<>'special_minigame_02'
  or public.special_minigame_pick(0.9,'special_minigame_01')<>'special_minigame_01' then raise exception 'Uniform implemented pool or override precedence'; end if;
 if exists(select 1 from public.trottl_special_minigame_registry where enabled and id not in ('special_minigame_01','special_minigame_02')) then raise exception 'Unimplemented pool slot'; end if;
 if has_function_privilege('authenticated','public.special_minigame_pick(double precision,text)','EXECUTE')
  or has_function_privilege('authenticated','public.act_trottl_special_before_test_controls(uuid,text,bigint,uuid)','EXECUTE') then raise exception 'Private helper exposed'; end if;
end; $$;
do $$ declare p jsonb:=public.special_fish_catch_pattern(123456);q jsonb:=public.special_fish_catch_pattern(654321);entry jsonb;
begin
 if p is distinct from public.special_fish_catch_pattern(123456) or p=q then raise exception 'Seeded pattern determinism'; end if;
 if jsonb_array_length(p) not between 26 and 32 then raise exception 'Pattern count'; end if;
 for entry in select value from jsonb_array_elements(p) loop
  if (entry->>'s')::integer not between 0 and 9 or (entry->>'a')::integer not between 1 and 8
   or (entry->>'t')::integer<0 or (entry->>'d')::integer not between 520 and 820
   or (entry->>'t')::integer+(entry->>'d')::integer>10000 then raise exception 'Pattern bounds'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p) a where 3<(select count(*) from jsonb_array_elements(p) b
   where (b->>'t')::integer<=(a->>'t')::integer and (b->>'t')::integer+(b->>'d')::integer>(a->>'t')::integer)) then raise exception 'Pattern concurrency'; end if;
end; $$;
create function pg_temp.fish_error(q text,expected text) returns void language plpgsql as $$
begin
 begin execute q;exception when others then if position(expected in sqlerrm)=0 then raise;end if;return;end;
 raise exception 'Expected % for %',expected,q;
end; $$;
create function pg_temp.fish_prepare(game text default 'special_minigame_02') returns jsonb language plpgsql as $$
declare s public.trottl_special_sessions;seat integer;g jsonb;
begin
 select * into s from fish_baseline;
 select seat_index into seat from public.trottl_special_players where session_id=s.id and user_id=s.host_user_id;
 update public.trottl_special_players set lives=3,lifecycle_status='alive',critical_used=false where session_id=s.id;
 update public.trottl_special_sessions set host_user_id=s.host_user_id,current_turn_seat=seat,game_state=s.game_state||jsonb_build_object('actor',s.host_user_id,'actor_seat',seat,'phase','placeholder','result',4,'rescue',false) where id=s.id;
 perform set_config('request.jwt.claim.sub',s.host_user_id::text,true);
 perform public.set_trottl_special_debug_next(s.id,null,game);
 perform public.special_number_hunt_begin_locked(s.id);
 select game_state into g from public.trottl_special_sessions where id=s.id;
 if g->'minigame'->>'minigame_type'<>game or (select debug_test ? 'next_minigame' from public.trottl_special_sessions where id=s.id) then raise exception 'Forced game must consume once'; end if;
 return g;
end; $$;
do $$ declare s public.trottl_special_sessions;seat integer;g jsonb;seq bigint;other uuid;
begin
 select * into s from fish_baseline;
 select seat_index into seat from public.trottl_special_players where session_id=s.id and user_id=s.host_user_id;
 select user_id into other from public.trottl_special_players where session_id=s.id and user_id<>s.host_user_id limit 1;
 update public.trottl_special_players set lives=3,lifecycle_status='alive',critical_used=false where session_id=s.id;
 perform set_config('request.jwt.claim.sub',other::text,true);
 perform pg_temp.fish_error(format('select public.set_trottl_special_debug_next(%L,4,%L)',s.id,'special_minigame_02'),'SPECIAL_DEBUG_HOST_REQUIRED');
 perform set_config('request.jwt.claim.sub',s.host_user_id::text,true);
 for n in 1..6 loop
  update public.trottl_special_sessions set host_user_id=s.host_user_id,current_turn_seat=seat,game_state=s.game_state||jsonb_build_object('actor',s.host_user_id,'actor_seat',seat,'phase','awaiting_roll') where id=s.id;
  perform public.set_trottl_special_debug_next(s.id,n,'special_minigame_02');
  perform public.act_trottl_special_game(s.id,'roll',(s.game_state->>'roll_seq')::bigint);
  select game_state into g from public.trottl_special_sessions where id=s.id;
  if (g->>'result')::integer<>n or (g->>'last_roll')::integer<>n
   or (select debug_test ? 'next_roll' from public.trottl_special_sessions where id=s.id)
   or (select debug_test->>'next_minigame' from public.trottl_special_sessions where id=s.id)<>'special_minigame_02' then raise exception 'Force % must consume only roll and retain game override',n; end if;
 end loop;
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('actor',s.host_user_id,'actor_seat',seat,'phase','awaiting_roll') where id=s.id;
 perform public.set_trottl_special_debug_next(s.id,4,'special_minigame_02');
 perform public.act_trottl_special_game(s.id,'roll',(s.game_state->>'roll_seq')::bigint);
 update public.trottl_special_sessions set game_state=jsonb_set(game_state,'{deadline}',to_jsonb(clock_timestamp()-interval '1 second')) where id=s.id;
 select game_state into g from public.trottl_special_sessions where id=s.id;
 perform public.act_trottl_special_game(s.id,'resolve',(g->>'roll_seq')::bigint);
 select game_state into g from public.trottl_special_sessions where id=s.id;
 if g->'minigame'->>'minigame_type'<>'special_minigame_02' or (select debug_test from public.trottl_special_sessions where id=s.id)<>'{}'::jsonb then raise exception 'Normal forced four flow must select fish and consume both overrides'; end if;
 perform pg_temp.fish_prepare('special_minigame_01');
 perform pg_temp.fish_prepare('special_minigame_02');
end; $$;
do $$ declare s public.trottl_special_sessions;g jsonb;ids uuid[];r uuid;hits jsonb;scores integer[];seq bigint;max_score integer;
begin
 select * into s from fish_baseline;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 foreach scores slice 1 in array array[[14,11,7,10],[14,14,7,7],[5,5,5,5]] loop
  g:=pg_temp.fish_prepare();r:=(g->'minigame'->>'minigame_id')::uuid;seq:=(g->>'roll_seq')::bigint;
  perform pg_temp.fish_error(format('select public.save_trottl_special_fish_catch(%L,%L,0,%L,true)',s.id,r,'[]'),'SPECIAL_FISH_CATCH_NOT_FINISHED');
  update public.trottl_special_sessions set game_state=jsonb_set(jsonb_set(game_state,'{minigame,start_at}',to_jsonb(clock_timestamp()-interval '11 seconds')),'{minigame,end_at}',to_jsonb(clock_timestamp()-interval '1 second')) where id=s.id;
  for i in 1..4 loop
   perform set_config('request.jwt.claim.sub',ids[i]::text,true);
   select jsonb_agg(jsonb_build_object('index',(spawn->>'i')::integer,'at',(spawn->>'t')::integer+1) order by ordinality)
    into hits from jsonb_array_elements(g->'minigame'->'pattern') with ordinality item(spawn,ordinality) where ordinality<=scores[i];
   max_score:=jsonb_array_length(g->'minigame'->'pattern');
   perform pg_temp.fish_error(format('select public.save_trottl_special_fish_catch(%L,%L,0,%L,true)',s.id,gen_random_uuid(),'[]'),'SPECIAL_INVALID_FISH_CATCH_PARTICIPANT');
   perform pg_temp.fish_error(format('select public.save_trottl_special_fish_catch(%L,%L,%s,%L,true)',s.id,r,max_score+1,'[]'),'SPECIAL_INVALID_FISH_CATCH_SCORE');
   perform public.save_trottl_special_fish_catch(s.id,r,scores[i],hits,true);
   perform public.save_trottl_special_fish_catch(s.id,r,scores[i],hits,true); -- Lost-response retry is idempotent.
   select game_state into g from public.trottl_special_sessions where id=s.id;
   if i<4 and g->>'phase'<>'minigame_active' then raise exception 'Premature ranking'; end if;
  end loop;
  if g->>'phase'<>'minigame_results' or g->'minigame'->>'ranking_direction'<>'higher_is_better' then raise exception 'Fish result pipeline'; end if;
  if scores[1]=5 then
   if jsonb_array_length(g->'minigame'->'winners')<>4 or g->'minigame'->'losers'<>'[]'::jsonb then raise exception 'All tied: all winners, no losers'; end if;
  elsif scores[2]=14 then
   if jsonb_array_length(g->'minigame'->'winners')<>2 or jsonb_array_length(g->'minigame'->'losers')<>2 then raise exception 'Best/worst ties'; end if;
  elsif g->'minigame'->'winners'<>jsonb_build_array(ids[1]) or g->'minigame'->'losers'<>jsonb_build_array(ids[3]) then raise exception 'Higher-is-better ranking'; end if;
  for i in 1..4 loop perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_game(s.id,'results_ack',seq);end loop;
  for i in 1..4 loop
   if g->'minigame'->'winners' ? ids[i]::text then
    perform set_config('request.jwt.claim.sub',ids[i]::text,true);
    perform public.act_trottl_special_game(s.id,'assign',seq,ids[1]);perform public.act_trottl_special_game(s.id,'assign',seq,ids[1]);perform public.act_trottl_special_game(s.id,'confirm',seq);
   end if;
  end loop;
  select game_state into g from public.trottl_special_sessions where id=s.id;
  if g->>'phase'<>'drink_ack' then raise exception 'Existing drink settlement'; end if;
  for i in 1..4 loop if g->'drinks' ? ids[i]::text then perform set_config('request.jwt.claim.sub',ids[i]::text,true);perform public.act_trottl_special_game(s.id,'ack',seq);end if;end loop;
 end loop;
end; $$;
rollback;
