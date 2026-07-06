// Now that images are downscaled to <1MB, more can go at once without stalling the link.
// The per-upload stall watchdog still recovers any that hang.
export const UPLOAD_CONCURRENCY_MOBILE = 6;
export const UPLOAD_CONCURRENCY_DESKTOP = 12;

// Cloudflare Stream TUS requires minimum 5 MB chunks (except the last)
export const STREAM_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export const SWIPE_THRESHOLD_PX = 30;
export const SWIPE_VELOCITY_MIN = 0.3;
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
