begin;

-- The finale is intentionally stored in the authoritative session state.  The
-- existing nine minigame controllers continue to own their game-specific runs;
-- this migration only adds the two-player lifecycle and life settlement.

create or replace function public.get_trottl_special_memberships()
returns table(session_id uuid,membership_role text,room_slot smallint)
language sql stable security definer set search_path='' as $$
 select p.session_id,'player'::text,s.room_slot from public.trottl_special_players p
 join public.trottl_special_sessions s on s.id=p.session_id where p.user_id=auth.uid()
 and p.lifecycle_status<>'left' and (s.status in ('lobby','playing')
   or (s.status='finished' and s.game_state->>'phase'='finale_winner')) union all
 select v.session_id,'spectator'::text,s.room_slot from public.trottl_special_spectators v
 join public.trottl_special_sessions s on s.id=v.session_id where v.user_id=auth.uid() and s.status='playing';
$$;

create function public.special_finale_finish_locked(p_id uuid,p_winner uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;members jsonb;
begin
 select * into s from public.trottl_special_sessions where id=p_id for update;
 if not found or s.status='finished' then return;end if;
 g:=s.game_state;f:=coalesce(g->'finale','{}'::jsonb);
 if f->'finalists' is null then
  select coalesce(jsonb_agg(jsonb_build_object('player_id',user_id,'seat_index',seat_index,'display_name',display_name_snapshot) order by seat_index),'[]'::jsonb)
   into members from public.trottl_special_players where session_id=p_id and user_id=p_winner;
  f:=f||jsonb_build_object('finalists',members);
 end if;
 f:=f||jsonb_build_object(
  'active',true,'phase','winner','winner_id',p_winner,'winner_reason',p_reason,
  'finished_at',clock_timestamp(),'ready','{}'::jsonb);
 update public.trottl_special_sessions set status='finished',finished_at=clock_timestamp(),current_turn_seat=null,
  game_state=(g-'actor'-'trottl'-'points'-'deadline'-'roulette'-'drinks'-'acks')
   ||jsonb_build_object('phase','finale_winner','actor',null,'trottl',null,'points',0,
    'drinks','{}'::jsonb,'acks','{}'::jsonb,'finale',f,
    'revision',coalesce((g->>'revision')::bigint,0)+1)
 where id=p_id;
end;$$;

create function public.maybe_enter_trottl_special_finale_locked(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;members jsonb;v_count integer;v_winner uuid;v_left uuid;
begin
 select * into s from public.trottl_special_sessions where id=p_id for update;
 if not found or s.status<>'playing' or coalesce((s.game_state->'finale'->>'active')::boolean,false) then return false;end if;
 select count(*) into v_count from public.trottl_special_players
  where session_id=p_id and lifecycle_status in ('alive','critical');
 if v_count>2 then return false;end if;

 -- A pending zero-life rescue cannot cross the finale boundary.  This is the
 -- only conversion performed here; surviving lives are kept verbatim.
 update public.trottl_special_players set lifecycle_status='eliminated'
  where session_id=p_id and lifecycle_status='critical' and lives=0;
 select count(*) into v_count from public.trottl_special_players
  where session_id=p_id and lifecycle_status='alive' and lives>0;
 if v_count=1 then
  select user_id into v_winner from public.trottl_special_players
   where session_id=p_id and lifecycle_status='alive' and lives>0 order by seat_index limit 1;
  perform public.special_finale_finish_locked(p_id,v_winner,'normal_finale_win');return true;
 elsif v_count=0 then
  perform public.special_finale_finish_locked(p_id,null,'no_finalists');return true;
 end if;

 select coalesce(jsonb_agg(jsonb_build_object('player_id',user_id,'seat_index',seat_index,
  'display_name',display_name_snapshot) order by seat_index),'[]'::jsonb)
 into members from public.trottl_special_players
 where session_id=p_id and lifecycle_status='alive' and lives>0;
 select user_id into v_left from public.trottl_special_players
  where session_id=p_id and lifecycle_status='alive' and lives>0 order by seat_index limit 1;
 g:=s.game_state;
 f:=jsonb_build_object('active',true,'phase','transition','finalists',members,
  'ready','{}'::jsonb,'round_number',0,'entered_at',clock_timestamp(),
  'transition_ends_at',clock_timestamp()+interval '1.4 seconds','current_round_id',null,
  'result',null,'winner_id',null,'winner_reason',null,'finished_at',null);
 update public.trottl_special_sessions set host_user_id=v_left,current_turn_seat=null,
  game_state=(g-'actor'-'trottl'-'points'-'deadline'-'roulette'-'minigame'-'drinks'-'acks'-'distributions')
   ||jsonb_build_object('phase','finale_transition','actor',null,'trottl',null,'points',0,
     'drinks','{}'::jsonb,'acks','{}'::jsonb,'finale',f,
     'revision',coalesce((g->>'revision')::bigint,0)+1)
 where id=p_id;
 return true;
end;$$;

create function public.special_finale_auto_enter_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 v_id:=case when tg_table_name='trottl_special_sessions' then coalesce(new.id,old.id)
  else coalesce(new.session_id,old.session_id) end;
 perform public.maybe_enter_trottl_special_finale_locked(v_id);return null;
end;$$;

create constraint trigger special_finale_auto_enter_session after insert or update on public.trottl_special_sessions
 deferrable initially deferred for each row execute function public.special_finale_auto_enter_trigger();
create constraint trigger special_finale_auto_enter_player after insert or update or delete on public.trottl_special_players
 deferrable initially deferred for each row execute function public.special_finale_auto_enter_trigger();

create function public.special_finale_sync_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;loser uuid;winner uuid;
begin
 select * into s from public.trottl_special_sessions where id=p_id for update;
 if not found or s.status<>'playing' then return;end if;
 g:=s.game_state;f:=g->'finale';
 if not coalesce((f->>'active')::boolean,false) then return;end if;
 if f->>'phase'='transition' and clock_timestamp()>=(f->>'transition_ends_at')::timestamptz then
  f:=f||jsonb_build_object('phase','ready','ready','{}'::jsonb);
  update public.trottl_special_sessions set game_state=g||jsonb_build_object('phase','finale_ready','finale',f,
   'revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_id;
 elsif f->>'phase'='round_result' and clock_timestamp()>=(f->>'result_ends_at')::timestamptz then
  loser:=nullif(f->'result'->>'loser_id','')::uuid;
  if loser is not null and exists(select 1 from public.trottl_special_players where session_id=p_id and user_id=loser and lifecycle_status='eliminated') then
   winner:=nullif(f->'result'->>'winner_id','')::uuid;
   perform public.special_finale_finish_locked(p_id,winner,'normal_finale_win');
  else
   f:=f||jsonb_build_object('phase','ready','ready','{}'::jsonb,'current_round_id',null);
   update public.trottl_special_sessions set game_state=(g-'minigame')||jsonb_build_object('phase','finale_ready','finale',f,
    'revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_id;
  end if;
 end if;
end;$$;

create function public.sync_trottl_special_finale(p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare slot smallint;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 if not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 perform public.special_finale_sync_locked(p_session_id);return p_session_id;
end;$$;

create function public.set_trottl_special_finale_ready(p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;slot smallint;v_user uuid:=auth.uid();round_id uuid;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 perform public.special_finale_sync_locked(p_session_id);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;f:=g->'finale';
 if s.status<>'playing' or f->>'phase'<>'ready' or not exists(select 1 from jsonb_array_elements(f->'finalists') p where p->>'player_id'=v_user::text)
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=v_user and lifecycle_status='alive' and lives>0)
  then raise exception 'SPECIAL_FINALE_READY_NOT_ALLOWED';end if;
 if coalesce((f->'ready'->>v_user::text)::boolean,false) then return p_session_id;end if;
 f:=f||jsonb_build_object('ready',(f->'ready')||jsonb_build_object(v_user::text,true));
 update public.trottl_special_sessions set game_state=g||jsonb_build_object('finale',f,
  'revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_session_id;
 if (select count(*) from jsonb_array_elements(f->'finalists') p where coalesce((f->'ready'->>(p->>'player_id'))::boolean,false))=2 then
  -- Existing begin controllers accept awaiting_roll and build their usual
  -- private/public run state.  No dice action is exposed to the client.
  update public.trottl_special_sessions set game_state=(game_state-'deadline')||jsonb_build_object('phase','awaiting_roll','actor',null) where id=p_session_id;
  perform public.special_number_hunt_begin_locked(p_session_id);
  select game_state into g from public.trottl_special_sessions where id=p_session_id for update;
  round_id:=(g->'minigame'->>'minigame_id')::uuid;
  f:=(g->'finale')||jsonb_build_object('phase','minigame','current_round_id',round_id,
    'round_number',coalesce((g->'finale'->>'round_number')::integer,0)+1);
  update public.trottl_special_sessions set game_state=g||jsonb_build_object('finale',f,
   'revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_session_id;
 end if;
 return p_session_id;
end;$$;

-- Temporary host-only shortcut used by the existing TEST panel.  It keeps the
-- first two currently alive seats and lets the same auto-entry hook do the work.
create function public.start_trottl_special_finale_test(p_session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;slot smallint;kept uuid[];
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND';end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;
 if s.status<>'playing' or s.host_user_id<>auth.uid() or coalesce((s.game_state->'finale'->>'active')::boolean,false)
  then raise exception 'SPECIAL_DEBUG_HOST_REQUIRED';end if;
 select array_agg(user_id order by seat_index) into kept from (select user_id,seat_index from public.trottl_special_players
  where session_id=p_session_id and lifecycle_status='alive' and lives>0 order by seat_index limit 2) x;
 if coalesce(array_length(kept,1),0)<>2 then raise exception 'SPECIAL_DEBUG_FINALE_NEEDS_TWO';end if;
 update public.trottl_special_players set lives=0,lifecycle_status='eliminated',critical_used=true
  where session_id=p_session_id and lifecycle_status in ('alive','critical') and not (user_id=any(kept));
 perform public.maybe_enter_trottl_special_finale_locked(p_session_id);return p_session_id;
end;$$;

create function public.special_finalize_trottl_special_finale_round_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;m jsonb;a jsonb;b jsonb;ra jsonb;rb jsonb;
 aid uuid;bid uuid;winner uuid;loser uuid;draw boolean:=false;direction text;av numeric;bv numeric;
begin
 select * into s from public.trottl_special_sessions where id=p_id for update;g:=s.game_state;f:=g->'finale';m:=g->'minigame';
 if s.status<>'playing' or f->>'phase'<>'minigame' or g->>'phase'<>'minigame_results'
  or f->>'current_round_id' is distinct from m->>'minigame_id' then return;end if;
 a:=f->'finalists'->0;b:=f->'finalists'->1;aid:=(a->>'player_id')::uuid;bid:=(b->>'player_id')::uuid;
 select value into ra from jsonb_array_elements(m->'results') where value->>'player_id'=aid::text;
 select value into rb from jsonb_array_elements(m->'results') where value->>'player_id'=bid::text;
 if ra is null or rb is null then raise exception 'SPECIAL_FINALE_RESULT_MISSING';end if;
 direction:=m->>'ranking_direction';
 if m->>'minigame_type'='special_minigame_03' then
  if ra->>'status'<>'completed' and rb->>'status'<>'completed' then draw:=true;
  elsif ra->>'status'='completed' and rb->>'status'<>'completed' then winner:=aid;loser:=bid;
  elsif rb->>'status'='completed' and ra->>'status'<>'completed' then winner:=bid;loser:=aid;
  else av:=(ra->>'reaction_ms')::numeric;bv:=(rb->>'reaction_ms')::numeric;end if;
 else av:=(ra->>'raw_value')::numeric;bv:=(rb->>'raw_value')::numeric;end if;
 if winner is null and not draw then
  if av=bv then draw:=true;
  elsif (direction='higher_is_better' and av>bv) or (direction='lower_is_better' and av<bv) then winner:=aid;loser:=bid;
  else winner:=bid;loser:=aid;end if;
 end if;
 if loser is not null then
  update public.trottl_special_players set lives=greatest(lives-1,0),
   lifecycle_status=case when lives<=1 then 'eliminated' else 'alive' end
   where session_id=p_id and user_id=loser and lifecycle_status='alive';
 end if;
 m:=m||jsonb_build_object('settlement','finale','automatic_drinks','{}'::jsonb,'distributions','{}'::jsonb);
 f:=f||jsonb_build_object('phase','round_result','ready','{}'::jsonb,'result_ends_at',clock_timestamp()+interval '2 seconds',
  'result',jsonb_build_object('round_id',m->>'minigame_id','minigame_type',m->>'minigame_type','title',m->>'title',
   'draw',draw,'winner_id',winner,'loser_id',loser,'left_display_value',ra->>'display_value',
   'right_display_value',rb->>'display_value','finished_at',clock_timestamp()));
 update public.trottl_special_sessions set game_state=(g-'drinks'-'acks')||jsonb_build_object('phase','finale_round_result',
  'drinks','{}'::jsonb,'acks','{}'::jsonb,'minigame',m,'finale',f,
  'revision',coalesce((g->>'revision')::bigint,0)+1) where id=p_id;
end;$$;

alter function public.special_minigame_finalize_locked(uuid,uuid,jsonb) rename to special_minigame_finalize_before_finale_locked;
create function public.special_minigame_finalize_locked(p_id uuid,p_round uuid,p_results jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.special_minigame_finalize_before_finale_locked(p_id,p_round,p_results);
 perform public.special_finalize_trottl_special_finale_round_locked(p_id);
end;$$;

alter function public.special_reaction_finalize_locked(uuid) rename to special_reaction_finalize_before_finale_locked;
create function public.special_reaction_finalize_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.special_reaction_finalize_before_finale_locked(p_id);
 perform public.special_finalize_trottl_special_finale_round_locked(p_id);
end;$$;

alter function public.leave_trottl_special_session(uuid) rename to leave_trottl_special_before_finale;
create function public.leave_trottl_special_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;g jsonb;f jsonb;slot smallint;v_user uuid:=auth.uid();opponent uuid;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then return true;end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;g:=s.game_state;f:=g->'finale';
 if not coalesce((f->>'active')::boolean,false) then return public.leave_trottl_special_before_finale(p_session_id);end if;
 if not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=v_user and lifecycle_status<>'left') then
  raise exception 'TROTTL_SPECIAL_NOT_MEMBER';end if;
 if s.status='playing' and exists(select 1 from jsonb_array_elements(f->'finalists') p where p->>'player_id'=v_user::text) then
  select (p->>'player_id')::uuid into opponent from jsonb_array_elements(f->'finalists') p
   where p->>'player_id'<>v_user::text and exists(select 1 from public.trottl_special_players x
    where x.session_id=p_session_id and x.user_id=(p->>'player_id')::uuid and x.lifecycle_status='alive') limit 1;
  update public.trottl_special_players set lifecycle_status='left' where session_id=p_session_id and user_id=v_user;
  update public.trottl_special_sessions set player_count=(select count(*) from public.trottl_special_players where session_id=p_session_id and lifecycle_status<>'left') where id=p_session_id;
  perform public.special_finale_finish_locked(p_session_id,opponent,'opponent_left');
 else
  update public.trottl_special_players set lifecycle_status='left' where session_id=p_session_id and user_id=v_user;
  update public.trottl_special_sessions set player_count=(select count(*) from public.trottl_special_players where session_id=p_session_id and lifecycle_status<>'left') where id=p_session_id;
 end if;
 return true;
end;$$;

create or replace function public.special_validate_game_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;s public.trottl_special_sessions;g jsonb;
begin
 if tg_table_name='trottl_special_sessions' then v_id:=new.id;else v_id:=coalesce(new.session_id,old.session_id);end if;
 select * into s from public.trottl_special_sessions where id=v_id;
 if not found or s.status<>'playing' then return null;end if;g:=s.game_state;
 if g->>'phase' is null or g->>'phase' not in ('awaiting_roll','rescue_roll','rolling','distribution','choose_trottl','drink_ack','trottl_peak','placeholder','awaiting_players',
  'minigame_active','minigame_results','minigame_distribution','panic_active','panic_results','roulette_choose_color','roulette_spinning','roulette_settlement',
  'finale_transition','finale_ready','finale_round_result')
  or coalesce((g->>'points')::integer,-1) not between 0 and 3 or coalesce((g->>'roll_seq')::bigint,-1)<0 then raise exception 'TROTTL_SPECIAL_INVALID_STATE';end if;
 if coalesce((g->'finale'->>'active')::boolean,false) then
  if jsonb_array_length(g->'finale'->'finalists')<>2 or g->>'trottl' is not null then raise exception 'TROTTL_SPECIAL_INVALID_FINALE_STATE';end if;
  return null;
 end if;
 if g->>'trottl' is not null and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'trottl')::uuid
  and p.lifecycle_status='alive' and p.lives>0) then raise exception 'TROTTL_SPECIAL_INVALID_TROTTL_STATE';end if;
 if g->>'phase'<>'awaiting_players' and not (g->>'phase' in ('drink_ack','minigame_active','minigame_results','minigame_distribution','panic_results','panic_active','roulette_spinning','roulette_settlement') and g->>'actor' is null)
  and not exists(select 1 from public.trottl_special_players p where p.session_id=v_id and p.user_id=(g->>'actor')::uuid
  and p.seat_index=s.current_turn_seat and p.lifecycle_status in ('alive','critical')) then raise exception 'TROTTL_SPECIAL_INVALID_ACTOR_STATE';end if;
 return null;
end;$$;

revoke all on function public.special_finale_finish_locked(uuid,uuid,text),public.maybe_enter_trottl_special_finale_locked(uuid),
 public.special_finale_auto_enter_trigger(),public.special_finale_sync_locked(uuid),public.special_finalize_trottl_special_finale_round_locked(uuid),
 public.special_minigame_finalize_before_finale_locked(uuid,uuid,jsonb),public.special_minigame_finalize_locked(uuid,uuid,jsonb),
 public.special_reaction_finalize_before_finale_locked(uuid),public.special_reaction_finalize_locked(uuid),
 public.leave_trottl_special_before_finale(uuid),public.leave_trottl_special_session(uuid),
 public.sync_trottl_special_finale(uuid),public.set_trottl_special_finale_ready(uuid),public.start_trottl_special_finale_test(uuid) from public,anon,authenticated;
grant execute on function public.leave_trottl_special_session(uuid),public.sync_trottl_special_finale(uuid),
 public.set_trottl_special_finale_ready(uuid),public.start_trottl_special_finale_test(uuid),public.get_trottl_special_memberships() to authenticated;

commit;
