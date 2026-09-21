begin;

-- Version 2 remains 30 seconds for rounds already in progress. Only new
-- version-3 runs return to 20 seconds; counts and hitboxes stay unchanged.
alter table public.trottl_special_poison_fish_runs
 drop constraint trottl_special_poison_fish_runs_simulation_version_check;
alter table public.trottl_special_poison_fish_runs
 add constraint trottl_special_poison_fish_runs_simulation_version_check check (simulation_version in (1,2,3));
alter table public.trottl_special_poison_fish_runs alter column simulation_version set default 3;

create or replace function public.special_poison_fish_config(p_version integer) returns jsonb
language plpgsql immutable security definer set search_path='' as $$
begin
 if p_version is null or p_version not in (1,2,3) then raise exception 'SPECIAL_POISON_FISH_VERSION';end if;
 return jsonb_build_object('normal',8,'gold',2,'poison',case when p_version=1 then 3 else 5 end,
  'duration_ms',case when p_version=2 then 30000 else 20000 end,'max_events',500,
  'hit_x',case when p_version=1 then 0.08 else 0.10 end,
  'hit_y',case when p_version=1 then 0.065 else 0.08125 end,
  'hitbox_scale',case when p_version=1 then 1 else 1.25 end,
  'speed_min_units',32,'speed_range_units',11);
end; $$;

create or replace function public.special_poison_fish_begin_locked(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_round_id uuid;g jsonb;p jsonb;runs jsonb:='{}'::jsonb;seed bigint;start_at timestamptz:=clock_timestamp()+interval '5 seconds';
begin
 v_round_id:=public.special_minigame_begin_locked(p_id,'special_minigame_07','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 for p in select value from jsonb_array_elements(g->'minigame'->'participants') loop
  loop
   seed:=1+floor(pg_catalog.random()*2147483646)::bigint;
   exit when not exists(select 1 from public.trottl_special_poison_fish_runs where session_id=p_id and round_id=v_round_id and movement_seed=seed);
  end loop;
  insert into public.trottl_special_poison_fish_runs(session_id,round_id,player_id,movement_seed,simulation_version)
  values(p_id,v_round_id,(p->>'player_id')::uuid,seed,3);
  runs:=runs||jsonb_build_object(p->>'player_id',jsonb_build_object('completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Giftfisch','title_started_at',start_at-interval '5 seconds','title_ends_at',start_at-interval '3 seconds',
  'start_at',start_at,'end_at',start_at+interval '20.4 seconds','runs',runs,'simulation_version',3),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

commit;
