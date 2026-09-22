-- Apply manually only after the idempotent client has been deployed and old
-- active tabs have been updated. This file is intentionally outside migrations
-- so a regular migration push cannot revoke the old route prematurely.
begin;

revoke all on function public.record_roulette_spin(text, text)
  from public, anon, authenticated;
revoke all on function public.record_roulette_gold_spin(text, uuid)
  from public, anon, authenticated;

commit;
