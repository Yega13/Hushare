-- Remember that a renewal reminder was sent, so it cannot be sent twice.
--
-- notify-renewal had no dedupe of any kind: its only protection was the assumption that the cron
-- fires exactly once a day. Cloudflare cron triggers are at-least-once, so a duplicate invocation
-- emails every renewing customer a second billing notice -- to people who are about to be charged,
-- which is exactly the audience least likely to find it funny.
--
-- Nullable, so existing rows simply look "never reminded" and the first run after this migration
-- behaves normally. Indexed together with the window the cron actually queries.
alter table public.subscriptions
  add column if not exists last_reminder_at timestamptz;

comment on column public.subscriptions.last_reminder_at is
  'When a pre-billing renewal reminder was last emailed for this subscription. Set AFTER a successful send, so a failed send is retried rather than silently skipped.';

create index if not exists subscriptions_renewal_window_idx
  on public.subscriptions (current_period_end)
  where status = 'active' and cancel_at_period_end = false;
