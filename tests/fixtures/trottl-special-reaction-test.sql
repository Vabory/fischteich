-- Owner-only regression in a disposable PostgreSQL DB after all migrations.
-- SET fischteich.test_session_id='UUID' to an idle Special playing room. Always rollback.
begin;
do $$
declare s public.trottl_special_sessions;ids uuid[];g jsonb;m jsonb;r uuid;
begin
 select * into s from public.trottl_special_sessions where id=nullif(current_setting('fischteich.test_session_id',true),'')::uuid;
 if s.id is null or s.status<>'playing' then raise exception 'Dedicated Special playing room required'; end if;
 select array_agg(user_id order by seat_index) into ids from public.trottl_special_players where session_id=s.id;
 if coalesce(array_length(ids,1),0)<3 then raise exception 'At least three players required'; end if;
 update public.trottl_special_players set lives=case when user_id=any(ids[1:3]) then 3 else 0 end,
  lifecycle_status=case when user_id=any(ids[1:3]) then 'alive' else 'eliminated' end where session_id=s.id;
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('phase','placeholder','result',4,'rescue',false) where id=s.id;
 perform public.special_reaction_begin_locked(s.id);
 select game_state into g from public.trottl_special_sessions where id=s.id;m:=g->'minigame';r:=(m->>'minigame_id')::uuid;
 if m->>'minigame_type'<>'special_minigame_03' or m->>'ranking_direction'<>'lower_is_better'
  or jsonb_array_length(m->'participants')<>3 then raise exception 'Reaction begin'; end if;
 if (select count(*) from public.trottl_special_reaction_runs where session_id=s.id and round_id=r)<>3
  or exists(select 1 from public.trottl_special_reaction_runs where session_id=s.id and round_id=r and delay_ms not between 2000 and 8500)
  or exists(select 1 from jsonb_each(m->'runs') e where e.value ? 'delay_ms' or e.value ? 'signal_at') then raise exception 'Private delay state'; end if;
 update public.trottl_special_reaction_runs set status=case player_id when ids[1] then 'completed' when ids[2] then 'completed' else 'false_start' end,
  reaction_ms=case player_id when ids[1] then 200 when ids[2] then 300 else null end,
  tap_elapsed_ms=case player_id when ids[1] then delay_ms+200 when ids[2] then delay_ms+300 else delay_ms-1 end,finished_at=clock_timestamp()
  where session_id=s.id and round_id=r;
 perform public.special_reaction_finalize_locked(s.id);
 select game_state into g from public.trottl_special_sessions where id=s.id;m:=g->'minigame';
 if m->'winners'<>jsonb_build_array(ids[1]) or m->'losers'<>jsonb_build_array(ids[2],ids[3])
  or m->'automatic_drinks'<>jsonb_build_object(ids[2]::text,2,ids[3]::text,2)
  or not (m->'distributions' ? ids[1]::text)
  or m->'results'->2->>'display_value'<>'FEHLSTART' then raise exception 'Reaction ranking/settlement'; end if;
end; $$;
rollback;
