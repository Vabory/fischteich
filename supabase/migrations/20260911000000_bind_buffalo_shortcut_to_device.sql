begin;

alter table public.buffalo_shortcut_devices
  add column device_management_key_hash text,
  add column device_management_key_bound_at timestamptz,
  add column last_authenticated_user_id uuid references auth.users (id) on delete set null,
  add column last_authenticated_at timestamptz,
  add constraint buffalo_shortcut_devices_management_key_hash_valid check (
    device_management_key_hash is null
    or device_management_key_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint buffalo_shortcut_devices_management_key_binding_valid check (
    (device_management_key_hash is null and device_management_key_bound_at is null)
    or (device_management_key_hash is not null and device_management_key_bound_at is not null)
  );

-- The original Auth UUID remains immutable encryption/audit metadata for v1
-- ciphertexts. It must no longer cascade-delete the device-owned shortcut when
-- an anonymous Auth identity is retired after an Admin session switch.
alter table public.buffalo_shortcut_devices
  drop constraint buffalo_shortcut_devices_owner_user_id_fkey;

comment on column public.buffalo_shortcut_devices.owner_user_id is
  'Original provisioning Auth UUID retained as immutable v1 token-encryption metadata; not the current management owner.';
comment on column public.buffalo_shortcut_devices.device_management_key_hash is
  'SHA-256 hash of the browser device management key stored in IndexedDB; never the key itself.';
comment on column public.buffalo_shortcut_devices.last_authenticated_user_id is
  'Audit-only Auth UUID from the latest successful device-key-authenticated management request.';

commit;
