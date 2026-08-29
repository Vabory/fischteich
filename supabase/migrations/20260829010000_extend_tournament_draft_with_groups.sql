begin;

-- Extends the atomic draft RPC with the explicit group structure chosen in the
-- wizard. The existing 8-argument RPC remains the single source for tournament,
-- entry and team-member creation; this overload participates in the same
-- transaction and adds groups only after validating the complete structure.
create or replace function public.create_tournament_draft(
  p_title text,
  p_tournament_type text,
  p_group_stage_enabled boolean,
  p_loser_bracket_enabled boolean,
  p_advancers_per_group smallint,
  p_entries jsonb,
  p_groups jsonb,
  p_creation_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_count integer;
  v_group_count integer;
  v_smallest_group_size integer := 2147483647;
  v_seen_indexes integer[] := '{}'::integer[];
  v_group jsonb;
  v_index_value jsonb;
  v_entry_index integer;
  v_tournament_id uuid;
  v_group_id uuid;
  v_entry_id uuid;
  v_group_order bigint;
  v_seed_order bigint;
  v_existing_group_count integer;
  v_label text;
begin
  if p_entries is null or pg_catalog.jsonb_typeof(p_entries) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'entries must be a JSON array';
  end if;

  v_entry_count := pg_catalog.jsonb_array_length(p_entries);

  if p_group_stage_enabled then
    if p_groups is null or pg_catalog.jsonb_typeof(p_groups) <> 'array' then
      raise exception using
        errcode = '22023',
        message = 'groups must be a JSON array when the group stage is enabled';
    end if;

    v_group_count := pg_catalog.jsonb_array_length(p_groups);

    if v_group_count < 2 then
      raise exception using
        errcode = '22023',
        message = 'a group stage requires at least two groups';
    end if;

    for v_group in
      select item.value
      from pg_catalog.jsonb_array_elements(p_groups) as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_group) <> 'object' then
        raise exception using
          errcode = '22023',
          message = 'every group must be a JSON object';
      end if;

      v_label := pg_catalog.btrim(v_group ->> 'label');

      if v_label is null or pg_catalog.char_length(v_label) not between 1 and 40 then
        raise exception using
          errcode = '22023',
          message = 'every group label must contain between 1 and 40 characters';
      end if;

      if not (v_group ? 'entry_indexes')
        or pg_catalog.jsonb_typeof(v_group -> 'entry_indexes') <> 'array'
        or pg_catalog.jsonb_array_length(v_group -> 'entry_indexes') < 2
      then
        raise exception using
          errcode = '22023',
          message = 'every group must contain at least two entries';
      end if;

      v_smallest_group_size := pg_catalog.least(
        v_smallest_group_size,
        pg_catalog.jsonb_array_length(v_group -> 'entry_indexes')
      );

      for v_index_value in
        select item.value
        from pg_catalog.jsonb_array_elements(v_group -> 'entry_indexes') as item(value)
      loop
        if pg_catalog.jsonb_typeof(v_index_value) <> 'number'
          or (v_index_value #>> '{}') !~ '^[0-9]+$'
        then
          raise exception using
            errcode = '22023',
            message = 'group entry indexes must be non-negative integers';
        end if;

        v_entry_index := (v_index_value #>> '{}')::integer;

        if v_entry_index < 0 or v_entry_index >= v_entry_count then
          raise exception using
            errcode = '22023',
            message = 'a group references an entry index outside the entries array';
        end if;

        if v_entry_index = any(v_seen_indexes) then
          raise exception using
            errcode = '22023',
            message = 'every tournament entry must belong to exactly one group';
        end if;

        v_seen_indexes := pg_catalog.array_append(v_seen_indexes, v_entry_index);
      end loop;
    end loop;

    if pg_catalog.cardinality(v_seen_indexes) <> v_entry_count then
      raise exception using
        errcode = '22023',
        message = 'every tournament entry must belong to exactly one group';
    end if;

    if p_advancers_per_group is null
      or p_advancers_per_group < 1
      or p_advancers_per_group >= v_smallest_group_size
    then
      raise exception using
        errcode = '22023',
        message = 'advancers_per_group must leave at least one entry eliminated in every group';
    end if;
  else
    if p_groups is not null or p_advancers_per_group is not null then
      raise exception using
        errcode = '22023',
        message = 'direct knockout tournaments must not provide groups or advancers_per_group';
    end if;

    v_group_count := null;
  end if;

  -- Function calls are not autonomous transactions in PostgreSQL. Any error in
  -- the group inserts below therefore rolls back this draft creation as well.
  v_tournament_id := public.create_tournament_draft(
    p_title,
    p_tournament_type,
    p_group_stage_enabled,
    p_loser_bracket_enabled,
    v_group_count::smallint,
    p_advancers_per_group,
    p_entries,
    p_creation_request_id
  );

  if not p_group_stage_enabled then
    return v_tournament_id;
  end if;

  select pg_catalog.count(*)::integer
  into v_existing_group_count
  from public.tournament_groups as tournament_group
  where tournament_group.tournament_id = v_tournament_id;

  -- An idempotent retry returns the already committed structure unchanged.
  if v_existing_group_count > 0 then
    return v_tournament_id;
  end if;

  for v_group, v_group_order in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(p_groups)
      with ordinality as item(value, ordinality)
  loop
    insert into public.tournament_groups (
      tournament_id,
      label,
      sort_order
    )
    values (
      v_tournament_id,
      pg_catalog.btrim(v_group ->> 'label'),
      (v_group_order - 1)::integer
    )
    returning id into v_group_id;

    for v_index_value, v_seed_order in
      select item.value, item.ordinality
      from pg_catalog.jsonb_array_elements(v_group -> 'entry_indexes')
        with ordinality as item(value, ordinality)
    loop
      v_entry_index := (v_index_value #>> '{}')::integer;

      select entry.id
      into v_entry_id
      from public.tournament_entries as entry
      where entry.tournament_id = v_tournament_id
        and entry.sort_order = v_entry_index;

      if v_entry_id is null then
        raise exception using
          errcode = '23503',
          message = 'group entry must belong to the newly created tournament';
      end if;

      insert into public.tournament_group_entries (
        tournament_id,
        group_id,
        entry_id,
        group_seed
      )
      values (
        v_tournament_id,
        v_group_id,
        v_entry_id,
        v_seed_order::integer
      );
    end loop;
  end loop;

  return v_tournament_id;
end;
$$;

comment on function public.create_tournament_draft(
  text,
  text,
  boolean,
  boolean,
  smallint,
  jsonb,
  jsonb,
  uuid
) is
  'Atomically creates a tournament draft, entries, optional team members, and the host-defined draft group structure.';

revoke all on function public.create_tournament_draft(
  text,
  text,
  boolean,
  boolean,
  smallint,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_tournament_draft(
  text,
  text,
  boolean,
  boolean,
  smallint,
  jsonb,
  jsonb,
  uuid
) to authenticated;

commit;
