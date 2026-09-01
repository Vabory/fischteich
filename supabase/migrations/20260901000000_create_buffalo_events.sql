begin;

create table public.buffalo_events (
  id uuid primary key default gen_random_uuid(),
  caller_device_id uuid not null,
  caller_display_name text not null,
  target_kind text not null,
  target_friend_name text,
  target_display_name text not null,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint buffalo_events_caller_display_name_valid check (
    caller_display_name = pg_catalog.btrim(caller_display_name)
    and pg_catalog.char_length(caller_display_name) between 1 and 24
  ),
  constraint buffalo_events_target_kind_valid check (
    target_kind in ('friend', 'other')
  ),
  constraint buffalo_events_target_display_name_valid check (
    target_display_name = pg_catalog.btrim(target_display_name)
    and pg_catalog.char_length(target_display_name) between 1 and 48
  ),
  constraint buffalo_events_target_friend_valid check (
    (
      target_kind = 'friend'
      and target_friend_name is not null
      and target_friend_name = pg_catalog.btrim(target_friend_name)
      and pg_catalog.char_length(target_friend_name) between 1 and 48
      and target_display_name = target_friend_name
    )
    or (
      target_kind = 'other'
      and target_friend_name is null
    )
  ),
  constraint buffalo_events_exact_duration check (
    ends_at = started_at + interval '3 minutes'
  )
);

create index buffalo_events_ends_at_idx
  on public.buffalo_events (ends_at desc);

alter table public.buffalo_events enable row level security;

-- Browser clients may see only rows that are active at statement time. This is
-- also the SELECT policy Realtime needs in order to deliver new active rows.
create policy buffalo_events_active_read
on public.buffalo_events
for select
to anon, authenticated
using (ends_at > pg_catalog.statement_timestamp());

-- No browser role receives INSERT, UPDATE, or DELETE. All writes go through the
-- validated SECURITY DEFINER RPC below, so clients cannot choose timestamps.
revoke all on table public.buffalo_events from public, anon, authenticated;
grant select on table public.buffalo_events to anon, authenticated;

create function public.get_active_buffalo_event()
returns table (
  id uuid,
  caller_device_id uuid,
  caller_display_name text,
  target_kind text,
  target_friend_name text,
  target_display_name text,
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  return query
  select
    event.id,
    event.caller_device_id,
    event.caller_display_name,
    event.target_kind,
    event.target_friend_name,
    event.target_display_name,
    event.started_at,
    event.ends_at,
    event.created_at,
    v_now
  from public.buffalo_events as event
  where event.ends_at > v_now
  order by event.started_at desc
  limit 1;

  -- Always return the sampled server time, even when no active event exists.
  if not found then
    return query
    select
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      v_now;
  end if;
end;
$$;

create function public.start_buffalo_event(
  p_caller_device_id uuid,
  p_caller_display_name text,
  p_target_kind text,
  p_target_friend_name text default null,
  p_target_display_name text default null
)
returns table (
  id uuid,
  caller_device_id uuid,
  caller_display_name text,
  target_kind text,
  target_friend_name text,
  target_display_name text,
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  server_now timestamptz,
  was_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_display_name text := pg_catalog.btrim(p_caller_display_name);
  v_target_kind text := pg_catalog.lower(pg_catalog.btrim(p_target_kind));
  v_target_friend_name text := pg_catalog.nullif(pg_catalog.btrim(p_target_friend_name), '');
  v_target_display_name text := pg_catalog.nullif(pg_catalog.btrim(p_target_display_name), '');
  v_now timestamptz;
  v_event public.buffalo_events;
begin
  if p_caller_device_id is null then
    raise exception using
      errcode = '22023',
      message = 'caller_device_id must not be null';
  end if;

  if v_caller_display_name is null
    or pg_catalog.char_length(v_caller_display_name) not between 1 and 24
  then
    raise exception using
      errcode = '22023',
      message = 'caller_display_name must contain between 1 and 24 characters';
  end if;

  if v_target_kind is null or v_target_kind not in ('friend', 'other') then
    raise exception using
      errcode = '22023',
      message = 'target_kind must be friend or other';
  end if;

  if v_target_kind = 'friend' then
    if v_target_friend_name is null
      or pg_catalog.char_length(v_target_friend_name) > 48
    then
      raise exception using
        errcode = '22023',
        message = 'friend targets require a name of at most 48 characters';
    end if;
    v_target_display_name := v_target_friend_name;
  else
    v_target_friend_name := null;
    v_target_display_name := pg_catalog.coalesce(
      v_target_display_name,
      'Jemand anderes'
    );
    if pg_catalog.char_length(v_target_display_name) > 48 then
      raise exception using
        errcode = '22023',
        message = 'other target display name must not exceed 48 characters';
    end if;
  end if;

  -- Every caller uses the same transaction-scoped lock. Because direct INSERT
  -- is revoked, this serializes the check-and-create operation across devices.
  perform pg_catalog.pg_advisory_xact_lock(204273, 1);
  v_now := pg_catalog.clock_timestamp();

  select event.*
  into v_event
  from public.buffalo_events as event
  where event.ends_at > v_now
  order by event.started_at desc
  limit 1;

  if found then
    return query
    select
      v_event.id,
      v_event.caller_device_id,
      v_event.caller_display_name,
      v_event.target_kind,
      v_event.target_friend_name,
      v_event.target_display_name,
      v_event.started_at,
      v_event.ends_at,
      v_event.created_at,
      v_now,
      false;
    return;
  end if;

  insert into public.buffalo_events (
    caller_device_id,
    caller_display_name,
    target_kind,
    target_friend_name,
    target_display_name,
    started_at,
    ends_at,
    created_at
  )
  values (
    p_caller_device_id,
    v_caller_display_name,
    v_target_kind,
    v_target_friend_name,
    v_target_display_name,
    v_now,
    v_now + interval '3 minutes',
    v_now
  )
  returning * into v_event;

  return query
  select
    v_event.id,
    v_event.caller_device_id,
    v_event.caller_display_name,
    v_event.target_kind,
    v_event.target_friend_name,
    v_event.target_display_name,
    v_event.started_at,
    v_event.ends_at,
    v_event.created_at,
    v_now,
    true;
end;
$$;

-- PostgreSQL grants function execution to PUBLIC by default. Expose only these
-- two narrow RPCs to browser roles; the table itself remains immutable to them.
revoke all on function public.get_active_buffalo_event()
  from public, anon, authenticated;
revoke all on function public.start_buffalo_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_active_buffalo_event()
  to anon, authenticated;
grant execute on function public.start_buffalo_event(uuid, text, text, text, text)
  to anon, authenticated;

-- Make INSERTs visible to Postgres Changes. The guarded block keeps the
-- migration usable when a project already added the table manually.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'buffalo_events'
  ) then
    alter publication supabase_realtime
      add table public.buffalo_events;
  end if;
end;
$$;

commit;
