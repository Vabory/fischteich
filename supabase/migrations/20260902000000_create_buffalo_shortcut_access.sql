begin;

-- A deliberately small, server-owned allowlist for voice clients. The browser
-- FRIENDS constant remains the UI source; tests keep both snapshots in sync.
create table public.buffalo_shortcut_targets (
  display_name text primary key,
  normalized_name text not null unique,
  created_at timestamptz not null default pg_catalog.now(),
  constraint buffalo_shortcut_targets_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 48
  ),
  constraint buffalo_shortcut_targets_normalized_name_valid check (
    normalized_name = pg_catalog.lower(normalized_name)
    and normalized_name = pg_catalog.btrim(normalized_name)
    and pg_catalog.char_length(normalized_name) between 1 and 48
  )
);

insert into public.buffalo_shortcut_targets (display_name, normalized_name)
values
  ('Tobi', 'tobi'),
  ('Luana', 'luana'),
  ('Marcel', 'marcel'),
  ('Caro', 'caro'),
  ('Patrick', 'patrick'),
  ('Michi M.', 'michi m.'),
  ('Julia', 'julia'),
  ('Patschi', 'patschi'),
  ('Chris', 'chris'),
  ('Julian', 'julian'),
  ('Fabian', 'fabian'),
  ('Kathi', 'kathi'),
  ('Juli', 'juli'),
  ('Dani', 'dani'),
  ('Luki', 'luki'),
  ('Tiffany', 'tiffany'),
  ('Brazn', 'brazn'),
  ('Michi S.', 'michi s.'),
  ('Hannah', 'hannah'),
  ('Melvin', 'melvin'),
  ('Clemens', 'clemens'),
  ('Vivienne', 'vivienne');

create table public.buffalo_shortcut_devices (
  device_id uuid primary key,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  token_hash text,
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  last_used_at timestamptz,
  rate_window_started_at timestamptz,
  rate_window_request_count integer not null default 0,
  constraint buffalo_shortcut_devices_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 24
  ),
  constraint buffalo_shortcut_devices_token_hash_valid check (
    token_hash is null or token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint buffalo_shortcut_devices_rate_count_valid check (
    rate_window_request_count >= 0
  )
);

create unique index buffalo_shortcut_devices_owner_device_idx
  on public.buffalo_shortcut_devices (owner_user_id, device_id);

alter table public.buffalo_shortcut_targets enable row level security;
alter table public.buffalo_shortcut_devices enable row level security;

-- Neither allowlist nor token hashes are browser-readable. The Edge Function
-- is the only public HTTP surface and uses the service role server-side.
revoke all on table public.buffalo_shortcut_targets from public, anon, authenticated;
revoke all on table public.buffalo_shortcut_devices from public, anon, authenticated;

create function public.start_buffalo_event_from_shortcut(
  p_device_id uuid,
  p_token_hash text,
  p_target text
)
returns table (
  outcome text,
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
  -- Locking the device row makes rate limiting and rotation checks atomic.
  select device.*
  into v_device
  from public.buffalo_shortcut_devices as device
  where device.device_id = p_device_id
  for update;

  if not found
    or not v_device.enabled
    or v_device.token_hash is null
    or p_token_hash is null
    or v_device.token_hash <> p_token_hash
  then
    return query select 'unauthorized'::text, null::uuid, null::text,
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
    return query select 'rate_limited'::text, null::uuid, null::text,
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

  select target.display_name
  into v_target_name
  from public.buffalo_shortcut_targets as target
  where target.normalized_name = v_normalized_target;

  if not found then
    return query select 'invalid_target'::text, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- This is the only event write: the existing RPC remains the source of truth
  -- for the global lock, exact duration and idempotent push outbox jobs.
  select *
  into v_event
  from public.start_buffalo_event(
    v_device.device_id,
    v_device.display_name,
    'friend',
    v_target_name,
    v_target_name
  );

  return query select
    case when v_event.was_created then 'created'::text else 'already_active'::text end,
    v_event.id,
    v_event.caller_display_name,
    v_event.target_display_name,
    v_event.started_at,
    v_event.ends_at;
end;
$$;

revoke all on function public.start_buffalo_event_from_shortcut(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.start_buffalo_event_from_shortcut(uuid, text, text)
  to service_role;

commit;
