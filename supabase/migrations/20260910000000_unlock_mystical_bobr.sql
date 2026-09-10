begin;

alter table public.app_profiles
  add column bobr_unlocked boolean not null default false,
  add column bobr_unlocked_at timestamptz;

comment on column public.app_profiles.bobr_unlocked is
  'Authoritative one-way unlock for the Mystical Bobr Easter egg.';
comment on column public.app_profiles.bobr_unlocked_at is
  'Timestamp of the first successful Mystical Bobr unlock.';

create function public.unlock_mystical_bobr()
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
    bobr_unlocked_at = pg_catalog.coalesce(profile.bobr_unlocked_at, pg_catalog.now())
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

revoke all on function public.unlock_mystical_bobr() from public, anon;
grant execute on function public.unlock_mystical_bobr() to authenticated;

commit;
