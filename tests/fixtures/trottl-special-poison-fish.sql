begin;

do $$
declare c jsonb;point numeric[];again numeric[];seed bigint;score_value integer;found_normal boolean:=false;found_gold boolean:=false;found_poison boolean:=false;slot integer;
begin
 c:=public.special_poison_fish_config(1);
 if (c->>'normal')::integer<>8 or (c->>'gold')::integer<>2 or (c->>'poison')::integer<>3
  or (c->>'duration_ms')::integer<>10000 then raise exception 'Poison fish balance mismatch';end if;
 if public.special_poison_fish_replay(12345,'[]'::jsonb,1)<>0 then raise exception 'Empty log must score zero';end if;
 if public.special_poison_fish_hash(12345,0,0,1)=public.special_poison_fish_hash(54321,0,0,1) then raise exception 'Player seeds must diverge';end if;
 point:=public.special_poison_fish_state(12345,0,0,0,null,null,4300,1);
 again:=public.special_poison_fish_state(12345,0,0,0,null,null,4300,1);
 if point is distinct from again or point[1] not between 0.1 and 0.9 or point[2] not between 0.09 and 0.91 then raise exception 'Absolute reflection mismatch';end if;
 for seed in 1..1000 loop
  for slot in 0..12 loop
   point:=public.special_poison_fish_state(seed,slot,0,0,null,null,0,1);
   score_value:=public.special_poison_fish_replay(seed,jsonb_build_array(jsonb_build_object('t',0,'x',point[1],'y',point[2])),1);
   if slot<8 and score_value=1 then found_normal:=true;end if;
   if slot between 8 and 9 and score_value=3 then found_gold:=true;end if;
   if slot>=10 and score_value=-3 then found_poison:=true;end if;
  end loop;
  exit when found_normal and found_gold and found_poison;
 end loop;
 if not (found_normal and found_gold and found_poison) then raise exception 'Fish score cases missing';end if;
 if (select count(*) from public.trottl_special_minigame_registry where implemented and enabled)<>8 then raise exception 'Productive pool must contain eight games';end if;
end; $$;

rollback;
