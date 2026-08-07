-- Album design / customization fields (Part A: "Album Design").
-- All nullable / defaulted → existing albums render exactly as before (fully backward-compatible).
--   accent_color    : hex string (#rrggbb). Curated palette for all; custom hex for paid tiers.
--   logo_url        : R2 URL of an owner-uploaded logo shown atop the album (paid).
--   template        : preset key applied as a one-click look (writes background + accent together).
--   welcome_message : short line shown in the album's welcome header.
--   hide_branding   : paid — hides the "Powered by Hushare" mark.
-- Idempotent — safe to re-run.

alter table public.albums add column if not exists accent_color text;
alter table public.albums add column if not exists logo_url text;
alter table public.albums add column if not exists template text;
alter table public.albums add column if not exists welcome_message text;
alter table public.albums add column if not exists hide_branding boolean not null default false;
