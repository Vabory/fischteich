begin;

-- Tournament ownership and administration must be tied to a server-verifiable
-- Supabase Auth identity. The existing browser-local device UUID remains useful
-- for the current app, but is intentionally not trusted for RLS decisions.
create table public.app_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  app_role text not null default 'user',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint app_profiles_display_name_valid check (
    display_name = pg_catalog.btrim(display_name)
    and pg_catalog.char_length(display_name) between 1 and 24
  ),
  constraint app_profiles_role_valid check (app_role in ('user', 'admin'))
);

comment on table public.app_profiles is
  'Server-verifiable app identity and role for authenticated Supabase users.';
comment on column public.app_profiles.app_role is
  'Assigned only by trusted database/service-role administration; never inferred in the browser.';

create index app_profiles_admin_role_idx
  on public.app_profiles (app_role)
  where app_role = 'admin';

create function public.set_tournament_updated_at()
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

create function public.handle_new_app_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      'Fisch'
    ),
    24
  );

  insert into public.app_profiles (user_id, display_name)
  values (new.id, v_display_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

insert into public.app_profiles (user_id, display_name)
select
  app_user.id,
  pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(app_user.raw_user_meta_data ->> 'display_name'), ''),
      nullif(pg_catalog.btrim(app_user.raw_user_meta_data ->> 'full_name'), ''),
      'Fisch'
    ),
    24
  )
from auth.users as app_user
on conflict (user_id) do nothing;

create trigger app_profiles_set_updated_at
before update on public.app_profiles
for each row
execute function public.set_tournament_updated_at();

create trigger auth_users_create_app_profile
after insert on auth.users
for each row
execute function public.handle_new_app_user();

create function public.is_tournament_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.app_role = 'admin'
  );
$$;

create function public.update_my_app_profile_display_name(p_display_name text)
returns public.app_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := pg_catalog.btrim(p_display_name);
  v_profile public.app_profiles;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  if v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 24
  then
    raise exception using
      errcode = '22023',
      message = 'display_name must contain between 1 and 24 characters';
  end if;

  update public.app_profiles as profile
  set display_name = v_display_name
  where profile.user_id = v_user_id
  returning * into v_profile;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'No app profile exists for the authenticated user';
  end if;

  return v_profile;
end;
$$;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  tournament_type text not null,
  status text not null default 'draft',
  host_user_id uuid not null references public.app_profiles (user_id) on delete restrict,
  host_display_name_snapshot text not null,
  current_phase text,
  group_stage_enabled boolean not null default false,
  loser_bracket_enabled boolean not null default false,
  group_count smallint,
  advancers_per_group smallint,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  started_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.app_profiles (user_id) on delete restrict,
  deleted_by_display_name_snapshot text,
  delete_reason text,
  constraint tournaments_title_valid check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 120
  ),
  constraint tournaments_type_valid check (
    tournament_type in ('individual', 'team')
  ),
  constraint tournaments_status_valid check (
    status in ('draft', 'active', 'finished')
  ),
  constraint tournaments_host_name_snapshot_valid check (
    host_display_name_snapshot = pg_catalog.btrim(host_display_name_snapshot)
    and pg_catalog.char_length(host_display_name_snapshot) between 1 and 24
  ),
  constraint tournaments_current_phase_valid check (
    current_phase is null
    or (
      current_phase = pg_catalog.btrim(current_phase)
      and pg_catalog.char_length(current_phase) between 1 and 80
    )
  ),
  constraint tournaments_group_count_valid check (
    group_count is null or group_count > 0
  ),
  constraint tournaments_advancers_per_group_valid check (
    advancers_per_group is null or advancers_per_group > 0
  ),
  constraint tournaments_group_settings_consistent check (
    group_stage_enabled
    or (group_count is null and advancers_per_group is null)
  ),
  constraint tournaments_started_settings_complete check (
    status = 'draft'
    or not group_stage_enabled
    or (group_count is not null and advancers_per_group is not null)
  ),
  constraint tournaments_config_object check (
    jsonb_typeof(config) = 'object'
  ),
  constraint tournaments_status_timestamps_consistent check (
    (status = 'draft' and started_at is null and finished_at is null)
    or (status = 'active' and started_at is not null and finished_at is null)
    or (status = 'finished' and started_at is not null and finished_at is not null)
  ),
  constraint tournaments_deleted_metadata_consistent check (
    (
      deleted_at is null
      and deleted_by is null
      and deleted_by_display_name_snapshot is null
      and delete_reason is null
    )
    or (
      deleted_at is not null
      and deleted_by is not null
      and deleted_by_display_name_snapshot is not null
    )
  ),
  constraint tournaments_deleted_by_snapshot_valid check (
    deleted_by_display_name_snapshot is null
    or (
      deleted_by_display_name_snapshot = pg_catalog.btrim(deleted_by_display_name_snapshot)
      and pg_catalog.char_length(deleted_by_display_name_snapshot) between 1 and 24
    )
  ),
  constraint tournaments_delete_reason_valid check (
    delete_reason is null
    or (
      delete_reason = pg_catalog.btrim(delete_reason)
      and pg_catalog.char_length(delete_reason) between 1 and 500
    )
  )
);

