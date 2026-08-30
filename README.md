# team-splitter
Simple mobile multi-touch team splitter

## Tournament placement backfill

After migration `20260830080000_create_tournament_archive_snapshots.sql` has been applied, an admin RPC caller or a trusted database session can rebuild one older finished tournament explicitly:

```sql
select public.backfill_finished_tournament_placements('<tournament-id>'::uuid);
```

The function is admin-only and never runs automatically.
