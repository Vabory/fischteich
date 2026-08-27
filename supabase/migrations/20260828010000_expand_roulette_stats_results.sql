begin;

alter table public.roulette_stats
  add column turbolachs_count bigint not null default 0,
  add column nitroforelle_count bigint not null default 0,
  add column last_gold_hit_at timestamptz;

alter table public.roulette_stats
  add constraint roulette_stats_turbolachs_count_nonnegative
    check (turbolachs_count >= 0),
  add constraint roulette_stats_nitroforelle_count_nonnegative
    check (nitroforelle_count >= 0),
  -- Historical non-gold test spins cannot be assigned to a fish type reliably.
  -- After those rows are reset, the new RPC keeps this sum equal to total_spins.
  add constraint roulette_stats_tracked_results_not_above_total
    check (
      turbolachs_count::numeric
      + nitroforelle_count::numeric
      + goldfish_count::numeric
      <= total_spins::numeric
    );

-- Replace the boolean RPC completely so old clients cannot keep writing
-- incomplete result data after this migration is active.
revoke all on function public.record_roulette_spin(text, boolean)
  from public, anon, authenticated;
drop function public.record_roulette_spin(text, boolean);

create function public.record_roulette_spin(
  p_display_name text,
  p_result_type text
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

  if p_result_type is null or p_result_type not in (
    'turbolachs',
    'nitroforelle',
    'goldfish'
  ) then
    raise exception using
      errcode = '22023',
      message = 'result_type must be turbolachs, nitroforelle, or goldfish';
  end if;

  insert into public.roulette_stats (
    display_name,
    total_spins,
    turbolachs_count,
    nitroforelle_count,
    goldfish_count,
    last_gold_hit_at
  )
  values (
    v_display_name,
    1,
    case when p_result_type = 'turbolachs' then 1 else 0 end,
    case when p_result_type = 'nitroforelle' then 1 else 0 end,
    case when p_result_type = 'goldfish' then 1 else 0 end,
    case when p_result_type = 'goldfish' then pg_catalog.now() else null end
  )
  on conflict ((pg_catalog.lower(display_name))) do update
  set
    total_spins = public.roulette_stats.total_spins + 1,
    turbolachs_count = public.roulette_stats.turbolachs_count
      + case when p_result_type = 'turbolachs' then 1 else 0 end,
    nitroforelle_count = public.roulette_stats.nitroforelle_count
      + case when p_result_type = 'nitroforelle' then 1 else 0 end,
    goldfish_count = public.roulette_stats.goldfish_count
      + case when p_result_type = 'goldfish' then 1 else 0 end,
    last_gold_hit_at = case
      when p_result_type = 'goldfish' then pg_catalog.now()
      else public.roulette_stats.last_gold_hit_at
    end
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.record_roulette_spin(text, text)
  from public, anon, authenticated;
grant execute on function public.record_roulette_spin(text, text)
  to anon, authenticated;

create function public.get_global_roulette_stats()
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
security invoker
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
      stats.last_gold_hit_at,
      stats.display_name as last_gold_hit_display_name
    from public.roulette_stats as stats
    where stats.last_gold_hit_at is not null
    order by
      stats.last_gold_hit_at desc,
      pg_catalog.lower(stats.display_name) asc
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