comment on table public.tournaments is
  'Tournament aggregate root. deleted_at is independent from lifecycle status.';
comment on column public.tournaments.config is
  'Extensible settings only; frequently queried tournament options use dedicated columns.';

create index tournaments_visible_status_created_idx
  on public.tournaments (status, created_at desc)
  where deleted_at is null;
create index tournaments_host_created_idx
  on public.tournaments (host_user_id, created_at desc);
create index tournaments_deleted_at_idx
  on public.tournaments (deleted_at desc)
  where deleted_at is not null;

create function public.prepare_tournament_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_host_name text;
  v_actor_is_admin boolean := public.is_tournament_admin();
begin
  if tg_op = 'INSERT' then
    select profile.display_name
    into v_host_name
    from public.app_profiles as profile
    where profile.user_id = new.host_user_id;

    if v_host_name is null then
      raise exception using
        errcode = '23503',
        message = 'The tournament host must have an app profile';
    end if;

    new.host_display_name_snapshot := v_host_name;
  else
    new.host_user_id := old.host_user_id;
    new.host_display_name_snapshot := old.host_display_name_snapshot;

    if new.tournament_type is distinct from old.tournament_type
      and exists (
        select 1
        from public.tournament_entries as entry
        where entry.tournament_id = old.id
      )
    then
      raise exception using
        errcode = '23514',
        message = 'Tournament type cannot change after entries have been created';
    end if;

    if new.status is distinct from old.status
      and v_actor_id is not null
      and not v_actor_is_admin
      and not (
        (old.status = 'draft' and new.status = 'active')
        or (old.status = 'active' and new.status = 'finished')
      )
    then
      raise exception using
        errcode = '42501',
        message = 'Hosts may only advance draft to active and active to finished';
    end if;
  end if;

  if new.status = 'draft' then
    new.started_at := null;
    new.finished_at := null;
  elsif new.status = 'active' then
    if tg_op = 'INSERT' then
      new.started_at := pg_catalog.clock_timestamp();
    else
      if old.started_at is null then
        new.started_at := pg_catalog.clock_timestamp();
      elsif v_actor_id is not null and not v_actor_is_admin then
        new.started_at := old.started_at;
      end if;
    end if;
    new.finished_at := null;
  else
    if tg_op = 'INSERT' then
      new.started_at := pg_catalog.clock_timestamp();
      new.finished_at := pg_catalog.clock_timestamp();
    else
      if old.started_at is null then
        new.started_at := pg_catalog.clock_timestamp();
      elsif v_actor_id is not null and not v_actor_is_admin then
        new.started_at := old.started_at;
      end if;

      if old.status <> 'finished' then
        new.finished_at := pg_catalog.clock_timestamp();
      elsif v_actor_id is not null and not v_actor_is_admin then
        new.finished_at := old.finished_at;
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.deleted_at := null;
    new.deleted_by := null;
    new.deleted_by_display_name_snapshot := null;
    new.delete_reason := null;
  else
    if old.deleted_at is null and new.deleted_at is not null then
      if v_actor_id is not null then
        new.deleted_by := v_actor_id;
      elsif new.deleted_by is null then
        raise exception using
          errcode = '23502',
          message = 'A trusted database soft delete must provide deleted_by';
      end if;

      select profile.display_name
      into v_actor_name
      from public.app_profiles as profile
      where profile.user_id = new.deleted_by;

      if v_actor_name is null then
        raise exception using
          errcode = '23503',
          message = 'The deleting user must have an app profile';
      end if;

      new.deleted_at := pg_catalog.clock_timestamp();
      new.deleted_by_display_name_snapshot := v_actor_name;
    elsif old.deleted_at is not null and new.deleted_at is null then
      if v_actor_id is not null and not v_actor_is_admin then
        raise exception using
          errcode = '42501',
          message = 'Only an admin may restore a soft-deleted tournament';
      end if;

      new.deleted_by := null;
      new.deleted_by_display_name_snapshot := null;
      new.delete_reason := null;
    elsif new.deleted_at is null then
      new.deleted_by := null;
      new.deleted_by_display_name_snapshot := null;
      new.delete_reason := null;
    else
      new.deleted_at := old.deleted_at;
      new.deleted_by := old.deleted_by;
      new.deleted_by_display_name_snapshot := old.deleted_by_display_name_snapshot;
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger tournaments_prepare_write
before insert or update on public.tournaments
for each row
execute function public.prepare_tournament_write();

