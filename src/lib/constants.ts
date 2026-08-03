// Now that images are downscaled to <1MB, more can go at once without stalling the link.
// The per-upload stall watchdog still recovers any that hang.
export const UPLOAD_CONCURRENCY_MOBILE = 6;
export const UPLOAD_CONCURRENCY_DESKTOP = 12;

// Videos upload their raw bytes as long, sustained TUS streams — very different from the small
// (<1MB) images. STRICTLY ONE at a time on mobile: proven live (2026-08-03) that even TWO concurrent
// video streams on a weak/filtering network (the exact networks that force the same-origin relay)
// tip it from "all uploads fine, serial" into a storm of chunk-at-offset-0 failures + 15-min stalls.
// On such links the uplink is the bottleneck, so parallel streams don't add throughput — they only
// multiply the failure rate. Desktop (usually a strong wired link) can afford two. The weighted
// semaphore + VIDEO_SOLO_LANE_BYTES below stay in place as the substrate for a future *adaptive*
// ramp-up (start at 1, widen only once a network proves it can take it) — the only safe way to
// speed this up without regressing the venues Hushare actually runs on.
export const UPLOAD_VIDEO_CONCURRENCY_MOBILE = 1;
export const UPLOAD_VIDEO_CONCURRENCY_DESKTOP = 2;

// A video at/above this size takes the WHOLE video lane to itself (uploads solo) so it never competes
// for bandwidth with another sustained stream. Inert while mobile concurrency is 1; ready for the
// adaptive ramp-up described above.
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
