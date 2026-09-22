-- Run against a local database after migrations; every test write rolls back.
begin;

do $$
declare
  v_spin uuid := '11111111-1111-4111-8111-111111111111';
  v_gold uuid := '22222222-2222-4222-8222-222222222222';
  v_device uuid := '33333333-3333-4333-8333-333333333333';
  v_time timestamptz := '2026-09-22T12:00:00Z';
  v_name text := 'Phase4Fixture';
  v_first jsonb;
  v_retry jsonb;
  v_before_gold timestamptz;
  v_gold_count bigint;
begin
  v_first := public.record_roulette_spin_event(v_spin, v_device, v_name, 'turbolachs', v_time);
  v_retry := public.record_roulette_spin_event(v_spin, v_device, v_name, 'turbolachs', v_time);
  if v_first->>'status' <> 'processed' or v_retry->>'status' <> 'already_processed' then
    raise exception 'normal spin status mismatch';
  end if;
  if (select total_spins from public.roulette_stats where display_name = v_name) <> 1 then
    raise exception 'normal spin counted twice';
  end if;

  v_first := public.record_roulette_spin_event(v_gold, v_device, v_name, 'goldfish', v_time);
  select goldfish_count, last_gold_hit_at into v_gold_count, v_before_gold
  from public.roulette_stats where display_name = v_name;
  v_retry := public.record_roulette_spin_event(v_gold, v_device, v_name, 'goldfish', v_time);
  if v_first->>'status' <> 'processed' or v_retry->>'status' <> 'already_processed' then
    raise exception 'gold spin status mismatch';
  end if;
  if (select goldfish_count from public.roulette_stats where display_name = v_name) <> v_gold_count
    or (select last_gold_hit_at from public.roulette_stats where display_name = v_name) <> v_before_gold
    or (select count(*) from public.roulette_gold_events where display_name = v_name) <> 1 then
    raise exception 'gold retry changed counters, timestamp, or event count';
  end if;

  begin
    perform public.record_roulette_spin_event(
      '44444444-4444-4444-8444-444444444444', v_device, v_name, 'invalid', v_time
    );
    raise exception 'invalid result was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_roulette_spin_event(v_spin, v_device, v_name, 'nitroforelle', v_time);
    raise exception 'conflicting duplicate was accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

rollback;