create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  entry_type text not null,
  display_name_snapshot text not null,
  source_participant_id text,
  source_participant_type text,
  source_user_id uuid references public.app_profiles (user_id) on delete set null,
  seed integer,
  sort_order integer not null,
  entry_status text not null default 'active',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint tournament_entries_tournament_id_id_key unique (tournament_id, id),
  constraint tournament_entries_sort_order_key unique (tournament_id, sort_order),
  constraint tournament_entries_type_valid check (entry_type in ('individual', 'team')),
  constraint tournament_entries_name_snapshot_valid check (
    display_name_snapshot = pg_catalog.btrim(display_name_snapshot)
    and pg_catalog.char_length(display_name_snapshot) between 1 and 80
  ),
  constraint tournament_entries_source_id_valid check (
    source_participant_id is null
    or (
      source_participant_id = pg_catalog.btrim(source_participant_id)
      and pg_catalog.char_length(source_participant_id) between 1 and 100
    )
  ),
  constraint tournament_entries_source_type_valid check (
    source_participant_type is null
    or source_participant_type in ('friend', 'guest', 'user', 'imported')
  ),
  constraint tournament_entries_source_pair_consistent check (
    (source_participant_id is null) = (source_participant_type is null)
  ),
  constraint tournament_entries_team_source_consistent check (
    entry_type = 'individual'
    or (
      source_participant_id is null
      and source_participant_type is null
      and source_user_id is null
    )
  ),
  constraint tournament_entries_seed_valid check (seed is null or seed > 0),
  constraint tournament_entries_sort_order_valid check (sort_order >= 0),
  constraint tournament_entries_status_valid check (
    entry_status in ('active', 'withdrawn', 'disqualified')
  )
);

comment on table public.tournament_entries is
  'One competitive unit: a person in individual mode or a complete team in team mode.';
comment on column public.tournament_entries.source_participant_id is
  'Optional provenance such as friend-1 or guest-1; the name snapshot is authoritative historically.';

create index tournament_entries_tournament_idx
  on public.tournament_entries (tournament_id, entry_status, sort_order);
create index tournament_entries_source_participant_idx
  on public.tournament_entries (source_participant_type, source_participant_id)
  where source_participant_id is not null;
create unique index tournament_entries_source_participant_key
  on public.tournament_entries (
    tournament_id,
    source_participant_type,
    source_participant_id
  )
  where source_participant_id is not null;
create unique index tournament_entries_source_user_key
  on public.tournament_entries (tournament_id, source_user_id)
  where source_user_id is not null;

create function public.validate_tournament_entry_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_type text;
begin
  select tournament.tournament_type
  into v_tournament_type
  from public.tournaments as tournament
  where tournament.id = new.tournament_id;

  if v_tournament_type is null then
    raise exception using
      errcode = '23503',
      message = 'Tournament does not exist';
  end if;

  if new.entry_type <> v_tournament_type then
    raise exception using
      errcode = '23514',
      message = 'Entry type must match tournament type';
  end if;

  return new;
end;
$$;

create trigger tournament_entries_validate_type
before insert or update of tournament_id, entry_type on public.tournament_entries
for each row
execute function public.validate_tournament_entry_type();

