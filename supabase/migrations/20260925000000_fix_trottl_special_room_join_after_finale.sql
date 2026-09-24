begin;

-- The original finale trigger used one CASE expression for two distinct row
-- types. PL/pgSQL resolves NEW.session_id against a session row even when the
-- CASE condition selects NEW.id, so every session UPDATE (including a normal
-- lobby join reconciliation) failed at commit. Separate branches retain the
-- same deferred finale check without cross-row field resolution.
create or replace function public.special_finale_auto_enter_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if tg_table_name='trottl_special_sessions' then
  v_id:=coalesce(new.id,old.id);
 else
  v_id:=coalesce(new.session_id,old.session_id);
 end if;
 perform public.maybe_enter_trottl_special_finale_locked(v_id);
 return null;
end;$$;

revoke all on function public.special_finale_auto_enter_trigger() from public,anon,authenticated;

commit;
