begin;

-- The caller_device_id is visible to Realtime subscribers and is therefore not
-- a credential by itself. Only the buffalo-shortcut Edge Function may call
-- this primitive, after verifying possession of the device management key.
create function public.stop_buffalo_event_for_device(
  p_event_id uuid,
  p_caller_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_event public.buffalo_events;
begin
  if p_event_id is null or p_caller_device_id is null then
    raise exception using errcode = '42501', message = 'A verified Buffalo device is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_id::text, 204273)
  );
  v_now := pg_catalog.clock_timestamp();

  select event.* into v_event
  from public.buffalo_events as event
  where event.id = p_event_id
  for update;

  if not found then return false; end if;

  if v_event.caller_device_id is distinct from p_caller_device_id then
    raise exception using errcode = '42501', message = 'Only the Buffalo creator device may stop this timer';
  end if;

  if v_event.stopped_at is not null then return true; end if;
  if v_event.started_at > v_now or v_event.ends_at <= v_now then return false; end if;

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

revoke all on function public.stop_buffalo_event_for_device(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.stop_buffalo_event_for_device(uuid, uuid)
  to service_role;

commit;