create trigger tournament_entries_set_updated_at
before update on public.tournament_entries
for each row
execute function public.set_tournament_updated_at();

create table public.tournament_team_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  team_entry_id uuid not null,
  display_name_snapshot text not null,
  source_participant_id text,
  source_participant_type text,
  source_user_id uuid references public.app_profiles (user_id) on delete set null,
  member_order integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint tournament_team_members_entry_fk foreign key (tournament_id, team_entry_id)
    references public.tournament_entries (tournament_id, id) on delete cascade,
  constraint tournament_team_members_order_key unique (team_entry_id, member_order),
  constraint tournament_team_members_name_snapshot_valid check (
    display_name_snapshot = pg_catalog.btrim(display_name_snapshot)
    and pg_catalog.char_length(display_name_snapshot) between 1 and 80
  ),
  constraint tournament_team_members_source_id_valid check (
    source_participant_id is null
    or (
      source_participant_id = pg_catalog.btrim(source_participant_id)
      and pg_catalog.char_length(source_participant_id) between 1 and 100
    )
  ),
  constraint tournament_team_members_source_type_valid check (
    source_participant_type is null
    or source_participant_type in ('friend', 'guest', 'user', 'imported')
  ),
  constraint tournament_team_members_source_pair_consistent check (
    (source_participant_id is null) = (source_participant_type is null)
  ),
  constraint tournament_team_members_order_valid check (member_order >= 0)
);

comment on table public.tournament_team_members is
  'Historical member snapshots for entries in team tournaments; members are not match opponents themselves.';

create index tournament_team_members_tournament_idx
  on public.tournament_team_members (tournament_id, team_entry_id, member_order);
create unique index tournament_team_members_source_participant_key
  on public.tournament_team_members (
    tournament_id,
    source_participant_type,
    source_participant_id
  )
  where source_participant_id is not null;
create unique index tournament_team_members_source_user_key
  on public.tournament_team_members (tournament_id, source_user_id)
  where source_user_id is not null;

create function public.validate_tournament_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tournament_entries as entry
    where entry.tournament_id = new.tournament_id
      and entry.id = new.team_entry_id
      and entry.entry_type = 'team'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Team members may only reference a team entry in the same tournament';
  end if;

  return new;
end;
$$;

create trigger tournament_team_members_validate_entry
before insert or update of tournament_id, team_entry_id on public.tournament_team_members
for each row
execute function public.validate_tournament_team_member();

create table public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  label text not null,
  sort_order integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint tournament_groups_tournament_id_id_key unique (tournament_id, id),
  constraint tournament_groups_label_key unique (tournament_id, label),
  constraint tournament_groups_sort_order_key unique (tournament_id, sort_order),
  constraint tournament_groups_label_valid check (
    label = pg_catalog.btrim(label)
    and pg_catalog.char_length(label) between 1 and 40
  ),
  constraint tournament_groups_sort_order_valid check (sort_order >= 0)
);

create index tournament_groups_tournament_idx
  on public.tournament_groups (tournament_id, sort_order);

create trigger tournament_groups_set_updated_at
before update on public.tournament_groups
for each row
execute function public.set_tournament_updated_at();

create table public.tournament_group_entries (
  tournament_id uuid not null,
  group_id uuid not null,
  entry_id uuid not null,
  group_seed integer,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (group_id, entry_id),
  constraint tournament_group_entries_one_group_key unique (tournament_id, entry_id),
  constraint tournament_group_entries_group_fk foreign key (tournament_id, group_id)
    references public.tournament_groups (tournament_id, id) on delete cascade,
  constraint tournament_group_entries_entry_fk foreign key (tournament_id, entry_id)
    references public.tournament_entries (tournament_id, id) on delete cascade,
  constraint tournament_group_entries_seed_valid check (
    group_seed is null or group_seed > 0
  )
);

