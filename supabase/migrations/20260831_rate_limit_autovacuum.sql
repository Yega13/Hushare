-- Keep the rate-limiter tables from bloating, because they sit on the hot path of every request.
--
-- Found while sizing the database before a high-traffic event: rate_limit_events was the LARGEST
-- table in the database — 25 MB total, of which a 12 MB index — while holding 442 live rows and
-- zero dead ones. The index behind every rate-limit check had been scanned 267,000 times and had
-- grown roughly 170x its useful size.
--
-- The cause is shape, not volume. This table is a queue: rows are inserted and deleted constantly,
-- and its entire contents turn over many times an hour. Postgres autovacuum triggers at a
-- PERCENTAGE of live rows by default (20%), which is a threshold a 400-row table crosses
-- constantly but which never fires early enough to stop index pages fragmenting — and plain
-- VACUUM does not return index bloat to the table anyway.
--
-- Fixed in two parts. The one-off repair (REINDEX CONCURRENTLY on both indexes, then VACUUM FULL)
-- was run by hand against production and took the table to 112 kB and the whole database from
-- 58 MB to 33 MB. These settings are the part that keeps it there: vacuum on a small ABSOLUTE
-- number of changes rather than a percentage, which is what a queue-shaped table needs, plus
-- fillfactor so updates have room to stay on their own page.
--
-- If this ever needs repeating, the repair is:
--   reindex index concurrently rate_limit_events_key_created_at;
--   reindex index concurrently rate_limit_events_pkey;
--   vacuum full rate_limit_events;
-- REINDEX CONCURRENTLY takes no write lock. VACUUM FULL takes a brief exclusive one, which is
-- safe here only because the table is tiny and checkRateLimit fails OPEN — a request arriving
-- during the lock is allowed rather than refused.

alter table rate_limit_events set (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 200,
  fillfactor = 70
);

alter table rate_limit_counters set (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 200,
  fillfactor = 70
);
