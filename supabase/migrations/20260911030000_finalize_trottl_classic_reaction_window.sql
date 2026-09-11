begin;

-- Every device receives one immutable reaction window derived from the
-- server-authored roll timeline. A resumed/hidden client can never create a
-- fresh personal deadline.
create or replace function public.set_trottl_classic_global_reaction_window()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_deadline timestamptz;
  v_players jsonb;
  v_seat text;
  v_player jsonb;
begin
  if new.roll_result is distinct from 5 or new.reaction_id is null then return new; end if;

  v_start := case
    when old.reaction_id is not distinct from new.reaction_id and old.reaction_start_at is not null
      then old.reaction_start_at
    else coalesce(new.reaction_start_at, new.roll_started_at + pg_catalog.make_interval(secs => 2.6))
  end;
  if v_start is null then
    v_start := pg_catalog.clock_timestamp();
  end if;
  v_deadline := v_start + pg_catalog.make_interval(secs => 10.0);
  v_players := coalesce(new.action_payload->'players', '{}'::jsonb);
  for v_seat, v_player in select entry.key, entry.value from pg_catalog.jsonb_each(v_players) as entry
  loop
    v_player := v_player || pg_catalog.jsonb_build_object(
      'started_at', v_start,
      'deadline_at', v_deadline
    );
    v_players := pg_catalog.jsonb_set(v_players, array[v_seat], v_player, false);
  end loop;

  new.reaction_start_at := v_start;
  new.reaction_fallback_at := v_deadline + pg_catalog.make_interval(secs => 1.0);
  new.action_payload := pg_catalog.jsonb_set(coalesce(new.action_payload, '{}'::jsonb), '{players}', v_players, true);
  return new;
end;
$$;

drop trigger if exists set_trottl_classic_global_reaction_window on public.trottl_classic_sessions;
create trigger set_trottl_classic_global_reaction_window
before update on public.trottl_classic_sessions
for each row execute function public.set_trottl_classic_global_reaction_window();

revoke all on function public.set_trottl_classic_global_reaction_window() from public, anon, authenticated;

