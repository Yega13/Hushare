// Now that images are downscaled to <1MB, more can go at once without stalling the link.
// The per-upload stall watchdog still recovers any that hang.
export const UPLOAD_CONCURRENCY_MOBILE = 6;
export const UPLOAD_CONCURRENCY_DESKTOP = 12;

// Videos upload their raw bytes as long, sustained TUS streams — very different from the small
// (<1MB) images. Several at once can saturate a weak venue-WiFi uplink, so they get a SEPARATE,
// tight lane (photos keep the wider pool above). Kept deliberately low — NOT photo-level — because
// once the link is the bottleneck, more parallel streams only split bandwidth (no net gain) and
// raise the stall/timeout rate. A small overlap (2/3) hides each clip's fixed overhead (poster +
// Stream handshake + save), which dominates the many-short-clips case, while the per-attempt
// fail-fast timeout + TUS resume keep a concurrent stall cheap to recover.
export const UPLOAD_VIDEO_CONCURRENCY_MOBILE = 2;
export const UPLOAD_VIDEO_CONCURRENCY_DESKTOP = 3;

// A video at/above this size takes the WHOLE video lane to itself (uploads solo) so it never
// competes for bandwidth with another sustained stream — the answer to "what if someone posts a
// 10-minute video". Short event clips fall well under it, so they still overlap for speed.
export const VIDEO_SOLO_LANE_BYTES = 30 * 1024 * 1024;

// Cloudflare Stream TUS requires minimum 5 MB chunks (except the last)
export const STREAM_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export const SWIPE_THRESHOLD_PX = 22;
export const SWIPE_VELOCITY_MIN = 0.22;
export const SWIPE_RESET_ANIMATE_MS = 180;

export const GRID_PRELOAD_MARGIN_PX = 2000;
export const HOLD_TO_SELECT_MS = 500;
export const HOLD_TO_SELECT_MOBILE_MS = 550;
export const SUPPRESS_CLICK_AFTER_REORDER_MS = 300;
export const SUPPRESS_CLICK_AFTER_SELECT_MS = 800;

export const AUTO_SCROLL_ZONE_PX = 120;
export const AUTO_SCROLL_MIN_PX_FRAME = 7;
export const AUTO_SCROLL_MAX_PX_FRAME = 30;

export const BTT_UPDATE_EVENT = "btt-update";

export const MEDIA_CAPTION_MAX = 30;
export const MEDIA_AUTHOR_MAX = 16;
