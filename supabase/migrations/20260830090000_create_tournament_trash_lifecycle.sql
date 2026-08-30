begin;

drop policy if exists tournaments_hard_delete_as_admin on public.tournaments;

create function public.can_soft_delete_tournament(p_tournament_id uuid)
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
        or tournament.host_user_id = (select auth.uid())
      )
  );
$$;

comment on function public.can_soft_delete_tournament(uuid) is
  'Separately authorizes tournament soft deletion for the owning host or an admin, including finished tournaments.';

create function public.soft_delete_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to delete a tournament';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Tournament not found';
  end if;

  if not (
    public.is_tournament_admin()
    or v_tournament.host_user_id = v_actor_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only the tournament host or an admin may delete this tournament';
  end if;

  if v_tournament.deleted_at is null then
    update public.tournaments as tournament
    set deleted_at = pg_catalog.clock_timestamp()
    where tournament.id = p_tournament_id;
  end if;

  return p_tournament_id;
end;
$$;

comment on function public.soft_delete_tournament(uuid) is
  'Idempotently soft-deletes a tournament owned by the caller, or any tournament for an admin. Dependent rows remain untouched.';

create function public.restore_tournament(p_tournament_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_deleted_at timestamptz;
begin
  if v_actor_id is null or not public.is_tournament_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only an admin may restore a tournament';
  end if;

  select tournament.deleted_at
  into v_deleted_at
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Tournament not found';
  end if;

  if v_deleted_at is not null then
    update public.tournaments as tournament
    set deleted_at = null
    where tournament.id = p_tournament_id;
  end if;

  return p_tournament_id;
end;
$$;

comment on function public.restore_tournament(uuid) is
  'Idempotently restores a soft-deleted tournament for admins without changing lifecycle state or dependent data.';

create function public.get_tournament_trash()
returns table (
  id uuid,
  title text,
  tournament_type text,
  status text,
  current_phase text,
  host_display_name_snapshot text,
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz,
  deleted_by_display_name_snapshot text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_tournament_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only an admin may view the tournament trash';
  end if;

  return query
  select
    tournament.id,
    tournament.title,
    tournament.tournament_type,
    tournament.status,
    tournament.current_phase,
    tournament.host_display_name_snapshot,
    tournament.created_at,
    tournament.started_at,
    tournament.finished_at,
    tournament.deleted_at,
    tournament.deleted_by_display_name_snapshot
  from public.tournaments as tournament
  where tournament.deleted_at is not null
  order by tournament.deleted_at desc;
end;
$$;

comment on function public.get_tournament_trash() is
  'Returns compact metadata for all soft-deleted tournaments, newest deletion first, exclusively to admins.';

revoke all on function public.can_soft_delete_tournament(uuid) from public, anon, authenticated;
revoke all on function public.soft_delete_tournament(uuid) from public, anon, authenticated;
revoke all on function public.restore_tournament(uuid) from public, anon, authenticated;
revoke all on function public.get_tournament_trash() from public, anon, authenticated;

grant execute on function public.can_soft_delete_tournament(uuid) to authenticated;
grant execute on function public.soft_delete_tournament(uuid) to authenticated;
grant execute on function public.restore_tournament(uuid) to authenticated;
grant execute on function public.get_tournament_trash() to authenticated;

commit;
