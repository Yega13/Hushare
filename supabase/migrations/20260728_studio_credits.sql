-- ─────────────────────────────────────────────────────────────────────────────
-- Hushare Studio — credits for the AI picture generator (Phase 1).
-- A "credit" = one generated picture. Users get a free monthly allowance by plan tier and can buy
-- more via one-time Polar packs. ALL access is server-side (service_role). RLS denies anon/user, and
-- the mutating functions are REVOKEd from anon/authenticated so no one can grant/spend via the
-- public anon key. Run in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.studio_credits (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  balance          integer not null default 0 check (balance >= 0),
  last_grant_month text,                                  -- 'YYYY-MM' of the last monthly free grant
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.studio_credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         integer not null,                         -- + grant/purchase/refund, - spend
  reason        text not null,                            -- monthly_grant|purchase|generation|refund|admin_adjust
  meta          jsonb,
  balance_after integer not null,
  created_at    timestamptz not null default now()
);
create index if not exists studio_credit_ledger_user_idx
  on public.studio_credit_ledger (user_id, created_at desc);

alter table public.studio_credits        enable row level security;
alter table public.studio_credit_ledger  enable row level security;
-- No policies → deny-all for anon/authenticated; service_role bypasses RLS (server-only access).

-- Add credits atomically (grant / purchase / refund). Locks the row, updates, writes the ledger.
create or replace function public.studio_add_credits(
  p_user uuid, p_amount integer, p_reason text, p_meta jsonb default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  insert into public.studio_credits (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;
  update public.studio_credits
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user
   returning balance into v_balance;
  insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
    values (p_user, p_amount, p_reason, p_meta, v_balance);
  return v_balance;
end $$;

-- Spend credits atomically. Returns the new balance, or -1 if insufficient funds (no change made).
create or replace function public.studio_spend_credits(
  p_user uuid, p_amount integer, p_reason text, p_meta jsonb default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  select balance into v_balance from public.studio_credits where user_id = p_user for update;
  if v_balance is null or v_balance < p_amount then
    return -1;
  end if;
  update public.studio_credits set balance = balance - p_amount, updated_at = now()
   where user_id = p_user returning balance into v_balance;
  insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
    values (p_user, -p_amount, p_reason, p_meta, v_balance);
  return v_balance;
end $$;

-- Apply the monthly free grant for p_month if not already applied this month. Idempotent per month.
create or replace function public.studio_grant_monthly(
  p_user uuid, p_amount integer, p_month text
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_balance integer; v_last text;
begin
  insert into public.studio_credits (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;
  select balance, last_grant_month into v_balance, v_last
    from public.studio_credits where user_id = p_user for update;
  if v_last is distinct from p_month then
    update public.studio_credits
       set balance = balance + p_amount, last_grant_month = p_month, updated_at = now()
     where user_id = p_user returning balance into v_balance;
    insert into public.studio_credit_ledger (user_id, delta, reason, meta, balance_after)
      values (p_user, p_amount, 'monthly_grant', jsonb_build_object('month', p_month), v_balance);
  end if;
  return v_balance;
end $$;

-- Only the server (service_role / postgres) may mutate credits — never the public anon key.
revoke all on function public.studio_add_credits(uuid, integer, text, jsonb)   from public, anon, authenticated;
revoke all on function public.studio_spend_credits(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.studio_grant_monthly(uuid, integer, text)        from public, anon, authenticated;

-- One row per generated picture (= one credit). Owners can read their own history; writes are
-- server-only (service_role bypasses RLS).
create table if not exists public.studio_generations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  style_id      text not null,
  status        text not null default 'done',      -- done | failed
  output_url    text,                               -- R2 URL of the styled result
  credits_spent integer not null default 1,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists studio_generations_user_idx on public.studio_generations (user_id, created_at desc);
alter table public.studio_generations enable row level security;
drop policy if exists studio_generations_owner_read on public.studio_generations;
create policy studio_generations_owner_read on public.studio_generations
  for select using (auth.uid() = user_id);
