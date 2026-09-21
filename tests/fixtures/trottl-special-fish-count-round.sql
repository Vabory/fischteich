-- Owner-only integration regression in a disposable PostgreSQL DB after all migrations.
-- SET fischteich.test_session_id='UUID' to an idle Special playing room with three players.
begin;
do $$
declare s public.trottl_special_sessions;ids uuid[];g jsonb;m jsonb;r uuid;answer integer;scenario integer;
begin
 select * into s from public.trottl_special_sessions where id=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
 if s.id is null or s.status<>'playing' then raise exception 'Dedicated Special playing room required';end if;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 if coalesce(array_length(ids,1),0)<3 then raise exception 'At least three players required';end if;
 update public.trottl_special_players set lives=case when user_id=any(ids[1:3]) then 3 else 0 end,
  lifecycle_status=case when user_id=any(ids[1:3]) then 'alive' else 'eliminated' end where session_id=s.id;
 for scenario in 1..5 loop
  update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('phase','placeholder','result',4,'rescue',false) where id=s.id;
  perform public.special_fish_count_begin_locked(s.id);
  select game_state into g from public.trottl_special_sessions where id=s.id;m:=g->'minigame';r:=(m->>'minigame_id')::uuid;
  select fish_count into answer from public.trottl_special_fish_count_rounds where session_id=s.id and round_id=r;
  if m->>'minigame_type'<>'special_minigame_08' or m ? 'correct_count' or m ? 'choices'
   or (select count(*) from public.trottl_special_fish_count_runs where session_id=s.id and round_id=r)<>3
   then raise exception 'Fish count begin/privacy failed';end if;
  if scenario=1 then
   update public.trottl_special_fish_count_runs set selected_answer=case when player_id=ids[3] then answer+1 else answer end,
    response_ms=case player_id when ids[1] then 900 when ids[2] then 1300 else 500 end,
    correct=player_id<>ids[3],completed=true,completed_at=clock_timestamp() where session_id=s.id and round_id=r;
  elsif scenario=2 then
   update public.trottl_special_fish_count_runs set selected_answer=case when player_id=ids[3] then answer+1 else answer end,
    response_ms=case when player_id=ids[3] then 500 else 1000 end,
    correct=player_id<>ids[3],completed=true,completed_at=clock_timestamp() where session_id=s.id and round_id=r;
  elsif scenario=3 then
   update public.trottl_special_fish_count_runs set selected_answer=answer,response_ms=case player_id when ids[1] then 900 when ids[2] then 1200 else 1500 end,
    correct=true,completed=true,completed_at=clock_timestamp() where session_id=s.id and round_id=r;
  elsif scenario=4 then
   update public.trottl_special_fish_count_runs set selected_answer=answer+1,response_ms=1000,correct=false,
    completed=true,completed_at=clock_timestamp() where session_id=s.id and round_id=r;
  else
   update public.trottl_special_fish_count_rounds set answer_deadline=clock_timestamp()-interval '1 millisecond'
    where session_id=s.id and round_id=r;
  end if;
  perform public.special_fish_count_finalize_locked(s.id);
  select game_state into g from public.trottl_special_sessions where id=s.id;m:=g->'minigame';
  if g->>'phase'<>'minigame_results' or (m->>'correct_count')::integer<>answer then raise exception 'Fish count result phase failed';end if;
  if scenario=1 and (m->'winners'<>jsonb_build_array(ids[1]) or m->'losers'<>jsonb_build_array(ids[3])
   or m->'automatic_drinks'<>jsonb_build_object(ids[3]::text,2) or (m->>'all_wrong')::boolean) then raise exception 'Mixed ranking failed';end if;
  if scenario=2 and (m->'winners'<>jsonb_build_array(ids[1],ids[2]) or m->'losers'<>jsonb_build_array(ids[3])) then raise exception 'Tie ranking failed';end if;
  if scenario=3 and (m->'winners'<>jsonb_build_array(ids[1]) or m->'losers'<>'[]'::jsonb) then raise exception 'All-correct ranking failed';end if;
  if scenario in (4,5) then
   if m->'winners'<>'[]'::jsonb or jsonb_array_length(m->'losers')<>3 or not (m->>'all_wrong')::boolean
    or (m->>'loser_drink_count')::integer<>4
    or m->'automatic_drinks'<>jsonb_build_object(ids[1]::text,4,ids[2]::text,4,ids[3]::text,4)
    or m->'distributions'<>'{}'::jsonb then raise exception 'All-wrong penalty failed';end if;
   if scenario=5 and exists(select 1 from public.trottl_special_fish_count_runs where session_id=s.id and round_id=r and (not completed or correct))
    then raise exception 'Timeout did not mark all players wrong';end if;
   update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m||jsonb_build_object('result_seen',
    jsonb_build_object(ids[1]::text,true,ids[2]::text,true,ids[3]::text,true))) where id=s.id;
   perform public.special_minigame_settle_locked(s.id);
   select game_state into g from public.trottl_special_sessions where id=s.id;
   if g->>'phase'<>'drink_ack' or g->'drinks'<>jsonb_build_object(ids[1]::text,4,ids[2]::text,4,ids[3]::text,4)
    then raise exception 'All-wrong settlement failed';end if;
  end if;
 end loop;
end; $$;
rollback;
