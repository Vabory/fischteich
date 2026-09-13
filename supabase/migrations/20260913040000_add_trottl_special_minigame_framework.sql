begin;

-- Registry slots only: no game rules, names or production activation.
create function public.special_minigame_pick_slot()
returns text language sql volatile security definer set search_path='' as $$
 select 'special_minigame_'||lpad((floor(random()*10)::integer+1)::text,2,'0');
$$;

-- Pure ranking, deliberately independent of the subsequent drinks/future finale settlement.
create function public.special_minigame_rank(p_results jsonb,p_direction text)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare v_count integer; v_best numeric; v_worst numeric; v_rows jsonb; v_winners jsonb; v_losers jsonb;
begin
 if p_direction is null or p_direction not in ('higher_is_better','lower_is_better')
   or p_results is null or jsonb_typeof(p_results)<>'array' then raise exception 'SPECIAL_INVALID_RESULTS'; end if;
 v_count:=jsonb_array_length(p_results);
 if v_count<1 or v_count>8 or exists(select 1 from jsonb_array_elements(p_results) r
   where jsonb_typeof(r->'raw_value') is distinct from 'number' or jsonb_typeof(r->'player_id') is distinct from 'string'
   or length(r->>'player_id') not between 1 and 100 or length(coalesce(r->>'display_value',''))>100
   or (r ? 'display_value' and jsonb_typeof(r->'display_value')<>'string'))
   or (select count(distinct r->>'player_id') from jsonb_array_elements(p_results) r)<>v_count then
   raise exception 'SPECIAL_INVALID_RESULTS'; end if;
 select case when p_direction='higher_is_better' then max((r->>'raw_value')::numeric) else min((r->>'raw_value')::numeric) end,
   case when p_direction='higher_is_better' then min((r->>'raw_value')::numeric) else max((r->>'raw_value')::numeric) end
   into v_best,v_worst from jsonb_array_elements(p_results) r;
 with scored as (
   select r->>'player_id' as player_id,(r->>'raw_value')::numeric as raw_value,
     coalesce(r->>'display_value',r->>'raw_value') as display_value,
     rank() over(order by case when p_direction='higher_is_better' then -(r->>'raw_value')::numeric else (r->>'raw_value')::numeric end) as rank
   from jsonb_array_elements(p_results) r
 ) select jsonb_agg(jsonb_build_object('player_id',player_id,'raw_value',raw_value,'display_value',display_value,'rank',rank,
     'is_winner',v_best<>v_worst and raw_value=v_best,'is_loser',v_best<>v_worst and raw_value=v_worst) order by rank,player_id)
   into v_rows from scored;
 select coalesce(jsonb_agg(r->'player_id' order by r->>'player_id') filter(where (r->>'is_winner')::boolean),'[]'::jsonb),
   coalesce(jsonb_agg(r->'player_id' order by r->>'player_id') filter(where (r->>'is_loser')::boolean),'[]'::jsonb)
   into v_winners,v_losers from jsonb_array_elements(v_rows) r;
 return jsonb_build_object('results',v_rows,'winners',v_winners,'losers',v_losers,'draw',v_best=v_worst);
end; $$;

create function public.special_minigame_aggregate(p_auto jsonb,p_distributions jsonb)
returns jsonb language sql immutable security definer set search_path='' as $$
 with amounts as (
   select key,value::integer as amount from jsonb_each_text(p_auto)
   union all
   select d.key,d.value::integer from jsonb_each(p_distributions) w
     cross join lateral jsonb_each_text(w.value->'drinks') d
     where not coalesce((w.value->>'cancelled')::boolean,false)
 ), totals as (select key,sum(amount) as amount from amounts group by key)
 select coalesce(jsonb_object_agg(key,amount),'{}'::jsonb) from totals where amount>0;
$$;

