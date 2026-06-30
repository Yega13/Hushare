# Database schema & migrations

The live Supabase database is kept in sync with the application **only** through the
migration files in `supabase/migrations/`. This exists because the live DB had
silently drifted from the code (missing columns / RLS policies / tables), which
caused production failures like "Album not found" and albums showing no photos.

## Rules

1. **Never hand-edit the database** (no ad-hoc changes in the Supabase SQL editor).
   Every schema change is a new file in `supabase/migrations/`.
2. **Migration files must be idempotent** — use `create ... if not exists`,
   `create or replace`, `drop policy if exists` then `create policy`, and guard
   `alter table ... add constraint` with a `do $$ ... if not exists (select 1 from
   pg_constraint ...) ... $$` block. The runner records each file in a
   `schema_migrations` table so it never runs twice, but idempotency makes a fresh
   rebuild safe.
3. **Name files `YYYYMMDD_description.sql`** so they apply in chronological order.

## Commands

```bash
# Apply any unapplied migrations (tracked, transactional, idempotent)
npm run db:migrate

# Verify the live DB has every table/column/function/policy the code needs.
# Exits non-zero on drift — this is the guard that stops drift shipping.
npm run db:check
```

Both read `SUPABASE_DB_URL` (the Supabase **pooler → Session** connection string,
port 5432). For local use they fall back to building it from `Supabase Password.txt`.

## CI

`.github/workflows/deploy.yml` runs `db:migrate` + `db:check` on every deploy **if**
the `SUPABASE_DB_URL` repo secret is set (it skips with a warning otherwise, so it
never blocks a deploy). Set that secret to make schema sync automatic:

> Supabase dashboard → Project Settings → Database → Connection string → **Session
> pooler** → copy, then add it as the GitHub Actions secret `SUPABASE_DB_URL`.

## When you add a column/table the code depends on

Also add it to the `REQUIRED_*` lists in `scripts/check-db.mjs` so the drift check
keeps protecting you.
