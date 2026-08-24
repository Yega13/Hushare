-- Store Polar's own "when did this subscription last change" so out-of-order events can be detected.
--
-- The webhook's ordering guard compared the incoming event's modified_at against subscriptions
-- .updated_at, which looked right and cannot work: subscriptions_set_updated_at is a BEFORE UPDATE
-- trigger that overwrites updated_at with now() on every write. So the comparison was against OUR
-- processing time, not Polar's — the exact thing the code comment claimed to be avoiding.
--
-- That made the guard actively harmful rather than merely useless. Polar emits bursts (a
-- subscription.updated followed a second later by subscription.canceled); we take a couple of
-- seconds to process the first, so the second arrives carrying an OLDER modified_at than our
-- freshly-stamped updated_at, is judged stale, and is answered 200 — so Polar never retries. A
-- cancellation that never lands, or a reactivation that never lands, in silence.
--
-- A dedicated column, untouched by the trigger, is the honest place for someone else's clock.
alter table public.subscriptions
  add column if not exists polar_modified_at timestamptz;

comment on column public.subscriptions.polar_modified_at is
  'The subscription''s modified_at as reported by POLAR — their clock, not ours. Used to reject webhook events that arrive out of order. Never set by a trigger: updated_at is ours and is overwritten on every write.';
