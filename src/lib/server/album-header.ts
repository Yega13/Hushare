import { createAdminClient } from '@/lib/supabase/admin'
import { deleteR2ObjectByPublicUrl } from '@/lib/cloudflare/r2'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

type SetHeaderResult = { ok: true } | { ok: false; error: string }

// The album header has exactly one source at a time: an existing album photo (cover_photo_id) or
// a directly-uploaded image (header_image). This is the ONLY function that writes either column —
// every caller goes through it — so "clear whichever isn't the new source" can't be forgotten by
// a future call site the way it was when /api/album/cover and /api/album/header-image each wrote
// the columns independently. See /api/album/cover and /api/album/header-image, its two callers.
export async function setAlbumHeader(
  admin: ReturnType<typeof createAdminClient>,
  albumId: string,
  next: { coverPhotoId: string | null; headerImage: string | null },
  previousHeaderImage: string | null,
): Promise<SetHeaderResult> {
  if (next.coverPhotoId !== null && next.headerImage !== null) {
    // Unreachable in practice — both current callers set at most one. Fail loud instead of
    // silently writing a row where both are set (undefined which one the header would show).
    return { ok: false, error: 'A header photo and a header image cannot both be set' }
  }

  // header_touched: true unconditionally — every caller here represents a genuine, explicit owner
  // action (pick a photo, upload one, or hit "None"), which is exactly what should permanently
  // opt an album out of auto-suggestion (see resolveAlbum's maybeAutoSuggestHeader).
  const updates = { cover_photo_id: next.coverPhotoId, header_image: next.headerImage, header_touched: true }
  const { error } = await admin.from('albums').update(updates).eq('id', albumId)
  if (error) {
    console.error('[album-header] update failed:', error.message)
    return { ok: false, error: 'Could not update header photo' }
  }

  // A custom header image just got replaced or cleared — clean up its R2 object. Fire-and-forget,
  // best-effort (see deleteR2ObjectByPublicUrl); skipped when it's unchanged (re-setting the same
  // header image would otherwise orphan the still-active object).
  if (previousHeaderImage && previousHeaderImage !== next.headerImage) {
    deleteR2ObjectByPublicUrl(previousHeaderImage)
  }

  queueAlbumSettingsBroadcast(albumId, updates)
  return { ok: true }
}
