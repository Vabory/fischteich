begin;

-- The buffalo-shortcut Edge Function uses a service-role Supabase client for
-- these direct PostgREST table operations. Keep the grants limited to the
-- operations performed by that function; RLS and all existing policies stay
-- unchanged.
grant select on table public.app_profiles to service_role;
grant select, insert, update on table public.buffalo_shortcut_devices to service_role;
grant select on table public.buffalo_shortcut_targets to service_role;

commit;
