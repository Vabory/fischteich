begin;

-- One shared cadence: 800 ms visible flash + 220 ms neutral separation per item.
create or replace function public.special_fish_memory_watch_ms(p_memory_round integer)
returns integer language sql immutable security definer set search_path='' as $$
 select case when p_memory_round between 1 and 3 then p_memory_round*4*(800+220) else null end;
$$;

create or replace function public.special_fish_memory_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare memory_round_id uuid;g jsonb;runs jsonb:='{}'::jsonb;p jsonb;seed_value bigint;pattern_value jsonb;
 title_at timestamptz:=clock_timestamp();start_at timestamptz;watch_ms integer;
begin
 memory_round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_05','lower_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 start_at:=title_at+interval '5 seconds';watch_ms:=public.special_fish_memory_watch_ms(1);seed_value:=1+floor(pg_catalog.random()*2147483646)::bigint;
 pattern_value:=public.special_fish_memory_pattern(seed_value);
 insert into public.trottl_special_fish_memory_rounds(session_id,round_id,seed,pattern) values(p_id,memory_round_id,seed_value,pattern_value);
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  insert into public.trottl_special_fish_memory_runs(session_id,round_id,player_id,phase_started_at,phase_ends_at)
   values(p_id,memory_round_id,(p->>'player_id')::uuid,start_at+400*interval '1 millisecond',start_at+(400+watch_ms)*interval '1 millisecond');
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('memory_round',1,'phase','watch','guess_count',0,'completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object('title','Fisch-Memory','title_started_at',title_at,'title_ends_at',title_at+interval '2 seconds','start_at',start_at,'runs',runs),'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

revoke all on function public.special_fish_memory_watch_ms(integer),public.special_fish_memory_begin_locked(uuid) from public,anon,authenticated;
commit;
