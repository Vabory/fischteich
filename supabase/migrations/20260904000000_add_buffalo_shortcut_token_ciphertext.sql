begin;

alter table public.buffalo_shortcut_devices
  add column token_ciphertext text;

alter table public.buffalo_shortcut_devices
  add constraint buffalo_shortcut_devices_token_ciphertext_valid check (
    token_ciphertext is null
    or token_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{79}$'
  );

comment on column public.buffalo_shortcut_devices.token_ciphertext is
  'AES-256-GCM encrypted shortcut token envelope for authenticated owner reveal; never plaintext.';

commit;
