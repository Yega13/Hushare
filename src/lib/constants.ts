// Now that images are downscaled to <1MB, more can go at once without stalling the link.
// The per-upload stall watchdog still recovers any that hang.
export const UPLOAD_CONCURRENCY_MOBILE = 6;
export const UPLOAD_CONCURRENCY_DESKTOP = 12;

// ── Adaptive video-upload concurrency ──────────────────────────────────────────────────────────
// Videos upload raw bytes as long, sustained TUS streams — nothing like the small (<1MB) images —
// and the networks that force our same-origin relay can't take several at once (proven live
// 2026-08-03: two concurrent streams turned "all fine, serial" into a storm of chunk-at-offset-0
// failures + 15-min stalls). So the video lane is ADAPTIVE and fail-safe:
//   • always START at 1 (today's reliable behaviour);
//   • widen exactly ONE step only after VIDEO_WIDEN_AFTER_CLEAN clean uploads in a row;
//   • the instant ANY video upload fails on the network, snap back to 1 and STOP probing for the
//     rest of the session (the network has shown its ceiling).
// A good link quietly reaches the max; a hostile one stays at 1. Worst case === strictly serial.
export const VIDEO_CONCURRENCY_START = 1;
export const VIDEO_CONCURRENCY_MAX_MOBILE = 2;
export const VIDEO_CONCURRENCY_MAX_DESKTOP = 3;
export const VIDEO_WIDEN_AFTER_CLEAN = 3;

// A video at/above this size takes the WHOLE video lane to itself (uploads solo) so it never competes
// for bandwidth with another sustained stream — matters only once the lane has widened past 1.
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
