begin;

create or replace function public.finish_tournament_with_champion(
  p_tournament_id uuid,
  p_champion_entry_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  select entry.display_name_snapshot
  into v_display_name
  from public.tournament_entries as entry
  where entry.tournament_id = p_tournament_id
    and entry.id = p_champion_entry_id;

  if v_display_name is null then
    raise exception using errcode = '23503', message = 'The champion entry does not belong to the tournament';
  end if;

  update public.tournaments
  set status = 'finished',
      current_phase = 'finished'
  where id = p_tournament_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Tournament does not exist';
  end if;

  insert into public.tournament_placements (
    tournament_id, entry_id, placement, display_name_snapshot, stats_snapshot
  ) values (
    p_tournament_id, p_champion_entry_id, 1, v_display_name,
    pg_catalog.jsonb_build_object('source', p_source)
  )
  on conflict (tournament_id, placement) do update
  set entry_id = excluded.entry_id,
      display_name_snapshot = excluded.display_name_snapshot,
      stats_snapshot = excluded.stats_snapshot,
      awarded_at = pg_catalog.now();
end;
$$;

comment on function public.finish_tournament_with_champion(uuid, uuid, text) is
  'Atomically finishes the tournament before storing its champion, satisfying the placement lifecycle constraint.';

revoke all on function public.finish_tournament_with_champion(uuid, uuid, text)
  from public, anon, authenticated;

commit;
