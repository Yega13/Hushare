-- When this album's owner was last reminded that the package is running out.
--
-- Deliberately NOT last_notification_at: that column is half of the retirement interlock
-- (retire-albums refuses to delete anything it does not prove was warned through it), and
-- overloading it with renewal reminders would let a $9-renewal email stand in for the
-- "your album will be deleted" warning — satisfying the interlock without the warning it exists
-- to guarantee. One column, one meaning.
--
-- The reminder windows (30 and 7 days) are judged against this in lib/package-renewal: a stamp
-- inside a window silences that window only, so the final-week email always goes out even though
-- the 30-day one was already sent.

alter table albums add column if not exists package_reminder_at timestamptz;
