-- A ONE-OFF PACKAGE BOUGHT FOR ONE ALBUM — the entitlement that is not a subscription.
--
-- Pro Package ($49) and Max Package ($99) cover a single album for two years: its item allowance,
-- its video budget, and the paid feature set, regardless of what plan its owner is on. Renewals
-- ($9/$19 a year) are one-time payments that push package_expires_at forward — deliberately not a
-- stored-card subscription, because a failed $9 charge quietly deleting somebody's wedding album
-- is the worst thing this product could do.
--
-- Two columns on albums rather than a purchases table: the album row is the ONE place the
-- entitlement is read from (src/lib/album-entitlements.ts), and purchase history already lives at
-- Polar. A second table holding "what this album is entitled to" would be a second answer.
--
-- 'studio', not 'max', for the top tier — matching subscriptions.tier and computeUserTier, so the
-- same word means the same thing in every table (the customer-facing name is Max; 'studio' is the
-- internal key everywhere, and half-renaming it here would be the drift rule 13 exists to stop).

alter table albums add column if not exists package_tier text;
alter table albums add column if not exists package_expires_at timestamptz;

alter table albums drop constraint if exists albums_package_tier_check;
alter table albums add constraint albums_package_tier_check
  check (package_tier is null or package_tier in ('pro', 'studio'));

-- A tier without an expiry would read as expired forever (the code treats an unreadable expiry as
-- lapsed, on purpose); an expiry without a tier would be meaningless. Refuse the halves at the
-- database, so no webhook bug can write one.
alter table albums drop constraint if exists albums_package_pair_check;
alter table albums add constraint albums_package_pair_check
  check ((package_tier is null) = (package_expires_at is null));

-- The renewal-warning cron asks "which packages lapse soon" — a needle query against a table where
-- almost every row has no package. Partial index keeps it a handful of rows forever.
create index if not exists albums_package_expiry_idx
  on albums (package_expires_at)
  where package_tier is not null;
