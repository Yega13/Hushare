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

// How far outside the viewport a tile starts preloading its full image.
//
// Two screens of lead-in. It was briefly cut to 400px alongside the fetchPriority change below,
// on the theory that preloading was stealing bandwidth from guests' uploads. That was one change
// too many: PRIORITY was the actual problem — 'high' told the browser that images nobody is
// looking at outrank the photos the guest is sending. The DISTANCE was never the problem, and
// shortening it just meant fast scrolling outran the loader and showed bare background, which
// looks broken. At 'low' the browser already yields to the uploads on its own, so the lead-in can
// stay generous. Reverted 2026-08-20 after it was visibly worse on a real phone.
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

// How many photos the ZIP download fetches at once.
//
// This was a single value of 16, chosen for "typical home broadband" — and a phone is not that. A
// guest on an iPhone asked for a 16-photo album whose images average 2.5MB, so all sixteen started
// at once, roughly 35MB of blobs in flight on a handset, and every single one of them failed. The
// report read "16 of 16", which is the signature of a batch that went out together rather than of
// sixteen independent accidents.
//
// Downloads are the half of this product that had no instrumentation for its whole life, so nobody
// had ever seen this happen before it was reported.
export const DOWNLOAD_CONCURRENCY_MOBILE = 4;
export const DOWNLOAD_CONCURRENCY_DESKTOP = 16;

// Each photo gets more than one go before it is given up on. A single dropped connection on venue
// wifi should not silently remove a photo from somebody's album download.
export const DOWNLOAD_ATTEMPTS = 3;

// The most photos one bulk-delete request may carry. The route refuses more; the select-mode client
// chunks its selection to exactly this. It was written twice -- 500 in the route, "server max is
// 200" in a client comment beside a CHUNK of 200 -- and the two had already drifted (rule 13).
//
// 300, MEASURED, not typed. The route's first query is `id=in.(<every uuid>)` in a PostgREST URL,
// and PostgREST echoes that URL back in a Content-Location header. Node's fetch caps a response
// header block at 16 KB, and Cloudflare documents 16 KB for a request URL: 500 ids made a 19.6 KB
// URL that failed under `next dev` with "fetch failed" -- after the client had already removed
// every tile optimistically. The client had only ever sent 200, so the route's 500 had never been
// exercised. tests/deletion.test.ts holds this number to the arithmetic.
export const MAX_BULK_DELETE = 300
