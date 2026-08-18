-- Tiny key/value scratchpad for operational state that must outlive a single Worker invocation.
-- First use: remembering when an error alert was last emailed, so a genuine incident sends one
-- message and not one every sixty seconds for as long as it lasts.
create table if not exists system_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

comment on table system_state is
  'Operational key/value state (alert cooldowns and similar). Not user data — nothing here is personal.';

alter table system_state enable row level security;
-- No policies: service_role bypasses RLS, and nothing else has any business reading this.
