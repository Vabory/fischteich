begin;

-- NULLIF and COALESCE are PostgreSQL expression syntax, not functions in
-- pg_catalog. Keep real built-ins schema-qualified for the empty search_path,
-- but leave these expressions unqualified and cast their literals explicitly.
create or replace function public.start_buffalo_event(
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
  v_target_friend_name text := nullif(
    pg_catalog.btrim(p_target_friend_name),
    ''::text
  );
  v_target_display_name text := nullif(
    pg_catalog.btrim(p_target_display_name),
    ''::text
  );
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
    v_target_display_name := coalesce(
      v_target_display_name,
      'Jemand anderes'::text
    );
    if pg_catalog.char_length(v_target_display_name) > 48 then
      raise exception using
        errcode = '22023',
        message = 'other target display name must not exceed 48 characters';
    end if;
  end if;

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

-- CREATE OR REPLACE keeps the existing function identity and its ACL, but
-- reassert the intended browser permissions explicitly for auditability.
revoke all on function public.start_buffalo_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_buffalo_event(uuid, text, text, text, text)
  to anon, authenticated;

commit;
