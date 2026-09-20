begin;

-- Pure pattern and timing checks after the Fish-Memory migration is applied.
do $$
declare p jsonb:=public.special_fish_memory_pattern(92831);again jsonb:=public.special_fish_memory_pattern(92831);i integer;
begin
 if p is distinct from again or jsonb_array_length(p)<>12 then raise exception 'Fish-Memory deterministic 12-entry pattern'; end if;
 if exists(select 1 from jsonb_array_elements_text(p) color where color not in ('RED','BLUE','GREEN','YELLOW')) then
  raise exception 'Fish-Memory invalid color';
 end if;
 for i in 0..9 loop
  if p->>i=p->>(i+1) and p->>i=p->>(i+2) then raise exception 'Fish-Memory triple color'; end if;
 end loop;
 if public.special_fish_memory_watch_ms(1)<>4080 or public.special_fish_memory_watch_ms(2)<>8160 or public.special_fish_memory_watch_ms(3)<>12240
  or public.special_fish_memory_timeout_ms(1)<>8000 or public.special_fish_memory_timeout_ms(2)<>13000 or public.special_fish_memory_timeout_ms(3)<>18000 then
  raise exception 'Fish-Memory tuning';
 end if;
end $$;

-- Exact current 20-percent production pool.
do $$
begin
 if public.special_minigame_pick(0)<>'special_minigame_01' or public.special_minigame_pick(0.199999)<>'special_minigame_01'
  or public.special_minigame_pick(0.2)<>'special_minigame_02' or public.special_minigame_pick(0.399999)<>'special_minigame_02'
  or public.special_minigame_pick(0.4)<>'special_minigame_03' or public.special_minigame_pick(0.599999)<>'special_minigame_03'
  or public.special_minigame_pick(0.6)<>'special_minigame_04' or public.special_minigame_pick(0.799999)<>'special_minigame_04'
  or public.special_minigame_pick(0.8)<>'special_minigame_05' or public.special_minigame_pick(0.999999)<>'special_minigame_05' then
  raise exception 'Fish-Memory five-way pool';
 end if;
end $$;

rollback;
