begin;

-- Deterministic private challenge: target and ink differ, and every fish occurs once.
do $$
declare first jsonb;again jsonb;next_challenge jsonb;
begin
 first:=public.special_color_chaos_challenge(92831,7);
 again:=public.special_color_chaos_challenge(92831,7);
 next_challenge:=public.special_color_chaos_challenge(92831,8);
 if first is distinct from again or first->>'target_color'=first->>'ink_color'
  or jsonb_array_length(first->'fish_order')<>4
  or (select count(distinct value) from jsonb_array_elements_text(first->'fish_order'))<>4
  or first is not distinct from next_challenge then raise exception 'Deterministic private challenge'; end if;
end $$;

-- Five-way production pool with override precedence and no unfinished slot.
do $$
begin
 if public.special_minigame_pick(0)<>'special_minigame_01'
  or public.special_minigame_pick(0.199999)<>'special_minigame_01'
  or public.special_minigame_pick(0.2)<>'special_minigame_02'
  or public.special_minigame_pick(0.4)<>'special_minigame_03'
  or public.special_minigame_pick(0.6)<>'special_minigame_04'
  or public.special_minigame_pick(0.8)<>'special_minigame_05'
  or public.special_minigame_pick(0.999999)<>'special_minigame_05'
  or public.special_minigame_pick(0,'special_minigame_05')<>'special_minigame_05'
  or exists(select 1 from public.trottl_special_minigame_registry where enabled and id not in
   ('special_minigame_01','special_minigame_02','special_minigame_03','special_minigame_04','special_minigame_05'))
 then raise exception 'Five-way production pool'; end if;
end $$;

rollback;
