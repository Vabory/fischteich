begin;

create table public.trottl_classic_sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'classic',
  room_slot smallint not null,
  status text not null default 'lobby',
  host_user_id uuid not null references public.app_profiles (user_id) on delete restrict,
  player_count smallint not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint trottl_classic_sessions_mode_valid check (mode = 'classic'),
  constraint trottl_classic_sessions_room_slot_valid check (room_slot in (1, 2)),
  constraint trottl_classic_sessions_status_valid check (status in ('lobby', 'playing', 'finished')),
  constraint trottl_classic_sessions_player_count_valid check (player_count between 0 and 8),
  constraint trottl_classic_sessions_timestamps_valid check (
    (status = 'lobby' and started_at is null and finished_at is null)
    or (status = 'playing' and started_at is not null and finished_at is null)
    or (status = 'finished' and finished_at is not null)
  )
);

-- A slot is permanent, but only one lobby/game may occupy it at a time.
-- Finished sessions remain historical rows and never block a fresh session.
create unique index trottl_classic_one_active_session_per_slot_idx
  on public.trottl_classic_sessions (room_slot)
  where status in ('lobby', 'playing');

create table public.trottl_classic_players (
  session_id uuid not null references public.trottl_classic_sessions (id) on delete cascade,
  user_id uuid not null references public.app_profiles (user_id) on delete restrict,
  display_name_snapshot text not null,
  seat_index smallint not null,
  joined_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (session_id, user_id),
  constraint trottl_classic_players_seat_unique
    unique (session_id, seat_index) deferrable initially deferred,
  constraint trottl_classic_players_name_valid check (
    display_name_snapshot = pg_catalog.btrim(display_name_snapshot)
    and pg_catalog.char_length(display_name_snapshot) between 1 and 24
  ),
  constraint trottl_classic_players_seat_valid check (seat_index between 0 and 7)
);

create index trottl_classic_players_user_active_lookup_idx
  on public.trottl_classic_players (user_id, session_id);

alter table public.trottl_classic_sessions enable row level security;
alter table public.trottl_classic_players enable row level security;

create function public.is_trottl_classic_member(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
      and player.user_id = (select auth.uid())
  );
$$;

-- Session rows contain only room/status/count metadata. Keeping finished rows
-- readable lets Realtime deliver the active -> finished transition so every
-- room-selection screen immediately releases the permanent slot. Player names
-- remain protected by the membership-only policy below.
create policy trottl_classic_sessions_read_metadata
on public.trottl_classic_sessions
for select
to authenticated
using (true);

create policy trottl_classic_players_read_as_member
on public.trottl_classic_players
for select
to authenticated
using (public.is_trottl_classic_member(session_id));

revoke all on table public.trottl_classic_sessions from public, anon, authenticated;
revoke all on table public.trottl_classic_players from public, anon, authenticated;
grant select on table public.trottl_classic_sessions to authenticated;
grant select on table public.trottl_classic_players to authenticated;

create function public.get_trottl_classic_rooms()
returns table (
  room_slot smallint,
  session_id uuid,
  session_status text,
  player_count smallint,
  is_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    slot.room_slot,
    session.id,
    session.status,
    coalesce(session.player_count, 0)::smallint,
    coalesce(
      exists (
        select 1
        from public.trottl_classic_players as player
        where player.session_id = session.id
          and player.user_id = (select auth.uid())
      ),
      false
    )
  from (values (1::smallint), (2::smallint)) as slot(room_slot)
  left join public.trottl_classic_sessions as session
    on session.room_slot = slot.room_slot
   and session.status in ('lobby', 'playing')
  where (select auth.uid()) is not null
  order by slot.room_slot;
$$;

create function public.join_trottl_classic_room(p_room_slot smallint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_session public.trottl_classic_sessions;
  v_existing_session_id uuid;
  v_existing_room_slot smallint;
  v_seat_index smallint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_room_slot is null or p_room_slot not in (1, 2) then
    raise exception using errcode = '22023', message = 'Room slot must be 1 or 2';
  end if;

  select profile.display_name
  into v_display_name
  from public.app_profiles as profile
  where profile.user_id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'App profile required';
  end if;

  -- Serialize joins for the same authenticated identity before taking the room
  -- lock, so two concurrent requests cannot place one user in both slots.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 337733)
  );

  select session.id, session.room_slot
  into v_existing_session_id, v_existing_room_slot
  from public.trottl_classic_players as player
  join public.trottl_classic_sessions as session on session.id = player.session_id
  where player.user_id = v_user_id
    and session.status in ('lobby', 'playing')
  order by session.created_at desc
  limit 1;
  if found then
    if v_existing_room_slot = p_room_slot then
      return v_existing_session_id;
    end if;
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ALREADY_IN_OTHER_ROOM';
  end if;

  -- All lifecycle mutations for one slot use the same transaction lock. This
  -- serializes session creation, capacity checks and seat assignment.
  perform pg_catalog.pg_advisory_xact_lock(337733, p_room_slot::integer);

  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.room_slot = p_room_slot
    and session.status in ('lobby', 'playing')
  order by session.created_at desc
  limit 1
  for update;

  if found then
    if exists (
      select 1
      from public.trottl_classic_players as player
      where player.session_id = v_session.id
        and player.user_id = v_user_id
    ) then
      return v_session.id;
    end if;
    if v_session.status <> 'lobby' then
      raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_GAME_ALREADY_STARTED';
    end if;
    if v_session.player_count >= 8 then
      raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL';
    end if;
  else
    insert into public.trottl_classic_sessions (room_slot, host_user_id)
    values (p_room_slot, v_user_id)
    returning * into v_session;
  end if;

  select coalesce(pg_catalog.max(player.seat_index), -1) + 1
  into v_seat_index
  from public.trottl_classic_players as player
  where player.session_id = v_session.id;

  if v_seat_index > 7 then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ROOM_FULL';
  end if;

  insert into public.trottl_classic_players (
    session_id,
    user_id,
    display_name_snapshot,
    seat_index
  ) values (
    v_session.id,
    v_user_id,
    v_display_name,
    v_seat_index
  );

  update public.trottl_classic_sessions as session
  set player_count = session.player_count + 1
  where session.id = v_session.id;

  return v_session.id;
