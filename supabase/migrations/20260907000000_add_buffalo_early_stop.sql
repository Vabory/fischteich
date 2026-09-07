begin;

alter table public.buffalo_events
  add column caller_user_id uuid references auth.users (id) on delete set null,
  add column stopped_at timestamptz;

alter table public.buffalo_events
  add constraint buffalo_events_stopped_at_valid check (
    stopped_at is null or (stopped_at >= started_at and stopped_at < ends_at)
  );

alter table public.buffalo_push_jobs
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

alter table public.buffalo_push_jobs
  add constraint buffalo_push_jobs_cancellation_consistent check (
    (cancelled_at is null and cancellation_reason is null)
    or (cancelled_at is not null and cancellation_reason is not null)
  );

create index buffalo_events_active_idx
  on public.buffalo_events (ends_at desc)
  where stopped_at is null;

-- Keep stopped-but-not-yet-expired rows readable until ends_at so Realtime can
-- deliver the UPDATE that removes the timer from every connected client.
comment on policy buffalo_events_active_read on public.buffalo_events is
  'Allows Realtime visibility until ends_at; get_active_buffalo_events additionally excludes stopped rows.';

-- These production functions have return types that change in this migration.
-- Drop dependants first; all are recreated below with the multi-timer contract.
drop function public.start_buffalo_event_from_shortcut(uuid, text, text);
drop function public.start_buffalo_event(uuid, text, text, text, text);
drop function public.get_active_buffalo_event();

create function public.get_active_buffalo_events()
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
  where event.started_at <= v_now
    and event.ends_at > v_now
    and event.stopped_at is null
  order by event.ends_at, event.started_at, event.id;
end;
$$;

