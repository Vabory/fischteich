# Buffalo Push Worker

This function sends only database-backed Buffalo push deliveries claimed from
the private outbox. It is invoked by Supabase Cron and requires the same random
worker secret in its Edge Function environment and in Supabase Vault.

Required Edge Function secrets:

- `BUFFALO_PUSH_VAPID_PUBLIC_KEY`
- `BUFFALO_PUSH_VAPID_PRIVATE_KEY`
- `BUFFALO_PUSH_VAPID_SUBJECT` (for example `mailto:admin@example.com`)
- `BUFFALO_PUSH_WORKER_SECRET`

The database additionally expects these named Vault entries:

- `buffalo_push_project_url`
- `buffalo_push_worker_secret`
- `buffalo_push_vapid_public_key`

Deploy with:

```sh
supabase functions deploy buffalo-push-worker --no-verify-jwt
```

JWT verification is disabled because Cron authenticates with the custom worker
secret. Requests without that secret are rejected, and request bodies cannot
provide notification payloads or recipients.
