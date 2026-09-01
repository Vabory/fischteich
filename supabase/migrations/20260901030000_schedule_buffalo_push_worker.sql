begin;

-- These Supabase-native extensions provide encrypted database secrets,
-- asynchronous HTTP invocation, and reliable sub-minute scheduling.
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function public.get_buffalo_push_public_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_public_key text;
begin
  select secret.decrypted_secret
  into v_public_key
  from vault.decrypted_secrets as secret
  where secret.name = 'buffalo_push_vapid_public_key'
  limit 1;

  if v_public_key is null or v_public_key = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Buffalo push public key is not configured';
  end if;
  return v_public_key;
end;
$$;

create function public.invoke_buffalo_push_worker()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_worker_secret text;
  v_request_id bigint;
begin
  select
    pg_catalog.max(secret.decrypted_secret) filter (
      where secret.name = 'buffalo_push_project_url'
    ),
    pg_catalog.max(secret.decrypted_secret) filter (
      where secret.name = 'buffalo_push_worker_secret'
    )
  into v_project_url, v_worker_secret
  from vault.decrypted_secrets as secret
  where secret.name in ('buffalo_push_project_url', 'buffalo_push_worker_secret');

  -- db push can safely run before manual secret provisioning. Cron becomes
  -- active automatically as soon as both Vault values exist.
  if v_project_url is null or v_worker_secret is null then
    return null;
  end if;

  select net.http_post(
    url := pg_catalog.rtrim(v_project_url, '/') || '/functions/v1/buffalo-push-worker',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-buffalo-worker-secret', v_worker_secret
    ),
    body := pg_catalog.jsonb_build_object('source', 'buffalo-push-cron'),
    timeout_milliseconds := 8000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.get_buffalo_push_public_key()
  from public, anon, authenticated;
grant execute on function public.get_buffalo_push_public_key()
  to anon, authenticated;

revoke all on function public.invoke_buffalo_push_worker()
  from public, anon, authenticated, service_role;

-- Supabase Cron supports second-based intervals on current hosted Postgres
-- versions. Ten seconds keeps END notifications independent of every client.
select cron.schedule(
  'buffalo-push-worker-every-10-seconds',
  '10 seconds',
  'select public.invoke_buffalo_push_worker();'
);

commit;
