import { MEDIA_CAPTION_MAX, MEDIA_AUTHOR_MAX } from '@/lib/constants'

// WHAT A GUEST IS ALLOWED TO CLAIM ABOUT A PHOTO THEY JUST UPLOADED.
//
// api/album/photos/create takes rows describing files already written to R2 or Cloudflare Stream.
// Nothing here has seen the bytes — the client says "there is a photo at this key, with this
// thumbnail". So this function is the entire boundary between a guest and the album's storage, and
// it lived inside a 645-line route handler with no test of any kind.
//
// It is not a formality. The comment on the thumb_url rule below describes an attack that was
// found in it: a poisoned thumbnail pointed at somebody ELSE'S real photo, so the owner deleting
// the junk row destroyed their own original. That rule is now asserted rather than trusted.
//
// Every field is `unknown` on purpose: this is parsed JSON from the network, and a `string` type
// annotation on a value that arrived as a number is a lie the compiler will believe.

export type PhotoInput = {
  storage_backend: unknown
  media_type: unknown
  storage_path?: unknown
  url?: unknown
  thumb_url?: unknown
  stream_uid?: unknown
  poster_url?: unknown
  duration_seconds?: unknown
  width?: unknown
  height?: unknown
  caption?: unknown
  author_name?: unknown
}

const STREAM_UID_RE = /^[a-f0-9]{32}$/
const MAX_CAPTION_LEN = MEDIA_CAPTION_MAX
const MAX_AUTHOR_NAME_LEN = MEDIA_AUTHOR_MAX

export function r2UrlPrefix(host: string, albumId: string, prefix: 'albums' | 'thumbs') {
  return `https://${host}/${prefix}/${albumId}/`
}

export function hasTraversal(s: string): boolean {
  // '?' and '#' are here because r2KeyFromUrl STRIPS a query string: `<victim>.jpg?x` resolves to
  // the victim's key while matching no exact-string lookup. That is how a guest could store a row
  // naming a real photo's thumbnail without appearing to, and have the owner's own delete destroy
  // it — permanently, with nothing able to regenerate a thumbnail. Two notions of identity
  // disagreed; this closes the writing half, and rowsReferencingKeys closes it for rows already
  // stored (rule 13: a rule enforced only at write time does nothing about what is already there).
  if (s.includes('?') || s.includes('#')) return true
  // Check literal "..", null bytes, backslash (Windows path separator), URL-encoded variants
  if (s.includes('..') || s.includes('\x00') || s.includes('%00') || s.includes('\\')) return true
  const lower = s.toLowerCase()
  return lower.includes('%2e%2e') || lower.includes('%2e.') || lower.includes('.%2e')
    || lower.includes('%25') || lower.includes('%2f') || lower.includes('%5c')
}

export function validatePhoto(
  photo: PhotoInput,
  index: number,
  albumId: string,
  r2Host: string,
): string | null {
  const { storage_backend, media_type } = photo

  if (storage_backend !== 'r2' && storage_backend !== 'stream') {
    return `photos[${index}]: storage_backend must be "r2" or "stream"`
  }
  if (media_type !== 'image' && media_type !== 'video') {
    return `photos[${index}]: media_type must be "image" or "video"`
  }
  if (storage_backend === 'stream' && media_type !== 'video') {
    return `photos[${index}]: stream backend only supports media_type "video"`
  }
  if (storage_backend === 'r2' && media_type !== 'image') {
    return `photos[${index}]: r2 backend only supports media_type "image"`
  }
  // TRIMMED FIRST: the trimmed value is what gets stored, and it is what photo/settings measures.
  // Raw-length here meant a 30-char caption ending in a space was accepted when edited and refused
  // when uploaded — same caption, two answers, depending on the screen.
  if (typeof photo.caption === 'string' && photo.caption.trim().length > MAX_CAPTION_LEN) {
    return `photos[${index}]: caption exceeds ${MAX_CAPTION_LEN} chars`
  }
  if (typeof photo.author_name === 'string' && photo.author_name.trim().length > MAX_AUTHOR_NAME_LEN) {
    return `photos[${index}]: author_name exceeds ${MAX_AUTHOR_NAME_LEN} chars`
  }

  const albumsPrefix = r2UrlPrefix(r2Host, albumId, 'albums')
  const thumbsPrefix = r2UrlPrefix(r2Host, albumId, 'thumbs')

  if (storage_backend === 'r2') {
    if (
      typeof photo.storage_path !== 'string' ||
      photo.storage_path.length > 512 ||
      !photo.storage_path.startsWith(`albums/${albumId}/`) ||
      hasTraversal(photo.storage_path)
    ) {
      return `photos[${index}]: storage_path must start with "albums/${albumId}/" and must not contain ".."`
    }
    if (
      typeof photo.url !== 'string' ||
      photo.url.length > 2048 ||
      !photo.url.startsWith(albumsPrefix) ||
      hasTraversal(photo.url)
    ) {
      return `photos[${index}]: url must start with "${albumsPrefix}" and must not contain ".."`
    }
    // THUMBNAILS LIVE UNDER thumbs/, AND ONLY THERE. Allowing albums/ as well turned a guest
    // upload into a way to destroy the owner's real photos.
    //
    // The attack, which needed no account, no owner link and no uploaded bytes: read any public
    // album's photo list (it returns the album id and every photo's public url), then POST rows
    // whose storage_path is a fresh uuid — so the upsert inserts them — but whose thumb_url points
    // at a REAL photo's file. The owner sees junk photos and deletes them. photo/delete and
    // bulk-delete feed thumb_url straight into r2KeyFromUrl() and delete that key from R2, so the
    // owner's own moderation click permanently destroys their originals. The rows survive, the
    // bytes do not, and nothing records what happened. It is aimed at exactly the moment an owner
    // is most likely to click delete.
    //
    // The permissive branch was never used: of 13,616 photo rows, 13,471 thumb_urls are under
    // thumbs/ and ZERO under albums/ (poster_url: 84 under thumbs/, zero under albums/). It was
    // dead code and pure attack surface. All 88 live albums accept guest uploads, and a check for
    // prior abuse (thumb_url matching another row's url) returned zero — found before it was used.
    if (
      photo.thumb_url != null &&
      (typeof photo.thumb_url !== 'string' ||
        photo.thumb_url.length > 2048 ||
        !photo.thumb_url.startsWith(thumbsPrefix) ||
        hasTraversal(photo.thumb_url))
    ) {
      return `photos[${index}]: thumb_url must start with "${thumbsPrefix}" and must not contain ".."`
    }
  } else {
    if (typeof photo.stream_uid !== 'string' || !STREAM_UID_RE.test(photo.stream_uid)) {
      return `photos[${index}]: stream_uid must be a 32-character lowercase hex string`
    }
    // Same rule, same reason as thumb_url above — a video poster is written under thumbs/ too, and
    // allowing albums/ let a poisoned poster_url delete a real photo on the owner's next cleanup.
    if (
      photo.poster_url != null &&
      (typeof photo.poster_url !== 'string' ||
        photo.poster_url.length > 2048 ||
        !photo.poster_url.startsWith(thumbsPrefix) ||
        hasTraversal(photo.poster_url))
    ) {
      return `photos[${index}]: poster_url must start with "${thumbsPrefix}" and must not contain ".."`
    }
    if (
      photo.duration_seconds != null &&
      (typeof photo.duration_seconds !== 'number' ||
        !Number.isFinite(photo.duration_seconds) ||
        photo.duration_seconds <= 0)
    ) {
      return `photos[${index}]: duration_seconds must be a positive number`
    }
  }

  return null
}
