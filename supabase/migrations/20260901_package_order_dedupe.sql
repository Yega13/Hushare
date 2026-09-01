-- The webhook's proof that it already applied a Polar order to this album.
--
-- Polar redelivers a webhook event until it gets a 200, and again on its own schedule when it is
-- unsure. Applying a renewal twice would hand out a free year; applying a package twice would hand
-- out two. The order id is the natural idempotency key — the SAME order arriving twice is a
-- redelivery and must be a no-op, while two DIFFERENT orders are two purchases and must both
-- count. One column, compared before writing, is the whole mechanism.

alter table albums add column if not exists package_last_order_id text;