-- Internal event creation primitive. Browser callers cannot provide the owner;
-- the public wrapper below always derives it from the verified JWT.
create function public.start_buffalo_event_for_owner(
  p_caller_user_id uuid,
  p_caller_device_id uuid,
  p_caller_display_name text,
  p_target_kind text,
  p_target_friend_name text default null,
  p_target_display_name text default null
)
returns table (
  status text,
  max_active integer,
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
  v_caller_display_name text := pg_catalog.btrim(p_caller_display_name);
  v_target_kind text := pg_catalog.lower(pg_catalog.btrim(p_target_kind));
  v_target_friend_name text := nullif(pg_catalog.btrim(p_target_friend_name), ''::text);
  v_target_display_name text := nullif(pg_catalog.btrim(p_target_display_name), ''::text);
  v_now timestamptz;
  v_event public.buffalo_events;
  v_active_count integer;
begin
  if p_caller_user_id is null or p_caller_device_id is null then
    raise exception using errcode = '42501', message = 'A verified Buffalo owner is required';
  end if;
  if v_caller_display_name is null
    or pg_catalog.char_length(v_caller_display_name) not between 1 and 24
  then
    raise exception using errcode = '22023', message = 'caller_display_name must contain between 1 and 24 characters';
  end if;
  if v_target_kind is null or v_target_kind not in ('friend', 'other') then
    raise exception using errcode = '22023', message = 'target_kind must be friend or other';
  end if;

  if v_target_kind = 'friend' then
    if v_target_friend_name is null or pg_catalog.char_length(v_target_friend_name) > 48 then
      raise exception using errcode = '22023', message = 'friend targets require a name of at most 48 characters';
    end if;
    v_target_display_name := v_target_friend_name;
  else
    v_target_friend_name := null;
    v_target_display_name := coalesce(v_target_display_name, 'Jemand anderes'::text);
    if pg_catalog.char_length(v_target_display_name) > 48 then
      raise exception using errcode = '22023', message = 'other target display name must not exceed 48 characters';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(204273, 1);
  v_now := pg_catalog.clock_timestamp();

  select pg_catalog.count(*)::integer into v_active_count
  from public.buffalo_events as event
  where event.started_at <= v_now
    and event.ends_at > v_now
    and event.stopped_at is null;

  if v_active_count >= 5 then
    return query select
      'limit_reached'::text, 5,
      null::uuid, null::uuid, null::text, null::text, null::text, null::text,
      null::timestamptz, null::timestamptz, null::timestamptz, v_now;
    return;
  end if;

  insert into public.buffalo_events (
    caller_user_id, caller_device_id, caller_display_name, target_kind,
    target_friend_name, target_display_name, started_at, ends_at, created_at
  ) values (
    p_caller_user_id, p_caller_device_id, v_caller_display_name, v_target_kind,
    v_target_friend_name, v_target_display_name, v_now, v_now + interval '3 minutes', v_now
  ) returning * into v_event;

  insert into public.buffalo_push_jobs (event_id, job_type, due_at)
  values
    (v_event.id, 'start', v_event.started_at),
    (v_event.id, 'end', v_event.ends_at)
  on conflict (event_id, job_type) do nothing;

  return query select
    'created'::text, 5,
    v_event.id, v_event.caller_device_id, v_event.caller_display_name,
    v_event.target_kind, v_event.target_friend_name, v_event.target_display_name,
    v_event.started_at, v_event.ends_at, v_event.created_at, v_now;
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
  status text,
  max_active integer,
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
  v_owner_user_id uuid := auth.uid();
begin
  if v_owner_user_id is null then
    raise exception using errcode = '42501', message = 'An authenticated Buffalo owner is required';
  end if;

  return query
  select * from public.start_buffalo_event_for_owner(
    v_owner_user_id,
    p_caller_device_id,
    p_caller_display_name,
    p_target_kind,
    p_target_friend_name,
    p_target_display_name
  );
end;
$$;

create function public.stop_buffalo_event(
  p_event_id uuid,
  p_caller_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid := auth.uid();
  v_now timestamptz;
  v_event public.buffalo_events;
begin
  if p_event_id is null or p_caller_device_id is null or v_owner_user_id is null then
    raise exception using errcode = '42501', message = 'A verified Buffalo owner is required';
  end if;

  -- Synchronize only this event with its final end-send authorization.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_id::text, 204273)
  );
  v_now := pg_catalog.clock_timestamp();

  select event.* into v_event
  from public.buffalo_events as event
  where event.id = p_event_id
  for update;

  if not found then return false; end if;

  if v_event.caller_user_id is distinct from v_owner_user_id
    or v_event.caller_device_id is distinct from p_caller_device_id
  then
    raise exception using errcode = '42501', message = 'Only the Buffalo creator may stop this timer';
  end if;

  if v_event.stopped_at is not null then return true; end if;
  if v_event.started_at > v_now or v_event.ends_at <= v_now then return false; end if;

  -- A recent claim means the worker may already have server-authorized a
  -- network send. Refusing this stop preserves the guarantee that a successful
  -- stop is never followed by an end notification.
  if exists (
    select 1
    from public.buffalo_push_deliveries as delivery
    join public.buffalo_push_jobs as job on job.id = delivery.job_id
    where job.event_id = v_event.id
      and job.job_type = 'end'
      and delivery.processed_at is null
      and delivery.claimed_at is not null
      and delivery.claimed_at >= v_now - interval '2 minutes'
  ) then
    raise exception using errcode = '55000', message = 'Buffalo end notification dispatch is already in progress';
  end if;

  update public.buffalo_events
  set stopped_at = v_now
  where id = v_event.id;

  update public.buffalo_push_jobs
  set cancelled_at = v_now, cancellation_reason = 'event stopped'
  where event_id = v_event.id
    and job_type = 'end'
    and cancelled_at is null;

  update public.buffalo_push_deliveries as delivery
  set
    processed_at = v_now,
    delivered_at = null,
    succeeded = false,
    claimed_at = null,
    claim_token = null,
    last_error = 'event stopped'
  from public.buffalo_push_jobs as job
  where delivery.job_id = job.id
    and job.event_id = v_event.id
    and job.job_type = 'end'
    and delivery.processed_at is null;

  return true;
end;
$$;