create index tournament_group_entries_tournament_group_idx
  on public.tournament_group_entries (tournament_id, group_id, group_seed);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  stage text not null,
  phase_label text,
  group_id uuid,
  entry_a_id uuid,
  entry_b_id uuid,
  score_a numeric(14, 4),
  score_b numeric(14, 4),
  winner_entry_id uuid,
  match_status text not null default 'scheduled',
  round_number integer not null,
  match_order integer not null,
  is_tiebreaker boolean not null default false,
  winner_advances_to_match_id uuid,
  winner_advances_to_slot text,
  loser_advances_to_match_id uuid,
  loser_advances_to_slot text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint tournament_matches_tournament_id_id_key unique (tournament_id, id),
  constraint tournament_matches_order_key unique (
    tournament_id,
    stage,
    round_number,
    match_order
  ),
  constraint tournament_matches_group_fk foreign key (tournament_id, group_id)
    references public.tournament_groups (tournament_id, id) on delete cascade,
  constraint tournament_matches_entry_a_fk foreign key (tournament_id, entry_a_id)
    references public.tournament_entries (tournament_id, id)
    on delete no action deferrable initially deferred,
  constraint tournament_matches_entry_b_fk foreign key (tournament_id, entry_b_id)
    references public.tournament_entries (tournament_id, id)
    on delete no action deferrable initially deferred,
  constraint tournament_matches_winner_fk foreign key (tournament_id, winner_entry_id)
    references public.tournament_entries (tournament_id, id)
    on delete no action deferrable initially deferred,
  constraint tournament_matches_stage_valid check (
    stage in ('group', 'winner_bracket', 'loser_bracket', 'placement', 'final')
  ),
  constraint tournament_matches_phase_label_valid check (
    phase_label is null
    or (
      phase_label = pg_catalog.btrim(phase_label)
      and pg_catalog.char_length(phase_label) between 1 and 80
    )
  ),
  constraint tournament_matches_group_consistent check (
    (stage = 'group' and group_id is not null)
    or (stage <> 'group' and group_id is null)
  ),
  constraint tournament_matches_tiebreaker_consistent check (
    not is_tiebreaker or stage = 'group'
  ),
  constraint tournament_matches_score_a_valid check (score_a is null or score_a >= 0),
  constraint tournament_matches_score_b_valid check (score_b is null or score_b >= 0),
  constraint tournament_matches_winner_is_competitor check (
    winner_entry_id is null
    or winner_entry_id = entry_a_id
    or winner_entry_id = entry_b_id
  ),
  constraint tournament_matches_status_valid check (
    match_status in ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  constraint tournament_matches_round_valid check (round_number > 0),
  constraint tournament_matches_order_valid check (match_order >= 0),
  constraint tournament_matches_completed_result_valid check (
    match_status <> 'completed'
    or (
      entry_a_id is not null
      and entry_b_id is not null
      and score_a is not null
      and score_b is not null
      and completed_at is not null
      and (
        (score_a = score_b and winner_entry_id is null)
        or (score_a <> score_b and winner_entry_id is not null)
      )
    )
  ),
  constraint tournament_matches_unfinished_winner_valid check (
    match_status = 'completed' or winner_entry_id is null
  ),
  constraint tournament_matches_winner_route_consistent check (
    (winner_advances_to_match_id is null) = (winner_advances_to_slot is null)
    and winner_advances_to_slot in ('a', 'b')
  ),
  constraint tournament_matches_loser_route_consistent check (
    (loser_advances_to_match_id is null) = (loser_advances_to_slot is null)
    and loser_advances_to_slot in ('a', 'b')
  ),
  constraint tournament_matches_winner_route_not_self check (
    winner_advances_to_match_id is null or winner_advances_to_match_id <> id
  ),
  constraint tournament_matches_loser_route_not_self check (
    loser_advances_to_match_id is null or loser_advances_to_match_id <> id
  )
);

alter table public.tournament_matches
  add constraint tournament_matches_winner_route_fk
    foreign key (tournament_id, winner_advances_to_match_id)
    references public.tournament_matches (tournament_id, id)
    on delete no action deferrable initially deferred,
  add constraint tournament_matches_loser_route_fk
    foreign key (tournament_id, loser_advances_to_match_id)
    references public.tournament_matches (tournament_id, id)
    on delete no action deferrable initially deferred;

comment on table public.tournament_matches is
  'Generic numeric results for group, winner bracket, loser bracket, placement, and final matches.';

create index tournament_matches_tournament_stage_round_idx
  on public.tournament_matches (tournament_id, stage, round_number, match_order);
create index tournament_matches_tournament_status_idx
  on public.tournament_matches (tournament_id, match_status);
