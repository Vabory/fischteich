begin;

create function public.start_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_entry_count integer;
  v_existing_match_count integer;
  v_group_count integer;
  v_group_entry_count integer;
  v_distinct_group_entry_count integer;
  v_smallest_group_size integer;
  v_group_size integer;
  v_group record;
  v_group_entries uuid[];
  v_rotated_entries uuid[];
  v_schedule_size integer;
  v_group_round integer;
  v_pair_index integer;
  v_entry_a_id uuid;
  v_entry_b_id uuid;
  v_match_order integer := 0;
  v_bracket_size integer := 1;
  v_round_count integer := 0;
  v_round_number integer;
  v_round_match_count integer;
  v_bracket_work integer;
  v_match_index integer;
  v_target_match_id uuid;
  v_target_stage text;
  v_target_slot text;
  v_seed_slots integer[] := array[1, 2];
  v_next_seed_slots integer[];
  v_seed_slot_size integer := 2;
  v_seed_a integer;
  v_seed_b integer;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  if p_tournament_id is null then
    raise exception using
      errcode = '22023',
      message = 'tournament_id is required';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Tournament does not exist';
  end if;

  if v_tournament.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'Deleted tournaments cannot be started';
  end if;

  if v_tournament.host_user_id <> v_actor_id
    and not public.is_tournament_admin()
  then
    raise exception using
      errcode = '42501',
      message = 'Only the tournament host or an admin may start this tournament';
  end if;

  if v_tournament.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = 'Only a draft tournament can be started';
  end if;

  select pg_catalog.count(*)::integer
  into v_existing_match_count
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id;

  if v_existing_match_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'A draft tournament must not already contain matches';
  end if;

  select pg_catalog.count(*)::integer
  into v_entry_count
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id;

  if v_entry_count < 2 then
    raise exception using
      errcode = '22023',
      message = 'At least two tournament entries are required';
  end if;

  if exists (
    select 1
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and entry.entry_type <> v_tournament.tournament_type
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every entry type must match the tournament type';
  end if;

  if v_tournament.tournament_type = 'team' and exists (
    select 1
    from public.tournament_entries as entry
    where entry.tournament_id = p_tournament_id
      and not exists (
        select 1
        from public.tournament_team_members as member
        where member.tournament_id = p_tournament_id
          and member.team_entry_id = entry.id
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every team entry must contain at least one member';
  end if;

  if v_tournament.group_stage_enabled then
    select pg_catalog.count(*)::integer
    into v_group_count
    from public.tournament_groups as tournament_group
    where tournament_group.tournament_id = p_tournament_id;

    if v_group_count < 2
      or v_tournament.group_count is null
      or v_tournament.group_count <> v_group_count
    then
      raise exception using
        errcode = '22023',
        message = 'The stored group count does not match the tournament configuration';
    end if;

    select
      pg_catalog.count(*)::integer,
      pg_catalog.count(distinct group_entry.entry_id)::integer
    into v_group_entry_count, v_distinct_group_entry_count
    from public.tournament_group_entries as group_entry
    where group_entry.tournament_id = p_tournament_id;

    if v_group_entry_count <> v_entry_count
      or v_distinct_group_entry_count <> v_entry_count
    then
      raise exception using
        errcode = '22023',
        message = 'Every tournament entry must belong to exactly one group';
    end if;

    v_smallest_group_size := null;

    for v_group in
      select tournament_group.id, tournament_group.label, tournament_group.sort_order
      from public.tournament_groups as tournament_group
      where tournament_group.tournament_id = p_tournament_id
      order by tournament_group.sort_order, tournament_group.id
    loop
      select
        pg_catalog.array_agg(group_entry.entry_id order by group_entry.group_seed, group_entry.entry_id),
        pg_catalog.count(*)::integer
      into v_group_entries, v_group_size
      from public.tournament_group_entries as group_entry
      where group_entry.tournament_id = p_tournament_id
        and group_entry.group_id = v_group.id;

      if v_group_size < 2 then
        raise exception using
          errcode = '22023',
          message = 'Every group must contain at least two entries';
      end if;

      if v_smallest_group_size is null or v_group_size < v_smallest_group_size then
        v_smallest_group_size := v_group_size;
      end if;

      if pg_catalog.mod(v_group_size, 2) = 1 then
        v_group_entries := pg_catalog.array_append(v_group_entries, null::uuid);
      end if;

      v_schedule_size := pg_catalog.cardinality(v_group_entries);

      for v_group_round in 1..(v_schedule_size - 1) loop
        for v_pair_index in 1..(v_schedule_size / 2) loop
          v_entry_a_id := v_group_entries[v_pair_index];
          v_entry_b_id := v_group_entries[v_schedule_size + 1 - v_pair_index];

          if v_entry_a_id is not null and v_entry_b_id is not null then
            insert into public.tournament_matches (
              tournament_id,
              stage,
              phase_label,
              group_id,
              entry_a_id,
              entry_b_id,
              match_status,
              round_number,
              match_order
            )
            values (
              p_tournament_id,
              'group',
              v_group.label,
              v_group.id,
              v_entry_a_id,
              v_entry_b_id,
              'scheduled',
              v_group_round,
              v_match_order
            );

            v_match_order := v_match_order + 1;
          end if;
        end loop;

        v_rotated_entries := array[
          v_group_entries[1],
          v_group_entries[v_schedule_size]
        ];

        if v_schedule_size > 2 then
          v_rotated_entries := v_rotated_entries || v_group_entries[2:(v_schedule_size - 1)];
        end if;

        v_group_entries := v_rotated_entries;
      end loop;
    end loop;

    if v_tournament.advancers_per_group is null
      or v_tournament.advancers_per_group < 1
      or v_tournament.advancers_per_group >= v_smallest_group_size
    then
      raise exception using
        errcode = '22023',
        message = 'advancers_per_group must leave at least one entry eliminated in every group';
    end if;
  else
    if v_tournament.group_count is not null
      or v_tournament.advancers_per_group is not null
      or exists (
        select 1
        from public.tournament_groups as tournament_group
        where tournament_group.tournament_id = p_tournament_id
      )
      or exists (
        select 1
        from public.tournament_group_entries as group_entry
        where group_entry.tournament_id = p_tournament_id
      )
    then
      raise exception using
        errcode = '22023',
        message = 'Direct knockout tournaments must not contain group structure';
    end if;

    with randomized_entries as (
      select
        entry.id,
        pg_catalog.row_number() over (
          order by pg_catalog.random(), entry.id
        )::integer as assigned_seed
      from public.tournament_entries as entry
      where entry.tournament_id = p_tournament_id
    )
    update public.tournament_entries as entry
    set seed = randomized_entry.assigned_seed
    from randomized_entries as randomized_entry
    where entry.id = randomized_entry.id;

    while v_bracket_size < v_entry_count loop
      v_bracket_size := v_bracket_size * 2;
    end loop;

    v_bracket_work := v_bracket_size;
    while v_bracket_work > 1 loop
      v_round_count := v_round_count + 1;
      v_bracket_work := v_bracket_work / 2;
    end loop;

    if v_round_count = 1 then
      select entry.id into v_entry_a_id
      from public.tournament_entries as entry
      where entry.tournament_id = p_tournament_id and entry.seed = 1;

      select entry.id into v_entry_b_id
      from public.tournament_entries as entry
      where entry.tournament_id = p_tournament_id and entry.seed = 2;

      insert into public.tournament_matches (
        tournament_id,
        stage,
        phase_label,
        entry_a_id,
        entry_b_id,
        match_status,
        round_number,
        match_order
      )
      values (
        p_tournament_id,
        'final',
        'Finale',
        v_entry_a_id,
        v_entry_b_id,
        'scheduled',
        1,
        0
      );
    else
      v_round_number := v_round_count;
      v_round_match_count := 1;

      while v_round_number >= 2 loop
        for v_match_index in 0..(v_round_match_count - 1) loop
          if v_round_number = v_round_count then
            v_target_match_id := null;
            v_target_slot := null;
          else
            v_target_stage := case
              when v_round_number + 1 = v_round_count then 'final'
              else 'winner_bracket'
            end;

            select tournament_match.id
            into v_target_match_id
            from public.tournament_matches as tournament_match
            where tournament_match.tournament_id = p_tournament_id
              and tournament_match.stage = v_target_stage
              and tournament_match.round_number = v_round_number + 1
              and tournament_match.match_order = v_match_index / 2;

            v_target_slot := case
              when pg_catalog.mod(v_match_index, 2) = 0 then 'a'
              else 'b'
            end;
          end if;

          insert into public.tournament_matches (
            tournament_id,
            stage,
            phase_label,
            match_status,
            round_number,
            match_order,
            winner_advances_to_match_id,
            winner_advances_to_slot
          )
          values (
            p_tournament_id,
            case when v_round_number = v_round_count then 'final' else 'winner_bracket' end,
            case when v_round_number = v_round_count then 'Finale' else 'KO-Runde ' || v_round_number::text end,
            'scheduled',
            v_round_number,
            v_match_index,
            v_target_match_id,
            v_target_slot
          );
        end loop;

        v_round_number := v_round_number - 1;
        v_round_match_count := v_round_match_count * 2;
      end loop;

      while v_seed_slot_size < v_bracket_size loop
        v_next_seed_slots := '{}'::integer[];

        for v_pair_index in 1..pg_catalog.cardinality(v_seed_slots) loop
          v_next_seed_slots := pg_catalog.array_append(v_next_seed_slots, v_seed_slots[v_pair_index]);
          v_next_seed_slots := pg_catalog.array_append(
            v_next_seed_slots,
            (v_seed_slot_size * 2) + 1 - v_seed_slots[v_pair_index]
          );
        end loop;

        v_seed_slots := v_next_seed_slots;
        v_seed_slot_size := v_seed_slot_size * 2;
      end loop;

      for v_match_index in 0..((v_bracket_size / 2) - 1) loop
        v_seed_a := v_seed_slots[(v_match_index * 2) + 1];
        v_seed_b := v_seed_slots[(v_match_index * 2) + 2];

        select entry.id into v_entry_a_id
        from public.tournament_entries as entry
        where entry.tournament_id = p_tournament_id and entry.seed = v_seed_a;

        select entry.id into v_entry_b_id
        from public.tournament_entries as entry
        where entry.tournament_id = p_tournament_id and entry.seed = v_seed_b;

        select tournament_match.id
        into v_target_match_id
        from public.tournament_matches as tournament_match
        where tournament_match.tournament_id = p_tournament_id
          and tournament_match.stage = case when v_round_count = 2 then 'final' else 'winner_bracket' end
          and tournament_match.round_number = 2
          and tournament_match.match_order = v_match_index / 2;

        v_target_slot := case
          when pg_catalog.mod(v_match_index, 2) = 0 then 'a'
          else 'b'
        end;

        if v_entry_a_id is not null and v_entry_b_id is not null then
          insert into public.tournament_matches (
            tournament_id,
            stage,
            phase_label,
            entry_a_id,
            entry_b_id,
            match_status,
            round_number,
            match_order,
            winner_advances_to_match_id,
            winner_advances_to_slot
          )
          values (
            p_tournament_id,
            'winner_bracket',
            'KO-Runde 1',
            v_entry_a_id,
            v_entry_b_id,
            'scheduled',
            1,
            v_match_index,
            v_target_match_id,
            v_target_slot
          );
        elsif v_entry_a_id is not null or v_entry_b_id is not null then
          if v_target_slot = 'a' then
            update public.tournament_matches
            set entry_a_id = coalesce(v_entry_a_id, v_entry_b_id)
            where id = v_target_match_id;
          else
            update public.tournament_matches
            set entry_b_id = coalesce(v_entry_a_id, v_entry_b_id)
            where id = v_target_match_id;
          end if;
        end if;
      end loop;
    end if;
  end if;

  update public.tournaments as tournament
  set
    status = 'active',
    current_phase = case
      when v_tournament.group_stage_enabled then 'group_stage'
      else 'winner_bracket'
    end,
    finished_at = null
  where tournament.id = p_tournament_id;

  return p_tournament_id;
end;
$$;

comment on function public.start_tournament(uuid) is
  'Atomically validates and starts a draft tournament, generating group round-robin matches or a seeded direct-knockout winner tree.';

revoke all on function public.start_tournament(uuid)
  from public, anon, authenticated;

grant execute on function public.start_tournament(uuid)
  to authenticated;

commit;
