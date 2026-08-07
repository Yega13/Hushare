-- Interactive polls attached to statements (hushare.space/statement/<slug>).
-- A statement's poll_key links it to a poll defined in src/lib/polls.ts; the widget renders below
-- the statement body. Votes are aggregated server-side; one vote per browser (voter_id), changeable.
-- Idempotent — safe to re-run.

alter table public.statements add column if not exists poll_key text;

create table if not exists public.poll_votes (
  id         uuid primary key default gen_random_uuid(),
  poll_key   text not null,
  option_key text not null,
  voter_id   text not null,
  created_at timestamptz not null default now()
);

-- One vote per browser per poll; a re-vote UPDATES the existing row (see /api/poll upsert).
create unique index if not exists poll_votes_unique on public.poll_votes (poll_key, voter_id);
create index if not exists poll_votes_key_idx on public.poll_votes (poll_key);

alter table public.poll_votes enable row level security;
-- No public policy: all reads/writes go through the server (service_role, which bypasses RLS), so
-- anon/user clients can never read raw votes or write directly — the API dedups + aggregates.
