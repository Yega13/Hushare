-- Face templates are Article 9 biometric data: prohibited by default, and the exception Hushare
-- relies on is the explicit consent of the person whose face it is. The privacy policy and the
-- terms both said the owner confirms they hold that consent — but the product never asked. The
-- toggle was a bare switch, so the confirmation asserted in the Terms did not exist anywhere.
--
-- These two columns are the evidence trail. An event organiser is the controller here, and what
-- their reviewer needs to see is that the product made them state it, and when.
alter table albums add column if not exists face_consent_at timestamptz;
alter table albums add column if not exists face_consent_by uuid;

comment on column albums.face_consent_at is
  'When the owner confirmed they hold explicit consent from the people in the photos for face search. Cleared when Face Finder is switched off.';
comment on column albums.face_consent_by is
  'auth.users id of whoever gave that confirmation.';
