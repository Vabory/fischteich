begin;

-- Preserve every established Special rule behind one narrow follow-up gateway.
alter function public.act_trottl_special_game(uuid,text,bigint,uuid)
  rename to act_trottl_special_before_rescue_result_polish;
revoke all on function public.act_trottl_special_before_rescue_result_polish(uuid,text,bigint,uuid)
  from public,anon,authenticated;

create function public.act_trottl_special_game(
  p_session_id uuid,
  p_action text,
  p_roll_seq bigint,
  p_target uuid default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  s public.trottl_special_sessions;
  g jsonb;
  m jsonb;
  slot smallint;
  actor_id uuid;
  all_seen boolean;
  waived_seen jsonb;
  ready_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
  if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
  select * into s from public.trottl_special_sessions where id=p_session_id for update;
  g:=s.game_state;

  if s.status<>'playing' or p_roll_seq is distinct from coalesce((g->>'roll_seq')::bigint,0)
    then raise exception 'TROTTL_SPECIAL_STALE_ACTION'; end if;

  -- A successful critical rescue restores one life and consumes the turn.
  -- It never re-enters awaiting_roll, so normal six / roulette rules cannot run.
  if p_action='resolve' and g->>'phase'='rolling'
    and coalesce((g->>'rescue')::boolean,false)
    and (g->>'result')::integer=6 then
    if not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
    if clock_timestamp()<(g->>'deadline')::timestamptz then return p_session_id; end if;
    actor_id:=(g->>'actor')::uuid;
    perform public.special_restore_life_locked(p_session_id,actor_id);
    perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,p_roll_seq);
    return p_session_id;
  end if;

  -- Result ACKs stay in their established public result_seen object.  The last
  -- required ACK opens a short server-timed ready window before settlement.
  if p_action='results_ack' and g->>'phase' in ('minigame_results','panic_results') then
    if not exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id
      and p.user_id=auth.uid() and p.lifecycle_status in ('alive','critical'))
      then raise exception 'SPECIAL_INVALID_RESULT_ACK'; end if;
    m:=g->'minigame';
    if not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text)
      then raise exception 'SPECIAL_NOT_PARTICIPANT'; end if;
    if m->'result_seen' ? auth.uid()::text then raise exception 'SPECIAL_INVALID_RESULT_ACK'; end if;
    m:=m||jsonb_build_object('result_seen',(m->'result_seen')||jsonb_build_object(auth.uid()::text,true));
    if g->>'phase'='panic_results' then
      all_seen:=not exists(select 1 from public.trottl_special_players p where p.session_id=p_session_id
        and p.lifecycle_status in ('alive','critical') and not (m->'result_seen' ? p.user_id::text));
    else
      select coalesce(jsonb_object_agg(p->>'player_id',true),'{}'::jsonb) into waived_seen
      from jsonb_array_elements(m->'participants') p where not exists(
        select 1 from public.trottl_special_players active where active.session_id=p_session_id
          and active.user_id::text=p->>'player_id' and active.lifecycle_status in ('alive','critical'));
      m:=m||jsonb_build_object('result_seen',(m->'result_seen')||waived_seen);
      all_seen:=not exists(select 1 from jsonb_array_elements(m->'participants') p
        join public.trottl_special_players active on active.session_id=p_session_id and active.user_id::text=p->>'player_id'
        where active.lifecycle_status in ('alive','critical') and not (m->'result_seen' ? (p->>'player_id')));
    end if;
    ready_at:=clock_timestamp()+interval '700 milliseconds';
    update public.trottl_special_sessions set game_state=g||jsonb_build_object(
      'minigame',m,
      'all_results_ready',all_seen,
      'deadline',case when all_seen then to_jsonb(ready_at) else g->'deadline' end,
      'revision',coalesce((g->>'revision')::bigint,0)+1
    ) where id=p_session_id;
    return p_session_id;
  end if;

  if p_action='resolve' and g->>'phase' in ('minigame_results','panic_results')
    and coalesce((g->>'all_results_ready')::boolean,false) then
    if not public.is_trottl_special_viewer(p_session_id) then raise exception 'TROTTL_SPECIAL_NOT_MEMBER'; end if;
    if clock_timestamp()<(g->>'deadline')::timestamptz then return p_session_id; end if;
    if g->>'phase'='panic_results' then
      perform public.special_advance_locked(p_session_id,(g->>'actor_seat')::integer,p_roll_seq);
    else
      perform public.special_minigame_settle_locked(p_session_id);
    end if;
    return p_session_id;
  end if;

  return public.act_trottl_special_before_rescue_result_polish(p_session_id,p_action,p_roll_seq,p_target);
end; $$;

revoke all on function public.act_trottl_special_game(uuid,text,bigint,uuid) from public,anon;
grant execute on function public.act_trottl_special_game(uuid,text,bigint,uuid) to authenticated;

commit;
