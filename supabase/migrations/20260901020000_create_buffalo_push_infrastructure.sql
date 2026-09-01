begin;

create table public.push_subscriptions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  device_id uuid not null unique,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  buffalo_enabled boolean not null default true,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint push_subscriptions_endpoint_valid check (
    endpoint = pg_catalog.btrim(endpoint)
    and pg_catalog.char_length(endpoint) between 20 and 2048
    and endpoint ~ '^https://'
  ),
  constraint push_subscriptions_p256dh_valid check (
    p256dh = pg_catalog.btrim(p256dh)
    and pg_catalog.char_length(p256dh) between 40 and 256
  ),
  constraint push_subscriptions_auth_valid check (
    auth = pg_catalog.btrim(auth)
    and pg_catalog.char_length(auth) between 8 and 128
  ),
  constraint push_subscriptions_failure_count_nonnegative check (failure_count >= 0)
);

create table public.buffalo_push_jobs (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.buffalo_events(id) on delete cascade,
  job_type text not null,
  due_at timestamptz not null,
  expanded_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint buffalo_push_jobs_type_valid check (job_type in ('start', 'end')),
  constraint buffalo_push_jobs_event_type_unique unique (event_id, job_type)
);

create index buffalo_push_jobs_due_idx
  on public.buffalo_push_jobs (due_at, id)
  where expanded_at is null;

