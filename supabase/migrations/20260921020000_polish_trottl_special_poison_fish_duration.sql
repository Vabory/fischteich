begin;

-- The original Giftfisch migration is already deployed. Preserve its validated
-- replay and security logic, changing only the four duration-dependent literals.
-- Fail loudly if an installed function no longer matches that baseline.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.special_poison_fish_config(integer)'::regprocedure);
 if strpos(definition,'''duration_ms'',10000')=0 then raise exception 'Unexpected Giftfisch config definition';end if;
 execute replace(definition,'''duration_ms'',10000','''duration_ms'',20000');

 definition:=pg_get_functiondef('public.special_poison_fish_replay(bigint,jsonb,integer)'::regprocedure);
 if strpos(definition,'t>=10000')=0 then raise exception 'Unexpected Giftfisch replay definition';end if;
 execute replace(definition,'t>=10000','t>=20000');

 definition:=pg_get_functiondef('public.special_poison_fish_begin_locked(uuid)'::regprocedure);
 if strpos(definition,'''10.4 seconds''')=0 then raise exception 'Unexpected Giftfisch begin definition';end if;
 execute replace(definition,'''10.4 seconds''','''20.4 seconds''');

 definition:=pg_get_functiondef('public.submit_trottl_special_poison_fish(uuid,uuid,jsonb,boolean)'::regprocedure);
 if strpos(definition,'''13 seconds''')=0 or strpos(definition,'''10 seconds''')=0 then
  raise exception 'Unexpected Giftfisch submit definition';
 end if;
 definition:=replace(definition,'''13 seconds''','''23 seconds''');
 execute replace(definition,'''10 seconds''','''20 seconds''');
end; $$;

commit;