end;
$$;

create function public.leave_trottl_classic_session(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_slot smallint;
  v_session public.trottl_classic_sessions;
  v_departing_seat smallint;
  v_remaining_count smallint;
  v_next_host uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 337733)
  );

  select session.room_slot
  into v_room_slot
  from public.trottl_classic_sessions as session
  where session.id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);

  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;

  select player.seat_index
  into v_departing_seat
  from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = v_user_id;
  if not found then
    return v_session.status;
  end if;

  delete from public.trottl_classic_players as player
  where player.session_id = p_session_id
    and player.user_id = v_user_id;

  select pg_catalog.count(*)::smallint
  into v_remaining_count
  from public.trottl_classic_players as player
  where player.session_id = p_session_id;

  if v_remaining_count = 0 then
    update public.trottl_classic_sessions as session
    set status = 'finished', player_count = 0, finished_at = pg_catalog.clock_timestamp()
    where session.id = p_session_id;
    return 'finished';
  end if;

  -- Lobby seats are compacted after an explicit leave so the next join remains
  -- ordered. Playing seats never move; their logical order is already frozen.
  if v_session.status = 'lobby' then
    update public.trottl_classic_players as player
    set seat_index = player.seat_index - 1
    where player.session_id = p_session_id
      and player.seat_index > v_departing_seat;
  end if;

  if v_session.host_user_id = v_user_id then
    select player.user_id
    into v_next_host
    from public.trottl_classic_players as player
    where player.session_id = p_session_id
    order by player.seat_index
    limit 1;
  else
    v_next_host := v_session.host_user_id;
  end if;

  update public.trottl_classic_sessions as session
  set player_count = v_remaining_count,
      host_user_id = v_next_host
  where session.id = p_session_id;

  return v_session.status;
end;
$$;

create function public.start_trottl_classic_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_slot smallint;
  v_session public.trottl_classic_sessions;
  v_member_count smallint;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select session.room_slot
  into v_room_slot
  from public.trottl_classic_sessions as session
  where session.id = p_session_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_SESSION_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(337733, v_room_slot::integer);
  select session.*
  into v_session
  from public.trottl_classic_sessions as session
  where session.id = p_session_id
  for update;

  if v_session.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_NOT_IN_LOBBY';
  end if;
  if v_session.host_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'Only the host may start';
  end if;

  select pg_catalog.count(*)::smallint
  into v_member_count
  from public.trottl_classic_players as player
  where player.session_id = p_session_id;
  if v_member_count < 3 or v_member_count > 8 then
    raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_INVALID_PLAYER_COUNT';
  end if;

  update public.trottl_classic_sessions as session
  set status = 'playing',
      player_count = v_member_count,
      started_at = pg_catalog.clock_timestamp()
  where session.id = p_session_id;

  return p_session_id;
end;
$$;

revoke all on function public.is_trottl_classic_member(uuid) from public, anon, authenticated;
revoke all on function public.get_trottl_classic_rooms() from public, anon, authenticated;
revoke all on function public.join_trottl_classic_room(smallint) from public, anon, authenticated;
revoke all on function public.leave_trottl_classic_session(uuid) from public, anon, authenticated;
revoke all on function public.start_trottl_classic_session(uuid) from public, anon, authenticated;
grant execute on function public.is_trottl_classic_member(uuid) to authenticated;
grant execute on function public.get_trottl_classic_rooms() to authenticated;
grant execute on function public.join_trottl_classic_room(smallint) to authenticated;
grant execute on function public.leave_trottl_classic_session(uuid) to authenticated;
grant execute on function public.start_trottl_classic_session(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trottl_classic_sessions'
  ) then
    alter publication supabase_realtime add table public.trottl_classic_sessions;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trottl_classic_players'
  ) then
    alter publication supabase_realtime add table public.trottl_classic_players;
  end if;
end;
$$;

alter table public.trottl_classic_sessions replica identity full;
alter table public.trottl_classic_players replica identity full;

commit;