create table public.buffalo_push_deliveries (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.buffalo_push_jobs(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  claimed_at timestamptz,
  claim_token uuid,
  processed_at timestamptz,
  delivered_at timestamptz,
  succeeded boolean,
  last_error text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint buffalo_push_deliveries_attempts_nonnegative check (attempts >= 0),
  constraint buffalo_push_deliveries_job_subscription_unique unique (job_id, subscription_id),
  constraint buffalo_push_deliveries_terminal_consistent check (
    (processed_at is null and succeeded is null)
    or (processed_at is not null and succeeded is not null)
  )
);

create index buffalo_push_deliveries_claim_idx
  on public.buffalo_push_deliveries (next_attempt_at, id)
  where processed_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.buffalo_push_jobs enable row level security;
alter table public.buffalo_push_deliveries enable row level security;

-- Subscription endpoints and encryption keys are never directly readable from
-- browser roles. Narrow SECURITY DEFINER RPCs are the only client interface.
revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.buffalo_push_jobs from public, anon, authenticated;
revoke all on table public.buffalo_push_deliveries from public, anon, authenticated;
revoke all on sequence public.buffalo_push_jobs_id_seq from public, anon, authenticated;
revoke all on sequence public.buffalo_push_deliveries_id_seq from public, anon, authenticated;

create function public.set_push_subscription_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row
execute function public.set_push_subscription_updated_at();

create function public.register_buffalo_push_subscription(
  p_device_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint text := pg_catalog.btrim(p_endpoint);
  v_p256dh text := pg_catalog.btrim(p_p256dh);
  v_auth text := pg_catalog.btrim(p_auth);
begin
  if p_device_id is null then
    raise exception using errcode = '22023', message = 'device_id must not be null';
  end if;
  if v_endpoint is null
    or pg_catalog.char_length(v_endpoint) not between 20 and 2048
    or v_endpoint !~ '^https://'
  then
    raise exception using errcode = '22023', message = 'endpoint must be a valid HTTPS push endpoint';
  end if;
  if v_p256dh is null or pg_catalog.char_length(v_p256dh) not between 40 and 256 then
    raise exception using errcode = '22023', message = 'p256dh is invalid';
  end if;
  if v_auth is null or pg_catalog.char_length(v_auth) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'auth is invalid';
  end if;

  -- An endpoint identifies one browser subscription. If a browser recreated its
  -- local identity, move that unguessable endpoint instead of duplicating it.
  delete from public.push_subscriptions as subscription
  where subscription.endpoint = v_endpoint
    and subscription.device_id <> p_device_id;

  insert into public.push_subscriptions (
    device_id,
    endpoint,
    p256dh,
    auth,
    buffalo_enabled,
    failure_count,
    disabled_at
  )
  values (p_device_id, v_endpoint, v_p256dh, v_auth, true, 0, null)
  on conflict (device_id) do update
  set
    endpoint = excluded.endpoint,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    buffalo_enabled = true,
    failure_count = 0,
    disabled_at = null;

  return true;
end;
$$;

create function public.set_buffalo_push_enabled(
  p_device_id uuid,
  p_endpoint text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count bigint;
  v_endpoint text := nullif(pg_catalog.btrim(p_endpoint), ''::text);
begin
  if p_device_id is null or p_enabled is null then
    raise exception using errcode = '22023', message = 'device_id and enabled are required';
  end if;
  if p_enabled and v_endpoint is null then
    raise exception using errcode = '22023', message = 'endpoint is required when enabling push';
  end if;

  update public.push_subscriptions as subscription
  set
    buffalo_enabled = p_enabled,
    disabled_at = case when p_enabled then null else pg_catalog.clock_timestamp() end
  where subscription.device_id = p_device_id
    and (v_endpoint is null or subscription.endpoint = v_endpoint);

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end;
$$;

-- This replacement keeps the existing Buffalo guarantees and atomically adds
-- exactly one logical START and END outbox job only for a newly inserted event.
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
  v_target_friend_name text := nullif(pg_catalog.btrim(p_target_friend_name), ''::text);
  v_target_display_name text := nullif(pg_catalog.btrim(p_target_display_name), ''::text);
  v_now timestamptz;
  v_event public.buffalo_events;
begin
  if p_caller_device_id is null then
    raise exception using errcode = '22023', message = 'caller_device_id must not be null';
  end if;
  if v_caller_display_name is null
    or pg_catalog.char_length(v_caller_display_name) not between 1 and 24
  then
    raise exception using
      errcode = '22023',
      message = 'caller_display_name must contain between 1 and 24 characters';
  end if;
  if v_target_kind is null or v_target_kind not in ('friend', 'other') then
    raise exception using errcode = '22023', message = 'target_kind must be friend or other';
  end if;

  if v_target_kind = 'friend' then
    if v_target_friend_name is null or pg_catalog.char_length(v_target_friend_name) > 48 then
      raise exception using
        errcode = '22023',
        message = 'friend targets require a name of at most 48 characters';
    end if;
    v_target_display_name := v_target_friend_name;
  else
    v_target_friend_name := null;
    v_target_display_name := coalesce(v_target_display_name, 'Jemand anderes'::text);
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
      v_event.id, v_event.caller_device_id, v_event.caller_display_name,
      v_event.target_kind, v_event.target_friend_name, v_event.target_display_name,
      v_event.started_at, v_event.ends_at, v_event.created_at, v_now, false;
    return;
  end if;

  insert into public.buffalo_events (
    caller_device_id, caller_display_name, target_kind, target_friend_name,
    target_display_name, started_at, ends_at, created_at
  )
  values (
    p_caller_device_id, v_caller_display_name, v_target_kind, v_target_friend_name,
    v_target_display_name, v_now, v_now + interval '3 minutes', v_now
  )
  returning * into v_event;

  insert into public.buffalo_push_jobs (event_id, job_type, due_at)
  values
    (v_event.id, 'start', v_event.started_at),
    (v_event.id, 'end', v_event.ends_at)
  on conflict (event_id, job_type) do nothing;

  return query
  select
    v_event.id, v_event.caller_device_id, v_event.caller_display_name,
    v_event.target_kind, v_event.target_friend_name, v_event.target_display_name,
    v_event.started_at, v_event.ends_at, v_event.created_at, v_now, true;
end;
$$;

create function public.prepare_due_buffalo_push_deliveries(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expanded integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'limit must be between 1 and 100';
  end if;

  with due_jobs as (
    select job.id
    from public.buffalo_push_jobs as job
    where job.expanded_at is null and job.due_at <= v_now
    order by job.due_at, job.id
    limit p_limit
    for update skip locked
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

create function public.claim_due_buffalo_push_deliveries(
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
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_claim_token is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'claim_token and a valid limit are required';
  end if;

  -- A setting switched off after job expansion is terminally skipped.
  update public.buffalo_push_deliveries as delivery
  set
    processed_at = v_now,
    succeeded = false,
    last_error = 'subscription disabled'
  from public.push_subscriptions as subscription
  where delivery.subscription_id = subscription.id
    and delivery.processed_at is null
    and not subscription.buffalo_enabled;

  return query
  with claimable as (
    select delivery.id
    from public.buffalo_push_deliveries as delivery
    join public.push_subscriptions as subscription on subscription.id = delivery.subscription_id
    where delivery.processed_at is null
      and delivery.next_attempt_at <= v_now
      and delivery.attempts < 5
      and subscription.buffalo_enabled
      and (delivery.claimed_at is null or delivery.claimed_at < v_now - interval '2 minutes')
    order by delivery.next_attempt_at, delivery.id
    limit p_limit
    for update of delivery skip locked
  ), claimed as (
    update public.buffalo_push_deliveries as delivery
    set
      claimed_at = v_now,
      claim_token = p_claim_token,
      attempts = delivery.attempts + 1
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

create function public.complete_buffalo_push_delivery(
  p_delivery_id bigint,
  p_claim_token uuid,
  p_success boolean,
  p_permanent_failure boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.buffalo_push_deliveries;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_error text := pg_catalog.left(coalesce(p_error, ''::text), 240);
begin
  if p_delivery_id is null or p_claim_token is null
    or p_success is null or p_permanent_failure is null
  then
    raise exception using errcode = '22023', message = 'delivery result is incomplete';
  end if;

  select delivery.* into v_delivery
  from public.buffalo_push_deliveries as delivery
  where delivery.id = p_delivery_id
    and delivery.claim_token = p_claim_token
    and delivery.processed_at is null
  for update;

  if not found then return false; end if;

  if p_success then
    update public.buffalo_push_deliveries
    set
      processed_at = v_now,
      delivered_at = v_now,
      succeeded = true,
      last_error = null
    where id = p_delivery_id;
    update public.push_subscriptions
    set failure_count = 0, last_success_at = v_now
    where id = v_delivery.subscription_id;
  elsif p_permanent_failure or v_delivery.attempts >= 5 then
    update public.buffalo_push_deliveries
    set processed_at = v_now, succeeded = false, last_error = v_error
    where id = p_delivery_id;
    update public.push_subscriptions
    set
      failure_count = failure_count + 1,
      buffalo_enabled = case when p_permanent_failure then false else buffalo_enabled end,
      disabled_at = case when p_permanent_failure then v_now else disabled_at end
    where id = v_delivery.subscription_id;
  else
    update public.buffalo_push_deliveries
    set
      claimed_at = null,
      claim_token = null,
      last_error = v_error,
      next_attempt_at = v_now + case v_delivery.attempts
        when 1 then interval '30 seconds'
        when 2 then interval '1 minute'
        when 3 then interval '2 minutes'
        else interval '5 minutes'
      end
    where id = p_delivery_id;
    update public.push_subscriptions
    set failure_count = failure_count + 1
    where id = v_delivery.subscription_id;
  end if;

  return true;
end;
$$;

revoke all on function public.set_push_subscription_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.register_buffalo_push_subscription(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.set_buffalo_push_enabled(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.register_buffalo_push_subscription(uuid, text, text, text)
  to anon, authenticated;
grant execute on function public.set_buffalo_push_enabled(uuid, text, boolean)
  to anon, authenticated;

revoke all on function public.prepare_due_buffalo_push_deliveries(integer)
  from public, anon, authenticated;
revoke all on function public.claim_due_buffalo_push_deliveries(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_buffalo_push_delivery(bigint, uuid, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.prepare_due_buffalo_push_deliveries(integer) to service_role;
grant execute on function public.claim_due_buffalo_push_deliveries(uuid, integer) to service_role;
grant execute on function public.complete_buffalo_push_delivery(bigint, uuid, boolean, boolean, text)
  to service_role;

-- Reassert the unchanged browser access to the Buffalo start RPC.
revoke all on function public.start_buffalo_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_buffalo_event(uuid, text, text, text, text)
  to anon, authenticated;

commit;