-- Internal hook for future validated game controllers and owner-only SQL fixtures.
-- Normal Roll 4 still delegates to Phase 1's placeholder; no public start/finalize RPC.
create function public.special_minigame_begin_locked(p_id uuid,p_type text,p_direction text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; v_round uuid:=pg_catalog.gen_random_uuid(); v_members jsonb; v_slot smallint;
begin
 select room_slot into v_slot from public.trottl_special_sessions where id=p_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_id for update;
 if p_type is null or p_type !~ '^special_minigame_(0[1-9]|10)$' or p_direction is null
  or p_direction not in ('higher_is_better','lower_is_better') or s.status<>'playing'
  or s.game_state->>'phase' not in ('awaiting_roll','rolling','placeholder')
  or (s.game_state->>'phase'<>'awaiting_roll' and (coalesce((s.game_state->>'result')::integer,0)<>4 or coalesce((s.game_state->>'rescue')::boolean,false)))
  then raise exception 'SPECIAL_INVALID_MINIGAME_START'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('player_id',user_id,'display_name',display_name_snapshot) order by seat_index),'[]'::jsonb)
  into v_members from public.trottl_special_players where session_id=p_id and lifecycle_status in ('alive','critical');
 update public.trottl_special_sessions set game_state=(s.game_state-'deadline')||jsonb_build_object('phase','minigame_active',
  'roll_seq',(s.game_state->>'roll_seq')::bigint+1,'revision',(s.game_state->>'revision')::bigint+1,'drinks','{}'::jsonb,'acks','{}'::jsonb,
  'minigame',jsonb_build_object('minigame_id',v_round,'minigame_type',p_type,'ranking_direction',p_direction,
   'started_at',clock_timestamp(),'finished_at',null,'status','active','participants',v_members,'results','[]'::jsonb)) where id=p_id;
 return v_round;
end; $$;

create function public.special_minigame_finalize_locked(p_id uuid,p_round uuid,p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; m jsonb; ranked jsonb; v_auto jsonb; v_dist jsonb; v_slot smallint;
begin
 select room_slot into v_slot from public.trottl_special_sessions where id=p_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_id for update;
 m:=s.game_state->'minigame';
 if s.status<>'playing' or s.game_state->>'phase'<>'minigame_active'
  or (m->>'minigame_id')::uuid is distinct from p_round then raise exception 'SPECIAL_STALE_MINIGAME'; end if;
 ranked:=public.special_minigame_rank(p_results,m->>'ranking_direction');
 if jsonb_array_length(p_results)<>jsonb_array_length(m->'participants') or exists(
  select 1 from jsonb_array_elements(p_results) r where not exists(select 1 from jsonb_array_elements(m->'participants') p
   where p->>'player_id'=r->>'player_id')) then raise exception 'SPECIAL_PARTICIPANT_MISMATCH'; end if;
 ranked:=ranked||jsonb_build_object('results',(select jsonb_agg(r||jsonb_build_object('display_name',p->>'display_name') order by (r->>'rank')::integer,r->>'player_id')
   from jsonb_array_elements(ranked->'results') r join jsonb_array_elements(m->'participants') p on p->>'player_id'=r->>'player_id'));
 select coalesce(jsonb_object_agg(value,2),'{}'::jsonb) into v_auto from jsonb_array_elements_text(ranked->'losers');
 select coalesce(jsonb_object_agg(value,jsonb_build_object('drinks','{}'::jsonb,'confirmed',false,'cancelled',false)),'{}'::jsonb)
  into v_dist from jsonb_array_elements_text(ranked->'winners');
 m:=m||ranked||jsonb_build_object('finished_at',clock_timestamp(),'status','results','result_seen','{}'::jsonb,
  'automatic_drinks',v_auto,'distributions',v_dist,'settlement','drinks');
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('phase','minigame_results','minigame',m,
  'drinks',v_auto,'acks','{}'::jsonb,'revision',(s.game_state->>'revision')::bigint+1) where id=p_id;
end; $$;

-- Called after each confirmation or explicit leave, under the same lock.
create function public.special_minigame_settle_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; m jsonb; g jsonb; v_drinks jsonb;
begin
 select * into s from public.trottl_special_sessions where id=p_id for update;
 g:=s.game_state; m:=g->'minigame';
 if g->>'phase'='minigame_results' then
  if exists(select 1 from jsonb_array_elements(m->'participants') p
    where not (m->'result_seen' ? (p->>'player_id'))) then return; end if;
  if (m->>'draw')::boolean then
   perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint); return;
  end if;
  g:=g||jsonb_build_object('phase','minigame_distribution'); m:=m||jsonb_build_object('status','distribution');
 end if;
 if g->>'phase'='minigame_distribution' then
  v_drinks:=public.special_minigame_aggregate(m->'automatic_drinks',m->'distributions');
  -- Historical confirmed allocations remain intact; departed recipients receive no ACK.
  select coalesce(jsonb_object_agg(d.key,d.value),'{}'::jsonb) into v_drinks from jsonb_each(v_drinks) d
   where exists(select 1 from public.trottl_special_players p where p.session_id=p_id and p.user_id::text=d.key and p.lifecycle_status in ('alive','critical'));
  if not exists(select 1 from jsonb_each(m->'distributions') w
    where not (w.value->>'confirmed')::boolean and not (w.value->>'cancelled')::boolean) then
   if v_drinks='{}'::jsonb then
    perform public.special_advance_locked(p_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint); return;
   end if;
   g:=g||jsonb_build_object('phase','drink_ack','acks','{}'::jsonb); m:=m||jsonb_build_object('status','drink_ack');
  end if;
  g:=g||jsonb_build_object('drinks',v_drinks);
 end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

