begin;
-- Own Special event. No Fisch Roulette tables, counters or statistics are used.
create function public.special_roulette_color(p_random double precision)
returns text language plpgsql immutable set search_path='' as $$
begin
 if p_random is null or not (p_random>=0 and p_random<1) then raise exception 'SPECIAL_INVALID_RANDOM'; end if;
 return case when p_random<0.45 then 'RED' when p_random<0.90 then 'BLACK' else 'GREEN' end;
end; $$;

-- Normal heal deliberately does not change the critical-only rescue helper.
create function public.special_heal_life_locked(p_id uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.trottl_special_players set lives=lives+1 where session_id=p_id and user_id=p_target
  and lifecycle_status='alive' and lives between 1 and 2;
 if not found then raise exception 'SPECIAL_INVALID_HEAL'; end if;
end; $$;

create function public.special_roulette_rewards(p_id uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('attack',a.valid and t.valid,'heal',a.heal,
  'transfer',a.valid and t.valid and s.game_state->>'trottl'=p_actor::text)
 from public.trottl_special_sessions s
 cross join lateral (select exists(select 1 from public.trottl_special_players where session_id=p_id and user_id=p_actor
  and lifecycle_status='alive' and lives>0) valid, exists(select 1 from public.trottl_special_players where session_id=p_id
  and user_id=p_actor and lifecycle_status='alive' and lives between 1 and 2) heal) a
 cross join lateral (select exists(select 1 from public.trottl_special_players where session_id=p_id and user_id<>p_actor
  and lifecycle_status='alive' and lives>0) valid) t where s.id=p_id;
$$;

create function public.special_roulette_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 update public.trottl_special_sessions set game_state=(g-'deadline'-'minigame')||jsonb_build_object('phase','roulette_choose_color',
  'revision',(g->>'revision')::bigint+1,'roulette',jsonb_build_object('round_id',pg_catalog.gen_random_uuid(),
  'roller',g->>'actor','chosen_color',null,'result_color',null,'reward',null,'target',null,'reward_done',false,
  'shots','{}'::jsonb,'shot_acks','{}'::jsonb)) where id=p_id;
end; $$;

-- Called only under the session/room locks. Result and obligations are created once at color commit.
create function public.special_roulette_settle_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; r jsonb; avail jsonb; v_shots jsonb; v_actor uuid;
begin
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 if g->>'phase' not in ('roulette_choose_color','roulette_spinning','roulette_settlement') then return; end if;
 r:=g->'roulette';v_actor:=(g->>'actor')::uuid;
 if g->>'phase'='roulette_choose_color' then return; end if;
 select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) into v_shots from jsonb_each(r->'shots') k
  join public.trottl_special_players p on p.session_id=p_id and p.user_id::text=k.key and p.lifecycle_status in ('alive','critical');
 r:=r||jsonb_build_object('shots',v_shots);
 if not (r->>'reward_done')::boolean and r->>'target' is not null and not exists(select 1 from public.trottl_special_players where session_id=p_id
  and user_id=(r->>'target')::uuid and user_id is distinct from v_actor and lifecycle_status='alive' and lives>0) then
  r:=r||jsonb_build_object('target',null);
 end if;
 avail:=public.special_roulette_rewards(p_id,v_actor);
 r:=r||jsonb_build_object('available',avail);
 if not (r->>'reward_done')::boolean and (v_actor is null or not exists(select 1 from jsonb_each(avail) a where a.value='true'::jsonb)) then
  r:=r||jsonb_build_object('reward_done',true,'reward_waived',true);
 elsif r->>'reward' is not null and not coalesce((avail->>(r->>'reward'))::boolean,false) and not (r->>'reward_done')::boolean then
  r:=r||jsonb_build_object('reward',null,'target',null);
 end if;
 if g->>'phase'='roulette_spinning' and clock_timestamp()>=(r->>'spin_ends_at')::timestamptz then
  g:=g||jsonb_build_object('phase','roulette_settlement');
 end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('roulette',r,'revision',(g->>'revision')::bigint+1) where id=p_id;
 if g->>'phase'='roulette_settlement' and (r->>'reward_done')::boolean
  and not exists(select 1 from jsonb_each(r->'shots') k where not (r->'shot_acks' ? k.key)) then
  perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);
 end if;
end; $$;

