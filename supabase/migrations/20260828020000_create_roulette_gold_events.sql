begin;

create table public.roulette_gold_events (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  display_name text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint roulette_gold_events_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 24
  )
);

create index roulette_gold_events_created_at_idx
  on public.roulette_gold_events (created_at desc);

alter table public.roulette_gold_events enable row level security;

revoke all on table public.roulette_gold_events from public, anon, authenticated;

create function public.record_roulette_gold_event(
  p_device_id uuid,
  p_display_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_event_id bigint;
begin
  if p_device_id is null then
    raise exception using
      errcode = '22023',
      message = 'device_id must not be null';
  end if;

  if v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 24
  then
    raise exception using
      errcode = '22023',
      message = 'display_name must contain between 1 and 24 characters';
  end if;

  insert into public.roulette_gold_events (device_id, display_name)
  values (p_device_id, v_display_name)
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create function public.get_roulette_gold_event_cursor()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.max(event.id), 0::bigint)
  from public.roulette_gold_events as event;
$$;

create function public.get_roulette_gold_events(
  p_after_id bigint,
  p_device_id uuid,
  p_limit integer default 20
)
returns table (
  event_id bigint,
  display_name text,
  occurred_at timestamptz,
  is_own_device boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_after_id is null or p_after_id < 0 then
    raise exception using
      errcode = '22023',
      message = 'after_id must be a nonnegative integer';
  end if;

  if p_device_id is null then
    raise exception using
      errcode = '22023',
      message = 'device_id must not be null';
  end if;

  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using
      errcode = '22023',
      message = 'limit must be between 1 and 50';
  end if;

  return query
  select
    event.id as event_id,
    event.display_name,
    event.created_at as occurred_at,
    event.device_id = p_device_id as is_own_device
  from public.roulette_gold_events as event
  where event.id > p_after_id
  order by event.id asc
  limit p_limit;
end;
$$;

revoke all on function public.record_roulette_gold_event(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_roulette_gold_event_cursor()
  from public, anon, authenticated;
revoke all on function public.get_roulette_gold_events(bigint, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.record_roulette_gold_event(uuid, text)
  to anon, authenticated;
grant execute on function public.get_roulette_gold_event_cursor()
  to anon, authenticated;
grant execute on function public.get_roulette_gold_events(bigint, uuid, integer)
  to anon, authenticated;

commit;
