begin;

-- The client request ID makes retries idempotent. This is especially important
-- when the database committed successfully but the browser lost the response.
alter table public.tournaments
  add column if not exists creation_request_id uuid;

create unique index if not exists tournaments_host_creation_request_key
  on public.tournaments (host_user_id, creation_request_id)
  where creation_request_id is not null;

comment on column public.tournaments.creation_request_id is
  'Client-generated idempotency key for atomic tournament draft creation.';

create or replace function public.create_tournament_draft(
  p_title text,
  p_tournament_type text,
  p_group_stage_enabled boolean,
  p_loser_bracket_enabled boolean,
  p_group_count smallint,
  p_advancers_per_group smallint,
  p_entries jsonb,
  p_creation_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_title text := pg_catalog.btrim(p_title);
  v_entry_count integer;
  v_tournament_id uuid;
  v_team_entry_id uuid;
  v_entry jsonb;
  v_member jsonb;
  v_entry_order bigint;
  v_member_order bigint;
  v_name text;
  v_source_participant_id text;
  v_source_participant_type text;
  v_source_user_id uuid;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  select profile.display_name
  into v_actor_name
  from public.app_profiles as profile
  where profile.user_id = v_actor_id;

  if v_actor_name is null then
    raise exception using
      errcode = '23503',
      message = 'No app profile exists for the authenticated user';
  end if;

  if p_creation_request_id is null then
    raise exception using
      errcode = '22023',
      message = 'creation_request_id is required';
  end if;

  if v_title is null
    or pg_catalog.char_length(v_title) not between 1 and 120
  then
    raise exception using
      errcode = '22023',
      message = 'title must contain between 1 and 120 characters';
  end if;

  if p_tournament_type is null
    or p_tournament_type not in ('individual', 'team')
  then
    raise exception using
      errcode = '22023',
      message = 'tournament_type must be individual or team';
  end if;

  if p_group_stage_enabled is null or p_loser_bracket_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'format toggles must not be null';
  end if;

  if p_entries is null or pg_catalog.jsonb_typeof(p_entries) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'entries must be a JSON array';
  end if;

  v_entry_count := pg_catalog.jsonb_array_length(p_entries);

  if v_entry_count < 2 then
    raise exception using
      errcode = '22023',
      message = 'at least two tournament entries are required';
  end if;

  if p_group_stage_enabled then
    if v_entry_count < 4 then
      raise exception using
        errcode = '22023',
        message = 'a group stage requires at least four entries';
    end if;

    if p_group_count is null
      or p_group_count < 2
      or p_group_count > (v_entry_count / 2)
    then
      raise exception using
        errcode = '22023',
        message = 'group_count must create at least two groups with at least two entries each';
    end if;

    if p_advancers_per_group is null
      or p_advancers_per_group < 1
      or p_advancers_per_group >= (v_entry_count / p_group_count)
    then
      raise exception using
        errcode = '22023',
        message = 'advancers_per_group must leave at least one entry eliminated in the smallest group';
    end if;
  elsif p_group_count is not null or p_advancers_per_group is not null then
    raise exception using
      errcode = '22023',
      message = 'direct knockout tournaments must not provide group settings';
  end if;

  -- Serialize identical requests before checking for an existing result. The
  -- unique index is an additional database-level guard against duplicates.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || p_creation_request_id::text,
      0
    )
  );

  select tournament.id
  into v_tournament_id
  from public.tournaments as tournament
  where tournament.host_user_id = v_actor_id
    and tournament.creation_request_id = p_creation_request_id;

  if found then
    return v_tournament_id;
  end if;

  insert into public.tournaments (
    title,
    tournament_type,
    status,
    host_user_id,
    host_display_name_snapshot,
    current_phase,
    group_stage_enabled,
    loser_bracket_enabled,
    group_count,
    advancers_per_group,
    config,
    creation_request_id
  )
  values (
    v_title,
    p_tournament_type,
    'draft',
    v_actor_id,
    v_actor_name,
    null,
    p_group_stage_enabled,
    p_loser_bracket_enabled,
    p_group_count,
    p_advancers_per_group,
    pg_catalog.jsonb_build_object('creation_source', 'tournament-wizard-v1'),
    p_creation_request_id
  )
  returning id into v_tournament_id;

  for v_entry, v_entry_order in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(p_entries) with ordinality as item(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_entry) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'every tournament entry must be a JSON object';
    end if;

    v_name := pg_catalog.btrim(v_entry ->> 'display_name_snapshot');

    if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80 then
      raise exception using
        errcode = '22023',
        message = 'every entry name must contain between 1 and 80 characters';
    end if;

    if p_tournament_type = 'individual' then
      v_source_participant_id := nullif(
        pg_catalog.btrim(v_entry ->> 'source_participant_id'),
        ''
      );
      v_source_participant_type := nullif(
        pg_catalog.btrim(v_entry ->> 'source_participant_type'),
        ''
      );

      if (v_source_participant_id is null) <> (v_source_participant_type is null) then
        raise exception using
          errcode = '22023',
          message = 'participant source ID and type must be provided together';
      end if;

      if v_source_participant_id is not null
        and pg_catalog.char_length(v_source_participant_id) > 100
      then
        raise exception using
          errcode = '22023',
          message = 'source_participant_id must not exceed 100 characters';
      end if;

      if v_source_participant_type is not null
        and v_source_participant_type not in ('friend', 'guest', 'user', 'imported')
      then
        raise exception using
          errcode = '22023',
          message = 'invalid source_participant_type';
      end if;

      if nullif(v_entry ->> 'source_user_id', '') is null then
        v_source_user_id := null;
      else
        v_source_user_id := (v_entry ->> 'source_user_id')::uuid;
      end if;

      insert into public.tournament_entries (
        tournament_id,
        entry_type,
        display_name_snapshot,
        source_participant_id,
        source_participant_type,
        source_user_id,
        sort_order
      )
      values (
        v_tournament_id,
        'individual',
        v_name,
        v_source_participant_id,
        v_source_participant_type,
        v_source_user_id,
        (v_entry_order - 1)::integer
      );
    else
      if not (v_entry ? 'members')
        or pg_catalog.jsonb_typeof(v_entry -> 'members') <> 'array'
        or pg_catalog.jsonb_array_length(v_entry -> 'members') < 1
      then
        raise exception using
          errcode = '22023',
          message = 'every team must contain at least one member';
      end if;

      insert into public.tournament_entries (
        tournament_id,
        entry_type,
        display_name_snapshot,
        sort_order
      )
      values (
        v_tournament_id,
        'team',
        v_name,
        (v_entry_order - 1)::integer
      )
      returning id into v_team_entry_id;

      for v_member, v_member_order in
        select item.value, item.ordinality
        from pg_catalog.jsonb_array_elements(v_entry -> 'members')
          with ordinality as item(value, ordinality)
      loop
        if pg_catalog.jsonb_typeof(v_member) <> 'object' then
          raise exception using
            errcode = '22023',
            message = 'every team member must be a JSON object';
        end if;

        v_name := pg_catalog.btrim(v_member ->> 'display_name_snapshot');
        v_source_participant_id := nullif(
          pg_catalog.btrim(v_member ->> 'source_participant_id'),
          ''
        );
        v_source_participant_type := nullif(
          pg_catalog.btrim(v_member ->> 'source_participant_type'),
          ''
        );

        if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80 then
          raise exception using
            errcode = '22023',
            message = 'every member name must contain between 1 and 80 characters';
        end if;

        if (v_source_participant_id is null) <> (v_source_participant_type is null) then
          raise exception using
            errcode = '22023',
            message = 'member source ID and type must be provided together';
        end if;

        if v_source_participant_id is not null
          and pg_catalog.char_length(v_source_participant_id) > 100
        then
          raise exception using
            errcode = '22023',
            message = 'member source_participant_id must not exceed 100 characters';
        end if;

        if v_source_participant_type is not null
          and v_source_participant_type not in ('friend', 'guest', 'user', 'imported')
        then
          raise exception using
            errcode = '22023',
            message = 'invalid member source_participant_type';
        end if;

        if nullif(v_member ->> 'source_user_id', '') is null then
          v_source_user_id := null;
        else
          v_source_user_id := (v_member ->> 'source_user_id')::uuid;
        end if;

        insert into public.tournament_team_members (
          tournament_id,
          team_entry_id,
          display_name_snapshot,
          source_participant_id,
          source_participant_type,
          source_user_id,
          member_order
        )
        values (
          v_tournament_id,
          v_team_entry_id,
          v_name,
          v_source_participant_id,
          v_source_participant_type,
          v_source_user_id,
          (v_member_order - 1)::integer
        );
      end loop;
    end if;
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
  smallint,
  jsonb,
  uuid
) is
  'Atomically creates an authenticated user-owned tournament draft, entries and optional team members.';

revoke all on function public.create_tournament_draft(
  text,
  text,
  boolean,
  boolean,
  smallint,
  smallint,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_tournament_draft(
  text,
  text,
  boolean,
  boolean,
  smallint,
  smallint,
  jsonb,
  uuid
) to authenticated;

commit;