-- Preserve the exact existing Phase-1 gateway and delegate every non-minigame action.
alter function public.act_trottl_special_game(uuid,text,bigint,uuid) rename to act_trottl_special_phase_one;
revoke all on function public.act_trottl_special_phase_one(uuid,text,bigint,uuid) from public,anon,authenticated;
create function public.act_trottl_special_game(p_session_id uuid,p_action text,p_roll_seq bigint,p_target uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; g jsonb; m jsonb; w jsonb; v_user uuid:=auth.uid(); v_slot smallint; v_used integer;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 g:=s.game_state;
 if g->>'phase' not in ('minigame_active','minigame_results','minigame_distribution') then
  return public.act_trottl_special_phase_one(p_session_id,p_action,p_roll_seq,p_target);
 end if;
 if s.status<>'playing' or p_roll_seq is distinct from (g->>'roll_seq')::bigint or not exists(
  select 1 from public.trottl_special_players p where p.session_id=p_session_id and p.user_id=v_user and p.lifecycle_status in ('alive','critical'))
  then raise exception 'SPECIAL_INVALID_MINIGAME_ACTION'; end if;
 m:=g->'minigame';
 if p_action='results_ack' and g->>'phase'='minigame_results' then
  if not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=v_user::text)
   then raise exception 'SPECIAL_NOT_PARTICIPANT'; end if;
  m:=m||jsonb_build_object('result_seen',(m->'result_seen')||jsonb_build_object(v_user::text,true));
 elsif p_action in ('assign','reset','confirm') and g->>'phase'='minigame_distribution' then
  w:=m->'distributions'->v_user::text;
  if w is null or (w->>'confirmed')::boolean or (w->>'cancelled')::boolean then raise exception 'SPECIAL_NOT_PENDING_WINNER'; end if;
  select coalesce(sum(value::integer),0) into v_used from jsonb_each_text(w->'drinks');
  if p_action='assign' then
   if v_used>=2 or not exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id and p.user_id=p_target
    and p.lifecycle_status in ('alive','critical')) then raise exception 'SPECIAL_INVALID_DRINK_TARGET'; end if;
   w:=w||jsonb_build_object('drinks',(w->'drinks')||jsonb_build_object(p_target::text,coalesce((w->'drinks'->>p_target::text)::integer,0)+1));
  elsif p_action='reset' then w:=w||jsonb_build_object('drinks','{}'::jsonb);
  else
   if v_used<>2 then raise exception 'SPECIAL_INCOMPLETE_DISTRIBUTION'; end if;
   w:=w||jsonb_build_object('confirmed',true,'confirmed_at',clock_timestamp());
  end if;
  m:=m||jsonb_build_object('distributions',(m->'distributions')||jsonb_build_object(v_user::text,w));
 else raise exception 'SPECIAL_INVALID_MINIGAME_PHASE'; end if;
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('minigame',m,'revision',(g->>'revision')::bigint+1) where id=p_session_id;
 perform public.special_minigame_settle_locked(p_session_id);
 return p_session_id;
