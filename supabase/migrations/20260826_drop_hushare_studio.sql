-- Remove Hushare Studio. It was never finished and is not being finished.
--
-- The idea was an AI image workshop inside Hushare — generate, modify, restore. Three tables and a
-- credit-granting function were created for it on 2026-07-28 and nothing was ever built on top:
-- zero application code references any of them, and all three tables have zero rows.
--
-- Dropped on the owner's decision (2026-08-26). Generic AI image editing is a different business
-- from shared event albums — it competes with Photoshop, Canva and Remini on GPU margin, and none
-- of it makes an album better. Keeping dead schema around is not free: it is three more tables to
-- reason about in every audit, three more grants to get wrong, and a function that was SECURITY
-- DEFINER and had to be explicitly revoked from PUBLIC to stop it being callable with the
-- publishable key.
--
-- NOT TOUCHED, and worth being explicit because the word collides: `studio` is also the internal
-- name of the MAX TIER (tier === 'studio' throughout src/). That is unrelated to this feature and
-- must survive. Only the credit/generation tables and their function go.
--
-- The one part worth keeping was never built here anyway: enhancing photos that are ALREADY in an
-- album (dark, blurry guest photos) is an upsell on something people have, rather than a reason to
-- visit. If that is ever built it starts fresh, and it never replaces an original — only adds a copy.
--
-- Idempotent — safe to re-run.

drop function if exists public.studio_add_credits(uuid, integer, text);
drop function if exists public.studio_add_credits(uuid, integer);
drop table if exists public.studio_credit_ledger;
drop table if exists public.studio_generations;
drop table if exists public.studio_credits;
