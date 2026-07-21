-- Add resolved_at so the /admin Errors view can be "cleared" (archived) without deleting rows.
-- Resolved errors drop out of the active view (which filters resolved_at is null) but remain in the
-- table — recoverable — until the existing 30-day prune (prune_error_events) removes them. Idempotent.

alter table public.error_events add column if not exists resolved_at timestamptz;

-- Partial index: the admin view and the 24h count both filter to unresolved rows.
create index if not exists error_events_unresolved_created_idx
  on public.error_events(created_at desc) where resolved_at is null;
