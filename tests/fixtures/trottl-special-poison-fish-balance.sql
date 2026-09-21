begin;

do $$
declare old_config jsonb:=public.special_poison_fish_config(1);
 new_config jsonb:=public.special_poison_fish_config(2);
begin
 if (old_config->>'duration_ms')::integer<>20000 or (old_config->>'poison')::integer<>3
  or (old_config->>'hit_x')::numeric<>0.08 or (old_config->>'hit_y')::numeric<>0.065 then
  raise exception 'Version 1 Giftfisch balance changed';
 end if;
 if (new_config->>'duration_ms')::integer<>30000 or (new_config->>'normal')::integer<>8
  or (new_config->>'gold')::integer<>2 or (new_config->>'poison')::integer<>5
  or (new_config->>'hit_x')::numeric<>0.10 or (new_config->>'hit_y')::numeric<>0.08125
  or (new_config->>'hitbox_scale')::numeric<>1.25 then
  raise exception 'Version 2 Giftfisch balance mismatch';
 end if;
 if public.special_poison_fish_replay(12345,jsonb_build_array(jsonb_build_object('t',29999,'x',0,'y',0)),2)<>0 then
  raise exception 'Late version-2 miss must be valid';
 end if;
 begin
  perform public.special_poison_fish_replay(12345,jsonb_build_array(jsonb_build_object('t',30000,'x',0,'y',0)),2);
  raise exception 'Version-2 event at deadline was accepted';
 exception when others then
  if sqlerrm<>'SPECIAL_INVALID_POISON_FISH_EVENT' then raise;end if;
 end;
 begin
  perform public.special_poison_fish_replay(12345,jsonb_build_array(jsonb_build_object('t',20000,'x',0,'y',0)),1);
  raise exception 'Version-1 event at deadline was accepted';
 exception when others then
  if sqlerrm<>'SPECIAL_INVALID_POISON_FISH_EVENT' then raise;end if;
 end;
end; $$;

rollback;
