begin;

do $$
declare v2 jsonb:=public.special_poison_fish_config(2);
 v3 jsonb:=public.special_poison_fish_config(3);
begin
 if (v2->>'duration_ms')::integer<>30000 or (v3->>'duration_ms')::integer<>20000 then
  raise exception 'Giftfisch versioned duration mismatch';
 end if;
 if (v3->>'normal')::integer<>8 or (v3->>'gold')::integer<>2 or (v3->>'poison')::integer<>5
  or (v3->>'hit_x')::numeric<>(v2->>'hit_x')::numeric
  or (v3->>'hit_y')::numeric<>(v2->>'hit_y')::numeric then
  raise exception 'Giftfisch counts or hitbox changed';
 end if;
 if public.special_poison_fish_replay(12345,jsonb_build_array(jsonb_build_object('t',19900,'x',0,'y',0)),3)<>0 then
  raise exception 'Version-3 event before deadline rejected';
 end if;
 begin
  perform public.special_poison_fish_replay(12345,jsonb_build_array(jsonb_build_object('t',20000,'x',0,'y',0)),3);
  raise exception 'Version-3 event at deadline accepted';
 exception when others then
  if sqlerrm<>'SPECIAL_INVALID_POISON_FISH_EVENT' then raise;end if;
 end;
end; $$;

rollback;
