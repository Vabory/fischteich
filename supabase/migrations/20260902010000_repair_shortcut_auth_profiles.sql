begin;

-- Repair legacy/orphaned Auth users that have no app_profiles row. This can
-- happen when an Auth user predates the profile trigger or the remote schema
-- temporarily drifted from the migration history.
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
left join public.app_profiles as profile on profile.user_id = app_user.id
where profile.user_id is null
on conflict (user_id) do nothing;

-- Recreate the existing lifecycle trigger idempotently so future anonymous
-- users always receive their matching profile in the signup transaction.
drop trigger if exists auth_users_create_app_profile on auth.users;
create trigger auth_users_create_app_profile
after insert on auth.users
for each row
execute function public.handle_new_app_user();

-- Authenticated users may only create or refresh their own non-admin profile.
-- The function never accepts a user id or role from the browser.
create function public.ensure_my_app_profile(p_display_name text)
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
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 24
  then
    raise exception using
      errcode = '22023',
      message = 'display_name must contain between 1 and 24 characters';
  end if;

  insert into public.app_profiles (user_id, display_name, app_role)
  values (v_user_id, v_display_name, 'user')
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    updated_at = pg_catalog.now()
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.ensure_my_app_profile(text)
  from public, anon, authenticated;
grant execute on function public.ensure_my_app_profile(text)
  to authenticated;

commit;
