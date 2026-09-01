-- EVERY POLAR ORDER WE HAVE ALREADY TURNED INTO ENTITLEMENT, one row each.
--
-- albums.package_last_order_id was the whole mechanism, and it answers a narrower question than it
-- looks like it answers: "was the LAST order applied to this album this one?" That is exactly right
-- for the webhook, which sees each order once, as it happens — a redelivery of the same order finds
-- its own id and no-ops.
--
-- It is wrong for the nightly reconcile, which re-reads up to 300 historical orders every night and
-- asks the same column a question it cannot answer. With two orders on one album — a $99 purchase
-- and a $19 renewal, which is an ordinary customer, not an edge case — the column holds one id and
-- the other order looks unapplied. So the job grants it, writes its id, and the NEXT night the
-- first order looks unapplied. They alternate forever:
--
--   night 1: purchase re-granted  -> +2 years
--   night 2: renewal re-granted   -> +1 year, then purchase again -> +2 years
--   ...     +3 years of paid time per night, on a $118 sale, until someone notices
--
-- And it fires reportServerError('a paid package had to be repaired') every night while doing it —
-- turning the one alert that means "we are dropping payments" into the one nobody reads. The same
-- gap undoes refunds: revoking a refunded renewal leaves the older purchase looking unapplied, so
-- the repair job hands the package back the following night, on a schedule.
--
-- A single column cannot express "the set of orders already honoured", so this is that set. One row
-- per order, the order id as the primary key, so claiming an order is an INSERT that either
-- succeeds or conflicts — atomic, with no read-then-write race against the webhook running at the
-- same moment.
--
-- albums.package_last_order_id stays. It answers a DIFFERENT question that is still needed: which
-- order paid for the package the album currently holds, so a refund revokes only its own grant.

create table if not exists package_order_grants (
  order_id   text primary key,
  album_id   uuid not null references albums(id) on delete cascade,
  -- 'webhook' or 'reconcile' — so "is the primary path dropping payments?" is answerable from the
  -- data rather than from whether anyone saw an alert.
  source     text not null,
  granted_at timestamptz not null default now()
);

create index if not exists package_order_grants_album_idx on package_order_grants (album_id);