create index tournament_matches_group_idx
  on public.tournament_matches (group_id, round_number, match_order)
  where group_id is not null;

create function public.prepare_tournament_match_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage = 'group' then
    if new.entry_a_id is not null and not exists (
      select 1
      from public.tournament_group_entries as group_entry
      where group_entry.tournament_id = new.tournament_id
        and group_entry.group_id = new.group_id
        and group_entry.entry_id = new.entry_a_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'entry_a must belong to the match group';
    end if;

    if new.entry_b_id is not null and not exists (
      select 1
      from public.tournament_group_entries as group_entry
      where group_entry.tournament_id = new.tournament_id
        and group_entry.group_id = new.group_id
        and group_entry.entry_id = new.entry_b_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'entry_b must belong to the match group';
    end if;
  end if;

  if new.match_status in ('in_progress', 'completed') and new.started_at is null then
    new.started_at := pg_catalog.clock_timestamp();
  end if;

  if new.match_status = 'completed' and new.completed_at is null then
    new.completed_at := pg_catalog.clock_timestamp();
  elsif new.match_status <> 'completed' then
    new.completed_at := null;
    new.winner_entry_id := null;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger tournament_matches_prepare_write
before insert or update on public.tournament_matches
for each row
execute function public.prepare_tournament_match_write();

create table public.tournament_placements (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  entry_id uuid not null,
  placement integer not null,
  display_name_snapshot text not null,
  stats_snapshot jsonb not null default '{}'::jsonb,
  awarded_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  constraint tournament_placements_entry_fk foreign key (tournament_id, entry_id)
    references public.tournament_entries (tournament_id, id)
    on delete no action deferrable initially deferred,
  constraint tournament_placements_place_key unique (tournament_id, placement),
  constraint tournament_placements_entry_key unique (tournament_id, entry_id),
  constraint tournament_placements_place_valid check (placement > 0),
  constraint tournament_placements_name_snapshot_valid check (
    display_name_snapshot = pg_catalog.btrim(display_name_snapshot)
    and pg_catalog.char_length(display_name_snapshot) between 1 and 80
  ),
  constraint tournament_placements_stats_object check (
    jsonb_typeof(stats_snapshot) = 'object'
  )
);

comment on table public.tournament_placements is
  'Stable finish-time placement and derived-stat snapshot for historical summaries.';

create index tournament_placements_tournament_place_idx
  on public.tournament_placements (tournament_id, placement);

create function public.prepare_tournament_placement_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_name text;
begin
  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = new.tournament_id
      and tournament.status = 'finished'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Placements may only be stored for a finished tournament';
  end if;

  if tg_op = 'INSERT' then
    select entry.display_name_snapshot
    into v_entry_name
    from public.tournament_entries as entry
    where entry.tournament_id = new.tournament_id
      and entry.id = new.entry_id;

    if v_entry_name is null then
      raise exception using
        errcode = '23503',
        message = 'Placement entry must belong to the tournament';
    end if;

    new.display_name_snapshot := v_entry_name;
  else
    if new.entry_id is distinct from old.entry_id then
      select entry.display_name_snapshot
      into v_entry_name
      from public.tournament_entries as entry
      where entry.tournament_id = new.tournament_id
        and entry.id = new.entry_id;

      if v_entry_name is null then
        raise exception using
          errcode = '23503',
          message = 'Placement entry must belong to the tournament';
      end if;

      new.display_name_snapshot := v_entry_name;
    else
      new.display_name_snapshot := old.display_name_snapshot;
    end if;
  end if;

  return new;
end;
$$;

create trigger tournament_placements_prepare_write
before insert or update on public.tournament_placements
for each row
execute function public.prepare_tournament_placement_write();

create function public.can_view_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and (
        public.is_tournament_admin()
        or (
          tournament.deleted_at is null
          and (
            tournament.status in ('active', 'finished')
            or tournament.host_user_id = (select auth.uid())
          )
        )
      )
  );
$$;

create function public.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = p_tournament_id
      and (
        public.is_tournament_admin()
        or (
          tournament.host_user_id = (select auth.uid())
          and tournament.deleted_at is null
        )
      )
  );
$$;

alter table public.app_profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_team_members enable row level security;
alter table public.tournament_groups enable row level security;
alter table public.tournament_group_entries enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_placements enable row level security;

