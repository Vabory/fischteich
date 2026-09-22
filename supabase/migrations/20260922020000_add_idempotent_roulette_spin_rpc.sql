begin;

-- Receipts protect the existing aggregate and gold-event writes from retries.
-- Historical aggregate rows intentionally have no receipt backfill.
create table public.roulette_spin_events (
  spin_id uuid primary key,
  device_id uuid not null,
  display_name text not null,
  result text not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.now(),
  constraint roulette_spin_events_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 24
  ),
  constraint roulette_spin_events_result_valid check (
    result in ('turbolachs', 'nitroforelle', 'goldfish')
  )
);

alter table public.roulette_spin_events enable row level security;
revoke all on table public.roulette_spin_events from public, anon, authenticated;

create function public.record_roulette_spin_event(
  p_spin_id uuid,
  p_device_id uuid,
  p_display_name text,
  p_result text,
  p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_inserted_id uuid;
  v_existing public.roulette_spin_events;
  v_stats public.roulette_stats;
begin
  if p_spin_id is null or p_device_id is null or p_client_created_at is null then
    raise exception using errcode = '22023', message = 'spin_id, device_id, and client_created_at are required';
  end if;
  if v_display_name is null or pg_catalog.char_length(v_display_name) not between 1 and 24 then
    raise exception using errcode = '22023', message = 'display_name must contain between 1 and 24 characters';
  end if;
  if p_result is null or p_result not in ('turbolachs', 'nitroforelle', 'goldfish') then
    raise exception using errcode = '22023', message = 'invalid roulette result';
  end if;

  -- The primary-key conflict arbitrates concurrent requests for the same ID.
  -- A failed aggregate or gold-event write rolls the receipt back with it.
  insert into public.roulette_spin_events (
    spin_id, device_id, display_name, result, client_created_at
  ) values (
    p_spin_id, p_device_id, v_display_name, p_result, p_client_created_at
  )
  on conflict (spin_id) do nothing
  returning spin_id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_existing
    from public.roulette_spin_events
    where spin_id = p_spin_id;
    if v_existing.device_id is distinct from p_device_id
      or v_existing.display_name is distinct from v_display_name
      or v_existing.result is distinct from p_result
      or v_existing.client_created_at is distinct from p_client_created_at then
      raise exception using errcode = '22023', message = 'spin_id already belongs to a different spin';
    end if;
    select * into v_stats
    from public.roulette_stats
    where pg_catalog.lower(display_name) = pg_catalog.lower(v_display_name);
    return pg_catalog.jsonb_build_object('status', 'already_processed', 'stats', pg_catalog.to_jsonb(v_stats));
  end if;

  insert into public.roulette_stats (
    display_name, total_spins, turbolachs_count, nitroforelle_count,
    goldfish_count, last_gold_hit_at
  ) values (
    v_display_name, 1,
    case when p_result = 'turbolachs' then 1 else 0 end,
    case when p_result = 'nitroforelle' then 1 else 0 end,
    case when p_result = 'goldfish' then 1 else 0 end,
    case when p_result = 'goldfish' then pg_catalog.now() else null end
  )
  on conflict ((pg_catalog.lower(display_name))) do update
  set
    total_spins = public.roulette_stats.total_spins + 1,
    turbolachs_count = public.roulette_stats.turbolachs_count
      + case when p_result = 'turbolachs' then 1 else 0 end,
    nitroforelle_count = public.roulette_stats.nitroforelle_count
      + case when p_result = 'nitroforelle' then 1 else 0 end,
    goldfish_count = public.roulette_stats.goldfish_count
      + case when p_result = 'goldfish' then 1 else 0 end,
    last_gold_hit_at = case
      when p_result = 'goldfish' then pg_catalog.now()
      else public.roulette_stats.last_gold_hit_at
    end
  returning * into v_stats;

  if p_result = 'goldfish' then
    insert into public.roulette_gold_events (device_id, display_name)
    values (p_device_id, v_display_name);
  end if;

  return pg_catalog.jsonb_build_object('status', 'processed', 'stats', pg_catalog.to_jsonb(v_stats));
end;
$$;

revoke all on function public.record_roulette_spin_event(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_roulette_spin_event(uuid, uuid, text, text, timestamptz)
  to anon, authenticated;

-- Keep legacy RPC grants during the client transition. The separate rollout
-- script revokes them after active old clients have had time to update.

commit;