create or replace function public.prepare_due_buffalo_push_deliveries(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_expanded integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'limit must be between 1 and 100';
  end if;

  v_now := pg_catalog.clock_timestamp();

  with due_jobs as (
    select job.id
    from public.buffalo_push_jobs as job
    join public.buffalo_events as event on event.id = job.event_id
    where job.expanded_at is null
      and job.cancelled_at is null
      and job.due_at <= v_now
      and (job.job_type <> 'end' or event.stopped_at is null)
    order by job.due_at, job.id
    limit p_limit
    for update of job skip locked
  ), inserted_deliveries as (
    insert into public.buffalo_push_deliveries (job_id, subscription_id, next_attempt_at)
    select due.id, subscription.id, v_now
    from due_jobs as due
    cross join public.push_subscriptions as subscription
    where subscription.buffalo_enabled
    on conflict (job_id, subscription_id) do nothing
    returning 1
  ), expanded_jobs as (
    update public.buffalo_push_jobs as job
    set expanded_at = v_now
    where job.id in (select due.id from due_jobs as due)
    returning 1
  )
  select pg_catalog.count(*)::integer into v_expanded from expanded_jobs;

  return v_expanded;
end;
$$;

create or replace function public.claim_due_buffalo_push_deliveries(
  p_claim_token uuid,
  p_limit integer default 100
)
returns table (
  delivery_id bigint,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  event_id uuid,
  job_type text,
  caller_display_name text,
  target_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_claim_token is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'claim_token and a valid limit are required';
  end if;

  v_now := pg_catalog.clock_timestamp();

  update public.buffalo_push_deliveries as delivery
  set processed_at = v_now, succeeded = false, last_error = 'subscription disabled'
  from public.push_subscriptions as subscription
  where delivery.subscription_id = subscription.id
    and delivery.processed_at is null
    and not subscription.buffalo_enabled;

  update public.buffalo_push_deliveries as delivery
  set
    processed_at = v_now,
    succeeded = false,
    claimed_at = null,
    claim_token = null,
    last_error = 'event stopped'
  from public.buffalo_push_jobs as job
  join public.buffalo_events as event on event.id = job.event_id
  where delivery.job_id = job.id
    and delivery.processed_at is null
    and job.job_type = 'end'
    and (job.cancelled_at is not null or event.stopped_at is not null);

  return query
  with claimable as (
    select delivery.id
    from public.buffalo_push_deliveries as delivery
    join public.push_subscriptions as subscription on subscription.id = delivery.subscription_id
    join public.buffalo_push_jobs as job on job.id = delivery.job_id
    join public.buffalo_events as event on event.id = job.event_id
    where delivery.processed_at is null
      and delivery.next_attempt_at <= v_now
      and delivery.attempts < 5
      and subscription.buffalo_enabled
      and job.cancelled_at is null
      and (job.job_type <> 'end' or event.stopped_at is null)
      and (delivery.claimed_at is null or delivery.claimed_at < v_now - interval '2 minutes')
    order by delivery.next_attempt_at, delivery.id
    limit p_limit
    for update of delivery skip locked
  ), claimed as (
    update public.buffalo_push_deliveries as delivery
    set claimed_at = v_now, claim_token = p_claim_token, attempts = delivery.attempts + 1
    where delivery.id in (select claimable.id from claimable)
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    event.id,
    job.job_type,
    event.caller_display_name,
    event.target_display_name
  from claimed
  join public.push_subscriptions as subscription on subscription.id = claimed.subscription_id
  join public.buffalo_push_jobs as job on job.id = claimed.job_id
  join public.buffalo_events as event on event.id = job.event_id
  order by claimed.id;
end;
$$;

-- Final server-side gate immediately before the worker creates a network
-- request. The live claim remains set, so stop_buffalo_event cannot report a
-- successful stop until this dispatch has finished or the claim expires.
create function public.can_send_buffalo_push_delivery(
  p_delivery_id bigint,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_job_type text;
  v_event_id uuid;
  v_cancelled_at timestamptz;
  v_stopped_at timestamptz;
begin
  if p_delivery_id is null or p_claim_token is null then return false; end if;

  v_now := pg_catalog.clock_timestamp();

  select job.event_id into v_event_id
  from public.buffalo_push_deliveries as delivery
  join public.buffalo_push_jobs as job on job.id = delivery.job_id
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.processed_at is null;

  if not found then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_event_id::text, 204273)
  );

  select job.job_type, job.cancelled_at, event.stopped_at
  into v_job_type, v_cancelled_at, v_stopped_at
  from public.buffalo_push_deliveries as delivery
  join public.buffalo_push_jobs as job on job.id = delivery.job_id
  join public.buffalo_events as event on event.id = job.event_id
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.processed_at is null
  for update of delivery, event;

  if not found then return false; end if;
  if v_job_type <> 'end' then return true; end if;

  if v_cancelled_at is not null or v_stopped_at is not null then
    update public.buffalo_push_deliveries
    set
      processed_at = v_now,
      succeeded = false,
      claimed_at = null,
      claim_token = null,
      last_error = 'event stopped'
    where id = p_delivery_id;
    return false;
  end if;

  return true;
end;
$$;

create function public.start_buffalo_event_from_shortcut(
  p_device_id uuid,
  p_token_hash text,
  p_target text
)
returns table (
  outcome text,
  max_active integer,
  id uuid,
  caller_display_name text,
  target_display_name text,
  started_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_device public.buffalo_shortcut_devices;
  v_target_name text;
  v_normalized_target text := pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_target), '\s+', ' ', 'g')
  );
  v_event record;
