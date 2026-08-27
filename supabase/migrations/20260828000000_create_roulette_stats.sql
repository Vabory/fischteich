begin;

create table public.roulette_stats (
  display_name text primary key,
  total_spins bigint not null default 0,
  goldfish_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_stats_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 24
  ),
  constraint roulette_stats_total_spins_nonnegative check (total_spins >= 0),
  constraint roulette_stats_goldfish_count_nonnegative check (goldfish_count >= 0),
  constraint roulette_stats_goldfish_not_above_total check (goldfish_count <= total_spins)
);

-- The first spelling/casing is retained for display, while this index makes the
-- shared statistics identity case-insensitive.
create unique index roulette_stats_display_name_normalized_key
  on public.roulette_stats ((pg_catalog.lower(display_name)));

create function public.set_roulette_stats_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger roulette_stats_set_updated_at
before update on public.roulette_stats
for each row
execute function public.set_roulette_stats_updated_at();

alter table public.roulette_stats enable row level security;

create policy roulette_stats_public_read
on public.roulette_stats
for select
to anon, authenticated
using (true);

-- Supabase may have permissive default privileges for public-schema objects.
-- Remove them explicitly, then grant browser roles read-only table access.
revoke all on table public.roulette_stats from public, anon, authenticated;
grant select on table public.roulette_stats to anon, authenticated;

create function public.record_roulette_spin(
  p_display_name text,
  p_is_goldfish boolean
)
returns public.roulette_stats
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_result public.roulette_stats;
begin
  if v_display_name is null or v_display_name = '' then
    raise exception using
      errcode = '22023',
      message = 'display_name must not be empty';
  end if;

  if pg_catalog.char_length(v_display_name) > 24 then
    raise exception using
      errcode = '22023',
      message = 'display_name must not exceed 24 characters';
  end if;

  if p_is_goldfish is null then
    raise exception using
      errcode = '22023',
      message = 'is_goldfish must be true or false';
  end if;

  insert into public.roulette_stats (
    display_name,
    total_spins,
    goldfish_count
  )
  values (
    v_display_name,
    1,
    case when p_is_goldfish then 1 else 0 end
  )
  on conflict ((pg_catalog.lower(display_name))) do update
  set
    total_spins = public.roulette_stats.total_spins + 1,
    goldfish_count = public.roulette_stats.goldfish_count
      + case when p_is_goldfish then 1 else 0 end
  returning * into v_result;

  return v_result;
end;
$$;

-- Functions are executable by PUBLIC by default in PostgreSQL. Only the RPC is
-- exposed to Supabase browser roles; the trigger helper remains private.
revoke all on function public.set_roulette_stats_updated_at()
  from public, anon, authenticated;
revoke all on function public.record_roulette_spin(text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_roulette_spin(text, boolean)
  to anon, authenticated;

commit;
