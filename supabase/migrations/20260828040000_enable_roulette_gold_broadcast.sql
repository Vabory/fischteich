begin;

create or replace function public.broadcast_roulette_gold_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('event_id', new.id),
    'gold_hit',
    'roulette-gold-events',
    false
  );

  return new;
end;
$$;

drop trigger if exists roulette_gold_events_broadcast_insert
  on public.roulette_gold_events;

create trigger roulette_gold_events_broadcast_insert
after insert on public.roulette_gold_events
for each row
execute function public.broadcast_roulette_gold_event();

revoke all on function public.broadcast_roulette_gold_event()
  from public, anon, authenticated;

create or replace function public.record_roulette_gold_spin(
  p_display_name text,
  p_device_id uuid
)
returns public.roulette_stats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.roulette_stats;
begin
  if p_device_id is null then
    raise exception using
      errcode = '22023',
      message = 'device_id must not be null';
  end if;

  select *
  into v_result
  from public.record_roulette_spin(p_display_name, 'goldfish');

  insert into public.roulette_gold_events (device_id, display_name)
  values (p_device_id, pg_catalog.btrim(p_display_name));

  return v_result;
end;
$$;

revoke all on function public.record_roulette_gold_spin(text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_roulette_gold_spin(text, uuid)
  to anon, authenticated;

create or replace function public.get_global_roulette_stats()
returns table (
  total_spins bigint,
  turbolachs_count bigint,
  nitroforelle_count bigint,
  goldfish_count bigint,
  last_gold_hit_at timestamptz,
  last_gold_hit_display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with totals as (
    select
      coalesce(pg_catalog.sum(stats.total_spins), 0)::bigint
        as total_spins,
      coalesce(pg_catalog.sum(stats.turbolachs_count), 0)::bigint
        as turbolachs_count,
      coalesce(pg_catalog.sum(stats.nitroforelle_count), 0)::bigint
        as nitroforelle_count,
      coalesce(pg_catalog.sum(stats.goldfish_count), 0)::bigint
        as goldfish_count
    from public.roulette_stats as stats
  ),
  latest_gold_hit as (
    select
      event.created_at as last_gold_hit_at,
      event.display_name as last_gold_hit_display_name
    from public.roulette_gold_events as event
    order by event.id desc
    limit 1
  )
  select
    totals.total_spins,
    totals.turbolachs_count,
    totals.nitroforelle_count,
    totals.goldfish_count,
    latest_gold_hit.last_gold_hit_at,
    latest_gold_hit.last_gold_hit_display_name
  from totals
  left join latest_gold_hit on true;
$$;

revoke all on function public.get_global_roulette_stats()
  from public, anon, authenticated;
grant execute on function public.get_global_roulette_stats()
  to anon, authenticated;

commit;
