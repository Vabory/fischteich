begin;

-- Keep the voice-shortcut picker aligned with the browser's current FRIENDS
-- list without rewriting any historical Buffalo event snapshots.
update public.buffalo_shortcut_targets
set
  display_name = 'Poidl',
  normalized_name = 'poidl'
where display_name = 'Julian'
  and normalized_name = 'julian';

delete from public.buffalo_shortcut_targets
where display_name = 'Vivienne'
  and normalized_name = 'vivienne';

commit;