create function public.act_trottl_special_roulette(p_session_id uuid,p_round_id uuid,p_action text,p_value text default null,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;r jsonb;v_slot smallint;v_color text;v_shots jsonb;avail jsonb;v_target integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;r:=g->'roulette';
 if s.status<>'playing' or g->>'phase' not in ('roulette_choose_color','roulette_spinning','roulette_settlement')
  or (r->>'round_id')::uuid is distinct from p_round_id then raise exception 'SPECIAL_STALE_ROULETTE'; end if;
 if not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 if p_action='resolve' then perform public.special_roulette_settle_locked(p_session_id);return p_session_id; end if;
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid()
  and lifecycle_status in ('alive','critical')) then raise exception 'SPECIAL_ROULETTE_READ_ONLY'; end if;
 if p_action='color' then
  if g->>'actor' is distinct from auth.uid()::text or g->>'phase'<>'roulette_choose_color' or r->>'chosen_color' is not null
   or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status='alive' and lives>0)
   or p_value is null or p_value not in ('RED','BLACK','GREEN') then raise exception 'SPECIAL_INVALID_COLOR'; end if;
  v_color:=public.special_roulette_color(pg_catalog.random());
  -- Same Fisch Roulette 1x: 4700ms, target tile 43..46, pitch81, width78, start index2.
  v_target:=43+floor(pg_catalog.random()*4)::integer;
  v_shots:='{}'::jsonb;
  if p_value<>v_color then v_shots:=jsonb_build_object(auth.uid()::text,1);
  elsif p_value='GREEN' and v_color='GREEN' then
   select coalesce(jsonb_object_agg(user_id::text,1),'{}'::jsonb) into v_shots from public.trottl_special_players
    where session_id=p_session_id and user_id<>auth.uid() and lifecycle_status in ('alive','critical');
  end if;
  r:=r||jsonb_build_object('chosen_color',p_value,'result_color',v_color,'spin_id',pg_catalog.gen_random_uuid(),
   'spin_started_at',clock_timestamp(),'spin_ends_at',clock_timestamp()+interval '4700 milliseconds','duration_ms',4700,
   'target_index',v_target,'stop_within_tile',39,'start_offset',-201,'end_offset',-(v_target*81+39),
   'shots',v_shots,'reward_done',p_value<>v_color);
  g:=g||jsonb_build_object('phase','roulette_spinning');
 else
  if g->>'phase'<>'roulette_settlement' then raise exception 'SPECIAL_ROULETTE_NOT_SETTLED'; end if;
  if p_action='shot_ack' then
   if not (r->'shots' ? auth.uid()::text) then raise exception 'SPECIAL_INVALID_SHOT_ACK'; end if;
   r:=r||jsonb_build_object('shot_acks',(r->'shot_acks')||jsonb_build_object(auth.uid()::text,true));
  else
   if g->>'actor' is distinct from auth.uid()::text or r->>'chosen_color' is distinct from r->>'result_color'
    or (r->>'reward_done')::boolean then raise exception 'SPECIAL_INVALID_REWARD_ACTOR'; end if;
   avail:=public.special_roulette_rewards(p_session_id,auth.uid());
   if p_action='reward' then
    if p_value is null or p_value not in ('attack','heal','transfer') or not coalesce((avail->>p_value)::boolean,false)
     or r->>'reward' is not null then raise exception 'SPECIAL_REWARD_UNAVAILABLE'; end if;
    r:=r||jsonb_build_object('reward',p_value,'target',null);
   elsif p_action='undo' then
    r:=r||case when r->>'target' is not null then jsonb_build_object('target',null) else jsonb_build_object('reward',null,'target',null) end;
   elsif p_action in ('target','confirm') then
    if r->>'reward' is null or not coalesce((avail->>(r->>'reward'))::boolean,false) then raise exception 'SPECIAL_REWARD_UNAVAILABLE'; end if;
    if r->>'reward' in ('attack','transfer') then
     if p_action='target' then r:=r||jsonb_build_object('target',p_target); end if;
     if r->>'target' is null or not exists(select 1 from public.trottl_special_players where session_id=p_session_id
      and user_id=(r->>'target')::uuid and user_id<>auth.uid() and lifecycle_status='alive' and lives>0) then raise exception 'SPECIAL_INVALID_REWARD_TARGET'; end if;
    elsif p_action='target' then raise exception 'SPECIAL_HEAL_HAS_NO_TARGET'; end if;
    if p_action='confirm' then
     if r->>'reward'='attack' then
      perform public.special_lose_life_locked(p_session_id,(r->>'target')::uuid);
      select game_state into g from public.trottl_special_sessions where id=p_session_id;
     elsif r->>'reward'='heal' then perform public.special_heal_life_locked(p_session_id,auth.uid());
     else g:=g||jsonb_build_object('trottl',r->>'target'); end if;
     r:=r||jsonb_build_object('reward_done',true,'reward_confirmed_at',clock_timestamp());
    end if;
   else raise exception 'SPECIAL_INVALID_ROULETTE_ACTION'; end if;
  end if;
 end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('roulette',r,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_roulette_settle_locked(p_session_id);
 return p_session_id;
end; $$;

alter function public.act_trottl_special_game(uuid,text,bigint,uuid) rename to act_trottl_special_phase_three;
revoke all on function public.act_trottl_special_phase_three(uuid,text,bigint,uuid) from public,anon,authenticated;
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;
 if p_roll_seq is distinct from (g->>'roll_seq')::bigint then raise exception 'TROTTL_SPECIAL_STALE_ACTION'; end if;
 if g->>'phase' in ('roulette_choose_color','roulette_spinning','roulette_settlement') then
  if p_action<>'resolve' then raise exception 'SPECIAL_USE_ROULETTE_RPC'; end if;
  return public.act_trottl_special_roulette(p_session_id,(g->'roulette'->>'round_id')::uuid,'resolve');
 end if;
 perform public.act_trottl_special_phase_three(p_session_id,p_action,p_roll_seq,p_target);
 if p_action='resolve' and g->>'phase'='rolling' and (g->>'result')::integer=6 and not coalesce((g->>'rescue')::boolean,false) then
  select game_state into g from public.trottl_special_sessions where id=p_session_id;
  if g->>'phase'='placeholder' then perform public.special_roulette_begin_locked(p_session_id); end if;
 end if;
 return p_session_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_phase_three;
revoke all on function public.leave_trottl_special_phase_three(uuid) from public,anon,authenticated;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;r jsonb;v_slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;r:=g->'roulette';
 if g->>'phase' not in ('roulette_choose_color','roulette_spinning','roulette_settlement') then return public.leave_trottl_special_phase_three(p_session_id); end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid();
 if not found then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 if g->>'actor'=auth.uid()::text then
  g:=g||jsonb_build_object('actor',null);
  if not (r->>'reward_done')::boolean then r:=r||jsonb_build_object('reward_done',true,'reward_waived',true); end if;
 end if;
 if g->>'trottl'=auth.uid()::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('roulette',r,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 if g->>'phase'='roulette_choose_color' and g->>'actor' is null then
  perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);
 else perform public.special_roulette_settle_locked(p_session_id); end if;
 return true;
end; $$;

create or replace function public.special_validate_game_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;s public.trottl_special_sessions;g jsonb;
begin
 if tg_table_name='trottl_special_sessions' then v_id:=new.id; else v_id:=coalesce(new.session_id,old.session_id); end if;
 select * into s from public.trottl_special_sessions where id=v_id;
 if not found or s.status<>'playing' then return null; end if;g:=s.game_state;
 if g->>'phase' is null or g->>'phase' not in ('awaiting_roll','rescue_roll','rolling','distribution','choose_trottl','drink_ack','trottl_peak','placeholder','awaiting_players',
  'minigame_active','minigame_results','minigame_distribution','panic_active','panic_results','roulette_choose_color','roulette_spinning','roulette_settlement')
  or coalesce((g->>'points')::integer,-1) not between 0 and 3 or coalesce((g->>'roll_seq')::bigint,-1)<0 then raise exception 'TROTTL_SPECIAL_INVALID_STATE'; end if;
 if g->>'trottl' is not null and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'trottl')::uuid
  and p.lifecycle_status='alive' and p.lives>0) then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_STATE'; end if;
 if g->>'phase'<>'awaiting_players' and not (g->>'phase' in ('drink_ack','minigame_active','minigame_results','minigame_distribution','panic_results','panic_active','roulette_spinning','roulette_settlement') and g->>'actor' is null)
  and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'actor')::uuid
  and p.seat_index=s.current_turn_seat and p.lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR_STATE'; end if;
 return null;
end; $$;
revoke all on function public.special_roulette_color(double precision),public.special_heal_life_locked(uuid,uuid),
 public.special_roulette_rewards(uuid,uuid),public.special_roulette_begin_locked(uuid),public.special_roulette_settle_locked(uuid),
 public.act_trottl_special_roulette(uuid,uuid,text,text,uuid),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.leave_trottl_special_session(uuid) from public,anon,authenticated;
grant execute on function public.act_trottl_special_roulette(uuid,uuid,text,text,uuid),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.leave_trottl_special_session(uuid) to authenticated;
commit;
