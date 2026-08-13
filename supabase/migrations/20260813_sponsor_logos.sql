-- Sponsor-branding strip (race/festival albums) — an owner-ordered list of sponsor logos shown
-- below the header. Each entry: {id, url, name}. Empty array = no strip shown (default, unchanged
-- rendering for every existing album). Paid feature, same tier gate as the album logo.
alter table public.albums add column if not exists sponsor_logos jsonb not null default '[]'::jsonb;
