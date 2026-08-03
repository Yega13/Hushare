-- The live `subscriptions` table drifted from schema.sql:
--   * `id` lost its DEFAULT (inserts that omit id fail with "null value in column id")
--   * `polar_customer_id` became NOT NULL (out-of-flow payments have no customer id yet)
-- The webhook + admin "Sync from Polar" reconcile already work around this in code (explicit id,
-- placeholder customer id), but this restores the table to schema.sql so every writer is safe.
-- Run in the Supabase SQL editor.

alter table public.subscriptions alter column id set default gen_random_uuid();
alter table public.subscriptions alter column polar_customer_id drop not null;
