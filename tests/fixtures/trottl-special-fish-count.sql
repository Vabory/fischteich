begin;

do $$
declare seed bigint;count_value integer;choices jsonb;duration integer;previous integer:=0;
begin
 if (select count(*) from public.trottl_special_minigame_registry where implemented and enabled)<>9 then raise exception 'Productive pool must contain nine games';end if;
 for seed in 1..140 loop
  count_value:=public.special_fish_count_for_seed(seed);
  if count_value not between 5 and 18 then raise exception 'Fish count outside range';end if;
  duration:=public.special_fish_count_reveal_ms(count_value);
  if duration not between 1000 and 2000 then raise exception 'Reveal duration outside range';end if;
  choices:=public.special_fish_count_choices(seed,count_value);
  if jsonb_array_length(choices)<>4 or not choices @> jsonb_build_array(count_value)
   or (select count(distinct value) from jsonb_array_elements_text(choices) answer(value))<>4
   or exists(select 1 from jsonb_array_elements_text(choices) answer(value) where value::integer<1 or abs(value::integer-count_value)>3)
   then raise exception 'Invalid fish count choices';end if;
 end loop;
 for count_value in 5..18 loop
  duration:=public.special_fish_count_reveal_ms(count_value);
  if duration<previous then raise exception 'Reveal duration not monotonic';end if;
  previous:=duration;
 end loop;
 if public.special_fish_count_reveal_ms(5)<>1000 or public.special_fish_count_reveal_ms(18)<>2000 then raise exception 'Reveal duration endpoints wrong';end if;
 if public.special_minigame_pick(0)<>'special_minigame_01' or public.special_minigame_pick(0.111112)<>'special_minigame_02'
  or public.special_minigame_pick(0.777778)<>'special_minigame_08' or public.special_minigame_pick(0.888889)<>'special_minigame_09'
  or public.special_minigame_pick(0,'special_minigame_09')<>'special_minigame_09' then raise exception 'Nine-way picker or TEST override wrong';end if;
end; $$;

rollback;