end; $$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_phase_one;
revoke all on function public.leave_trottl_special_phase_one(uuid) from public,anon,authenticated;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions; g jsonb; m jsonb; v_user uuid:=auth.uid(); v_slot smallint; v_members jsonb; v_dist jsonb; v_winner jsonb;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 select room_slot into v_slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,v_slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 g:=s.game_state;
 if g->'minigame' is null or g->>'phase' not in ('minigame_active','minigame_results','minigame_distribution','drink_ack') then
  return public.leave_trottl_special_phase_one(p_session_id);
 end if;
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=v_user) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
 delete from public.trottl_special_players where session_id=p_session_id and user_id=v_user;
 m:=g->'minigame';
 select coalesce(jsonb_agg(p),'[]'::jsonb) into v_members from jsonb_array_elements(m->'participants') p where p->>'player_id'<>v_user::text;
 m:=m||jsonb_build_object('participants',v_members);
 if g->>'phase'='minigame_active' and jsonb_array_length(v_members)<2 then
  m:=m||jsonb_build_object('draw',true,'results','[]'::jsonb,'winners','[]'::jsonb,'losers','[]'::jsonb,'finished_at',clock_timestamp(),
    'result_seen','{}'::jsonb,'automatic_drinks','{}'::jsonb,'distributions','{}'::jsonb,'status','results');
  g:=g||jsonb_build_object('phase','minigame_results','drinks','{}'::jsonb,'acks','{}'::jsonb);
 elsif g->>'phase' in ('minigame_results','minigame_distribution') then
  v_dist:=m->'distributions'; v_winner:=v_dist->v_user::text;
  if v_winner is not null and not (v_winner->>'confirmed')::boolean then
   v_dist:=v_dist||jsonb_build_object(v_user::text,v_winner||jsonb_build_object('drinks','{}'::jsonb,'cancelled',true));
  end if;
  -- Only unconfirmed allocations may change when a target departs.
  select coalesce(jsonb_object_agg(w.key,case when (w.value->>'confirmed')::boolean then w.value
    else w.value||jsonb_build_object('drinks',(w.value->'drinks')-v_user::text) end),'{}'::jsonb) into v_dist from jsonb_each(v_dist) w;
  m:=m||jsonb_build_object('distributions',v_dist,'automatic_drinks',(m->'automatic_drinks')-v_user::text);
 end if;
 if g->>'actor'=v_user::text then g:=g||jsonb_build_object('actor',null); end if;
 if g->>'trottl'=v_user::text then g:=g||jsonb_build_object('trottl',null,'points',0); end if;
 g:=g||jsonb_build_object('minigame',m,'drinks',coalesce(g->'drinks','{}'::jsonb)-v_user::text,
   'acks',coalesce(g->'acks','{}'::jsonb)-v_user::text,'revision',(g->>'revision')::bigint+1);
 update public.trottl_special_sessions set game_state=g where id=p_session_id;
 perform public.reconcile_trottl_special_members_locked(p_session_id);
 if g->>'actor' is null then update public.trottl_special_sessions set current_turn_seat=null where id=p_session_id; end if;
 if g->>'phase'='drink_ack' and not exists(select 1 from jsonb_each_text(g->'drinks') d where not (g->'acks' ? d.key)) then
  perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,(g->>'roll_seq')::bigint);
 elsif g->>'phase' in ('minigame_results','minigame_distribution') then perform public.special_minigame_settle_locked(p_session_id); end if;
 return true;
end; $$;

-- Extend only the phase vocabulary / null-actor settlement allowance; retain Phase-1 invariants.
create or replace function public.special_validate_game_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; s public.trottl_special_sessions;
begin
 if tg_table_name='trottl_special_sessions' then v_id:=new.id; else v_id:=coalesce(new.session_id,old.session_id); end if;
 select * into s from public.trottl_special_sessions where id=v_id;
 if not found or s.status<>'playing' then return null; end if;
 if s.game_state->>'phase' is null or s.game_state->>'phase' not in
  ('awaiting_roll','rescue_roll','rolling','distribution','choose_trottl','drink_ack','trottl_peak','placeholder','awaiting_players',
   'minigame_active','minigame_results','minigame_distribution')
  or coalesce((s.game_state->>'points')::integer,-1) not between 0 and 3
  or coalesce((s.game_state->>'roll_seq')::bigint,-1)<0 then raise exception 'TROTTL_SPECIAL_INVALID_STATE'; end if;
 if s.game_state->>'trottl' is not null and not exists(select 1 from public.trottl_special_players p
  where p.session_id=v_id and p.user_id=(s.game_state->>'trottl')::uuid and p.lifecycle_status='alive' and p.lives>0)
  then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_STATE'; end if;
 if s.game_state->>'phase'<>'awaiting_players' and not (s.game_state->>'phase' in
  ('drink_ack','minigame_active','minigame_results','minigame_distribution') and s.game_state->>'actor' is null)
  and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(s.game_state->>'actor')::uuid
    and p.seat_index=s.current_turn_seat and p.lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR_STATE'; end if;
 return null;
end; $$;

revoke all on function public.special_minigame_pick_slot(),public.special_minigame_rank(jsonb,text),public.special_minigame_aggregate(jsonb,jsonb),
 public.special_minigame_begin_locked(uuid,text,text),public.special_minigame_finalize_locked(uuid,uuid,jsonb),
 public.special_minigame_settle_locked(uuid),public.act_trottl_special_game(uuid,text,bigint,uuid),
 public.leave_trottl_special_session(uuid) from public,anon,authenticated;
grant execute on function public.act_trottl_special_game(uuid,text,bigint,uuid),public.leave_trottl_special_session(uuid) to authenticated;
-- Existing RLS, membership read paths, FULL replica identity and publication cover the nested round state.
commit;
