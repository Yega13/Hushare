-- Per-album lock on removing the Hushare mark.
--
-- Collaboration albums are given a Max plan for free in exchange for the album carrying our name
-- in front of everyone who opens it. Max includes "remove Hushare branding" — one toggle — so
-- without this the thing we are being paid in can be switched off by accident or on purpose, and
-- nobody would notice until after the event, when the audience has already been and gone.
--
-- Deliberately NOT a plan check. The album still has every Max feature; this is a property of the
-- deal attached to one album, so it lives on the album. Default false, so no existing album changes.
--
-- Enforced in two places, because one is not enough: api/album/branding refuses to set
-- hide_branding while this is on, and resolveAlbum forces hide_branding to false at read time, so
-- a value already stored cannot keep taking effect.
--
-- Idempotent — safe to re-run.

alter table public.albums add column if not exists branding_locked boolean not null default false;

comment on column public.albums.branding_locked is
  'Collaboration albums: the Hushare mark cannot be hidden, whatever the plan. Set by an admin as part of a promotion deal, not by the owner.';

-- Partial index: the set is expected to stay tiny (a handful of partner albums), and this keeps
-- "which albums are under a collab deal" a cheap question to ask from /admin.
create index if not exists albums_branding_locked_idx on public.albums (branding_locked) where branding_locked;
