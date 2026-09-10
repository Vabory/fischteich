create or replace function public.unlock_mystical_bobr()
returns public.app_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.app_profiles;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'An authenticated user is required';
  end if;

  update public.app_profiles as profile
  set
    bobr_unlocked = true,
    bobr_unlocked_at = coalesce(profile.bobr_unlocked_at, pg_catalog.now())
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
