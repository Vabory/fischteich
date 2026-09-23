begin;

do $$
declare seed bigint;points jsonb;again jsonb;point jsonb;previous jsonb;quadrants integer;ranked jsonb;
begin
 if (select count(*) from public.trottl_special_minigame_registry where implemented and enabled)<>9 then raise exception 'Catch me pool must contain nine games';end if;
 if public.special_minigame_pick(0)<>'special_minigame_01' or public.special_minigame_pick(0.888889)<>'special_minigame_09'
  or public.special_minigame_pick(0,'special_minigame_09')<>'special_minigame_09' then raise exception 'Nine-way pool or override mismatch';end if;
 for seed in 1..500 loop
  points:=public.special_catch_me_positions(seed);again:=public.special_catch_me_positions(seed);
  if points is distinct from again or jsonb_array_length(points)<>10 then raise exception 'Catch me determinism mismatch';end if;
  previous:=null;
  for point in select value from jsonb_array_elements(points) loop
   if (point->>'x')::numeric not between .11 and .89 or (point->>'y')::numeric not between .08 and .92 then raise exception 'Catch me bounds mismatch';end if;
   if previous is not null and sqrt(power((point->>'x')::numeric-(previous->>'x')::numeric,2)+power((point->>'y')::numeric-(previous->>'y')::numeric,2))<.30
    then raise exception 'Catch me minimum distance mismatch';end if;
   previous:=point;
  end loop;
  select count(distinct ((value->>'x')::numeric<.5)::text||':'||((value->>'y')::numeric<.5)::text) into quadrants
   from jsonb_array_elements(points) with ordinality item(value,ordinality) where ordinality<=4;
  if quadrants<>4 then raise exception 'Catch me coverage mismatch';end if;
 end loop;
 if public.special_catch_me_positions(12345)=public.special_catch_me_positions(54321) then raise exception 'New seeds must vary the sequence';end if;

 ranked:=public.special_minigame_rank_drinks('[{"player_id":"00000000-0000-4000-8000-000000000001","raw_value":3200},{"player_id":"00000000-0000-4000-8000-000000000002","raw_value":4100},{"player_id":"00000000-0000-4000-8000-000000000003","raw_value":5200}]','lower_is_better');
 if ranked->'winners'<>jsonb_build_array('00000000-0000-4000-8000-000000000001') or ranked->'losers'<>jsonb_build_array('00000000-0000-4000-8000-000000000003') then raise exception 'Catch me ranking mismatch';end if;
 ranked:=public.special_minigame_rank_drinks('[{"player_id":"00000000-0000-4000-8000-000000000001","raw_value":3200},{"player_id":"00000000-0000-4000-8000-000000000002","raw_value":3200},{"player_id":"00000000-0000-4000-8000-000000000003","raw_value":5000}]','lower_is_better');
 if jsonb_array_length(ranked->'winners')<>2 or jsonb_array_length(ranked->'losers')<>1 then raise exception 'Catch me tie mismatch';end if;
 ranked:=public.special_minigame_rank_drinks('[{"player_id":"00000000-0000-4000-8000-000000000001","raw_value":4000},{"player_id":"00000000-0000-4000-8000-000000000002","raw_value":4000},{"player_id":"00000000-0000-4000-8000-000000000003","raw_value":4000}]','lower_is_better');
 if jsonb_array_length(ranked->'winners')<>3 or jsonb_array_length(ranked->'losers')<>0 or not (ranked->>'all_tied')::boolean then raise exception 'Catch me full tie mismatch';end if;
 ranked:=public.special_minigame_rank_drinks('[{"player_id":"00000000-0000-4000-8000-000000000001","raw_value":3200},{"player_id":"00000000-0000-4000-8000-000000000002","raw_value":4100},{"player_id":"00000000-0000-4000-8000-000000000003","raw_value":30001}]','lower_is_better');
 if ranked->'losers'<>jsonb_build_array('00000000-0000-4000-8000-000000000003') then raise exception 'Catch me timeout ranking mismatch';end if;
 ranked:=public.special_minigame_rank_drinks('[{"player_id":"00000000-0000-4000-8000-000000000001","raw_value":30001},{"player_id":"00000000-0000-4000-8000-000000000002","raw_value":30001}]','lower_is_better');
 if jsonb_array_length(ranked->'winners')<>2 or jsonb_array_length(ranked->'losers')<>0 then raise exception 'Catch me all-timeout tie mismatch';end if;
end; $$;

rollback;