create policy app_profiles_read_own_or_admin
on public.app_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.is_tournament_admin()
);

create policy tournaments_read_visible
on public.tournaments
for select
to authenticated
using (public.can_view_tournament(id));

create policy tournaments_create_as_host
on public.tournaments
for insert
to authenticated
with check (
  host_user_id = (select auth.uid())
  and status = 'draft'
  and deleted_at is null
);

create policy tournaments_update_as_host_or_admin
on public.tournaments
for update
to authenticated
using (
  public.is_tournament_admin()
  or (
    host_user_id = (select auth.uid())
    and deleted_at is null
  )
)
with check (
  public.is_tournament_admin()
  or host_user_id = (select auth.uid())
);

create policy tournaments_hard_delete_as_admin
on public.tournaments
for delete
to authenticated
using (
  public.is_tournament_admin()
  and deleted_at is not null
);

create policy tournament_entries_read_visible
on public.tournament_entries
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_entries_manage_as_host_or_admin
on public.tournament_entries
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

create policy tournament_team_members_read_visible
on public.tournament_team_members
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_team_members_manage_as_host_or_admin
on public.tournament_team_members
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

create policy tournament_groups_read_visible
on public.tournament_groups
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_groups_manage_as_host_or_admin
on public.tournament_groups
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

create policy tournament_group_entries_read_visible
on public.tournament_group_entries
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_group_entries_manage_as_host_or_admin
on public.tournament_group_entries
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

create policy tournament_matches_read_visible
on public.tournament_matches
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_matches_manage_as_host_or_admin
on public.tournament_matches
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

create policy tournament_placements_read_visible
on public.tournament_placements
for select
to authenticated
using (public.can_view_tournament(tournament_id));

create policy tournament_placements_manage_as_host_or_admin
on public.tournament_placements
for all
to authenticated
using (public.can_manage_tournament(tournament_id))
with check (public.can_manage_tournament(tournament_id));

revoke all on table public.app_profiles from public, anon, authenticated;
revoke all on table public.tournaments from public, anon, authenticated;
revoke all on table public.tournament_entries from public, anon, authenticated;
revoke all on table public.tournament_team_members from public, anon, authenticated;
revoke all on table public.tournament_groups from public, anon, authenticated;
revoke all on table public.tournament_group_entries from public, anon, authenticated;
revoke all on table public.tournament_matches from public, anon, authenticated;
revoke all on table public.tournament_placements from public, anon, authenticated;

grant select on table public.app_profiles to authenticated;
grant select, insert, update, delete on table public.tournaments to authenticated;
grant select, insert, update, delete on table public.tournament_entries to authenticated;
grant select, insert, update, delete on table public.tournament_team_members to authenticated;
grant select, insert, update, delete on table public.tournament_groups to authenticated;
grant select, insert, update, delete on table public.tournament_group_entries to authenticated;
grant select, insert, update, delete on table public.tournament_matches to authenticated;
grant select, insert, update, delete on table public.tournament_placements to authenticated;

revoke all on function public.set_tournament_updated_at()
  from public, anon, authenticated;
revoke all on function public.handle_new_app_user()
  from public, anon, authenticated;
revoke all on function public.is_tournament_admin()
  from public, anon, authenticated;
revoke all on function public.update_my_app_profile_display_name(text)
  from public, anon, authenticated;
revoke all on function public.prepare_tournament_write()
  from public, anon, authenticated;
revoke all on function public.validate_tournament_entry_type()
  from public, anon, authenticated;
revoke all on function public.validate_tournament_team_member()
  from public, anon, authenticated;
revoke all on function public.prepare_tournament_match_write()
  from public, anon, authenticated;
revoke all on function public.prepare_tournament_placement_write()
  from public, anon, authenticated;
revoke all on function public.can_view_tournament(uuid)
  from public, anon, authenticated;
revoke all on function public.can_manage_tournament(uuid)
  from public, anon, authenticated;

grant execute on function public.is_tournament_admin()
  to authenticated;
grant execute on function public.update_my_app_profile_display_name(text)
  to authenticated;
grant execute on function public.can_view_tournament(uuid)
  to authenticated;
grant execute on function public.can_manage_tournament(uuid)
  to authenticated;

commit;
