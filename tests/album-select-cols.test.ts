import { describe, it, expect } from 'vitest'
import { ALBUM_SELECT_COLS, PHOTO_SELECT_COLS } from '@/lib/server/album-access'
import type { Database } from '@/types/database'

// THE TWO HOTTEST READS IN THE PRODUCT, PINNED BYTE-FOR-BYTE.
//
// These were `[...].join(', ')`. That is typed `string`, and PostgREST's select parser needs a
// LITERAL type — given a plain string it returns GenericStringError and gives up, so all 44 album
// columns were checked against the schema by nobody. The `.returns<AlbumRow[]>()` that followed then
// asserted a shape the compiler had no way to verify, which is how the select came to fetch 44
// columns while AlbumRow declared 42.
//
// Rewriting them as interpolated literals restores the checking. The RISK of that rewrite is that
// the string changes: it goes into a live `?select=` on the album page and the photo grid, so a
// stray space, a lost column, or a reordering is a customer-facing change on the busiest path in
// the product. This file exists to make that impossible to do by accident.
//
// The expected values below are the OLD `.join(', ')` output, transcribed once and never derived
// from the code they check — a test that rebuilt the list from the same constants would agree with
// itself no matter what broke (AGENTS.md rule 17).

const EXPECTED_ALBUM =
  'id, user_id, slug, custom_slug, title, background_theme, ' +
  'media_radius, media_filter, mobile_grid_columns, desktop_grid_columns, photo_layout, photo_order, ' +
  'slideshow_interval_ms, slideshow_animation, slideshow_motion, video_autoplay, ' +
  'cover_photo_id, header_image, header_focal, header_zoom, header_touched, header_video_mode, ' +
  'reveal_at, guest_uploads_enabled, allow_guest_downloads, ' +
  'require_approval, face_finder_enabled, bib_search_enabled, bib_min, bib_max, branding_locked, ' +
  'package_tier, package_expires_at, ' +
  'accent_color, logo_url, sponsor_logos, title_font, photo_style, welcome_message, hide_branding, ' +
  'last_activity_at, created_at, password_hash, retired_at'

const EXPECTED_PHOTO =
  'id, album_id, storage_path, storage_backend, ' +
  'url, thumb_url, caption, author_name, created_at, ' +
  'media_type, poster_url, stream_uid, stream_iframe_url, ' +
  'stream_thumbnail_url, duration_seconds, width, height, ' +
  'display_radius, display_filter, sort_order, face_ids, hidden, bib_numbers'

describe('the album select string is exactly what it always was', () => {
  it('matches the pre-refactor join byte for byte', () => {
    expect(ALBUM_SELECT_COLS).toBe(EXPECTED_ALBUM)
  })

  it('still asks for 44 columns, none lost in the regrouping', () => {
    // A count as well as the string, because a diff of one long line is unreadable and this is the
    // number a reviewer can actually check.
    expect(ALBUM_SELECT_COLS.split(', ')).toHaveLength(44)
  })

  it('carries no duplicate column, which a copy-paste regrouping invites', () => {
    const cols = ALBUM_SELECT_COLS.split(', ')
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('has no stray whitespace — PostgREST sends this verbatim', () => {
    expect(ALBUM_SELECT_COLS).not.toMatch(/\s\s|,\s*,|^\s|\s$/)
  })
})

describe('the photo select string is exactly what it always was', () => {
  it('matches the pre-refactor join byte for byte', () => {
    expect(PHOTO_SELECT_COLS).toBe(EXPECTED_PHOTO)
  })

  it('still asks for 23 columns', () => {
    expect(PHOTO_SELECT_COLS.split(', ')).toHaveLength(23)
  })

  it('carries no duplicate column', () => {
    const cols = PHOTO_SELECT_COLS.split(', ')
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('has no stray whitespace', () => {
    expect(PHOTO_SELECT_COLS).not.toMatch(/\s\s|,\s*,|^\s|\s$/)
  })
})

describe('every selected column is a real column', () => {
  // The generated Database type is the schema, so this asks the schema rather than a second list.
  // It is what turns "the string did not change" into "the string is correct".
  it('album columns all exist on albums', () => {
    // The compile-time proof lives in album-access.ts itself: reading a field off the result of
    // .select(ALBUM_SELECT_COLS) fails to compile if any column is misspelled. This runtime
    // assertion is the readable half — it NAMES the column when the two disagree, instead of
    // producing a SelectQueryError somewhere else entirely.
    const known = new Set(Object.keys(ALBUM_ROW_KEYS))
    for (const c of ALBUM_SELECT_COLS.split(', ')) {
      expect(known.has(c), `${c} is selected but is not a column of albums`).toBe(true)
    }
  })
})

// A value-level mirror of Database['public']['Tables']['albums']['Row'], held to the generated type
// by `satisfies`: add or drop a column in the schema and this stops compiling until it is updated,
// so it cannot quietly fall behind the way a hand-kept list does.
const ALBUM_ROW_KEYS = {
  id: 0, user_id: 0, title: 0, slug: 0, custom_slug: 0, owner_token: 0, created_at: 0,
  background_theme: 0, last_activity_at: 0, retired_at: 0, media_radius: 0, video_autoplay: 0,
  media_filter: 0, mobile_grid_columns: 0, slideshow_interval_ms: 0, slideshow_animation: 0,
  last_notification_at: 0, expiry_warning_sent_at: 0, guest_uploads_enabled: 0,
  allow_guest_downloads: 0, cover_photo_id: 0, password_hash: 0, reveal_at: 0,
  face_finder_enabled: 0, photo_layout: 0, require_approval: 0, media_cap_override: 0,
  accent_color: 0, logo_url: 0, welcome_message: 0, hide_branding: 0, title_font: 0,
  photo_style: 0, header_image: 0, header_focal: 0, sponsor_logos: 0, header_touched: 0,
  header_video_mode: 0, header_zoom: 0, bib_search_enabled: 0, bib_min: 0, bib_max: 0,
  slideshow_motion: 0, face_consent_at: 0, face_consent_by: 0, branding_locked: 0,
  desktop_grid_columns: 0, photo_order: 0, package_tier: 0, package_expires_at: 0,
  package_last_order_id: 0, package_reminder_at: 0, deleted_at: 0,
} satisfies Record<keyof Database['public']['Tables']['albums']['Row'], number>