create or replace function public.start_trottl_classic_personal_reaction(
  p_session_id uuid,
  p_roll_seq bigint,
  p_reaction_id uuid,
  p_client_started_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq
    or v_session.reaction_id is distinct from p_reaction_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if not exists (
    select 1 from public.trottl_classic_players as player
    where player.session_id = p_session_id and player.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED';
  end if;
  -- Compatibility for a briefly cached older client. The trigger has already
  -- assigned the same immutable global timestamps to every participant.
  return false;
end;
$$;

create or replace function public.refresh_trottl_classic_personal_reaction_locked(
  p_session_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.trottl_classic_sessions;
  v_players jsonb;
  v_seat text;
  v_player jsonb;
  v_deadline timestamptz;
  v_pending_count integer;
  v_timeout_count integer;
  v_penalty_seats jsonb;
  v_loser_seat smallint;
  v_changed boolean := false;
begin
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.action_phase not in ('reaction_pending', 'reaction_active') then return false; end if;

  v_players := coalesce(v_session.action_payload->'players', '{}'::jsonb);
  for v_seat, v_player in select entry.key, entry.value from pg_catalog.jsonb_each(v_players) as entry
  loop
    if v_player->>'status' = 'pending' then
      v_deadline := (v_player->>'deadline_at')::timestamptz;
      if v_deadline is not null and p_now >= v_deadline + pg_catalog.make_interval(secs => 1.0) then
        v_player := v_player || pg_catalog.jsonb_build_object('status', 'timed_out');
        v_players := pg_catalog.jsonb_set(v_players, array[v_seat], v_player, false);
        v_changed := true;
      end if;
    end if;
  end loop;

  select pg_catalog.count(*)::integer into v_pending_count
  from pg_catalog.jsonb_each(v_players) as entry where entry.value->>'status' = 'pending';
  if v_pending_count = 0 then
    select pg_catalog.count(*)::integer into v_timeout_count
    from pg_catalog.jsonb_each(v_players) as entry where entry.value->>'status' = 'timed_out';
    if v_timeout_count > 0 then
      select pg_catalog.jsonb_agg(entry.key::smallint order by entry.key::smallint) into v_penalty_seats
      from pg_catalog.jsonb_each(v_players) as entry where entry.value->>'status' = 'timed_out';
    else
      select entry.key::smallint into v_loser_seat
      from pg_catalog.jsonb_each(v_players) as entry
      where entry.value->>'status' = 'reacted'
      order by (entry.value->>'duration_ms')::integer desc, entry.key::smallint limit 1;
      v_penalty_seats := pg_catalog.jsonb_build_array(v_loser_seat);
    end if;
    update public.trottl_classic_sessions as session
    set action_phase = 'reaction_loser_lockout',
        action_payload = pg_catalog.jsonb_build_object(
          'kind', 'personal_reaction', 'players', v_players,
          'penalty_seats', coalesce(v_penalty_seats, '[]'::jsonb), 'penalty_acks', '[]'::jsonb
        ),
        reaction_loser_seat = case
          when pg_catalog.jsonb_array_length(coalesce(v_penalty_seats, '[]'::jsonb)) = 1
            then (v_penalty_seats->>0)::smallint else null end,
        reaction_lockout_until = p_now + pg_catalog.make_interval(secs => 0.8)
    where session.id = p_session_id;
    return true;
  end if;
  if v_changed then
    update public.trottl_classic_sessions as session
    set action_payload = pg_catalog.jsonb_set(session.action_payload, '{players}', v_players, true)
    where session.id = p_session_id;
  end if;
  return v_changed;
end;
$$;

create or replace function public.react_trottl_classic(
  p_session_id uuid,
  p_roll_seq bigint,
  p_reaction_id uuid,
  p_client_reacted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.trottl_classic_sessions;
  v_member_seat smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_player jsonb;
  v_started_at timestamptz;
  v_deadline_at timestamptz;
  v_duration_ms integer;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select session.* into v_session from public.trottl_classic_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.roll_seq <> p_roll_seq
    or v_session.reaction_id is distinct from p_reaction_id then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_STALE_ACTION';
  end if;
  if v_session.action_phase not in ('reaction_pending', 'reaction_active') then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_WRONG_ACTION_PHASE';
  end if;
  select player.seat_index into v_member_seat from public.trottl_classic_players as player
  where player.session_id = p_session_id and player.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'TROTTL_CLASSIC_MEMBERSHIP_REQUIRED'; end if;
  v_player := v_session.action_payload->'players'->v_member_seat::text;
  if v_player->>'status' <> 'pending' then return false; end if;
  v_started_at := (v_player->>'started_at')::timestamptz;
  v_deadline_at := (v_player->>'deadline_at')::timestamptz;
  if v_started_at is null or v_deadline_at is null then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_REACTION_NOT_STARTED';
  end if;
  if p_client_reacted_at is null
    or p_client_reacted_at < v_started_at
    or p_client_reacted_at > v_deadline_at
    or p_client_reacted_at > v_now + pg_catalog.make_interval(secs => 0.25)
    or p_client_reacted_at < v_now - pg_catalog.make_interval(secs => 12.0)
    or v_now > v_deadline_at + pg_catalog.make_interval(secs => 1.0) then
    raise exception using errcode = '22023', message = 'TROTTL_CLASSIC_REACTION_TIME_IMPLAUSIBLE';
  end if;
  v_duration_ms := pg_catalog.floor(extract(epoch from (p_client_reacted_at - v_started_at)) * 1000)::integer;
  v_player := v_player || pg_catalog.jsonb_build_object(
    'status', 'reacted', 'reacted_at', p_client_reacted_at, 'duration_ms', v_duration_ms
  );
  update public.trottl_classic_sessions as session
  set action_payload = pg_catalog.jsonb_set(
    session.action_payload, array['players', v_member_seat::text], v_player, false
  ) where session.id = p_session_id;
  perform public.refresh_trottl_classic_personal_reaction_locked(p_session_id, v_now);
  return true;
end;
$$;

commit;