begin
  select device.* into v_device
  from public.buffalo_shortcut_devices as device
  where device.device_id = p_device_id
  for update;

  if not found
    or not v_device.enabled
    or v_device.token_hash is null
    or p_token_hash is null
    or v_device.token_hash <> p_token_hash
  then
    return query select 'unauthorized'::text, 5, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_device.rate_window_started_at is null
    or v_device.rate_window_started_at <= v_now - interval '1 minute'
  then
    v_device.rate_window_started_at := v_now;
    v_device.rate_window_request_count := 0;
  end if;

  if v_device.rate_window_request_count >= 10 then
    return query select 'rate_limited'::text, 5, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  update public.buffalo_shortcut_devices as device
  set
    rate_window_started_at = v_device.rate_window_started_at,
    rate_window_request_count = v_device.rate_window_request_count + 1,
    last_used_at = v_now,
    updated_at = v_now
  where device.device_id = p_device_id;

  select target.display_name into v_target_name
  from public.buffalo_shortcut_targets as target
  where target.normalized_name = v_normalized_target;

  if not found then
    return query select 'invalid_target'::text, 5, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_event
  from public.start_buffalo_event_for_owner(
    v_device.owner_user_id,
    v_device.device_id,
    v_device.display_name,
    'friend',
    v_target_name,
    v_target_name
  );

  return query select
    v_event.status,
    v_event.max_active,
    v_event.id,
    v_event.caller_display_name,
    v_event.target_display_name,
    v_event.started_at,
    v_event.ends_at;
end;
$$;

revoke all on function public.start_buffalo_event_for_owner(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_buffalo_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_buffalo_event(uuid, text, text, text, text)
  to authenticated;
revoke all on function public.get_active_buffalo_events()
  from public, anon, authenticated;
grant execute on function public.get_active_buffalo_events()
  to anon, authenticated;
revoke all on function public.stop_buffalo_event(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.stop_buffalo_event(uuid, uuid)
  to authenticated;

revoke all on function public.prepare_due_buffalo_push_deliveries(integer)
  from public, anon, authenticated;
revoke all on function public.claim_due_buffalo_push_deliveries(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.can_send_buffalo_push_delivery(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_due_buffalo_push_deliveries(integer) to service_role;
grant execute on function public.claim_due_buffalo_push_deliveries(uuid, integer) to service_role;
grant execute on function public.can_send_buffalo_push_delivery(bigint, uuid) to service_role;

revoke all on function public.start_buffalo_event_from_shortcut(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.start_buffalo_event_from_shortcut(uuid, text, text)
  to service_role;

commit;
