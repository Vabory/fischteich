begin;

do $$
begin
 if public.special_stop_fish_distance(0)<>100001 then raise exception 'right offscreen score'; end if;
 if public.special_stop_fish_distance(350)<>0 then raise exception 'first-pass center score'; end if;
 if public.special_stop_fish_distance(700)<>100001 then raise exception 'respawn score'; end if;
 if public.special_stop_fish_distance(1199)<>100001 then raise exception 'end of respawn score'; end if;
 if public.special_stop_fish_distance(1200)<>100001 then raise exception 'next pass right offscreen score'; end if;
 if public.special_stop_fish_distance(1550)<>0 then raise exception 'next-pass center score'; end if;
end;
$$;

rollback;
