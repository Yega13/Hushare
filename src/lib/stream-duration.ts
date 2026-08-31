// HOW MUCH STORAGE QUOTA ONE PENDING VIDEO UPLOAD RESERVES.
//
// Lives here rather than in the route because it carries a property that has to be TESTED, and
// getting it wrong does not throw — it produces an upload that completes and then dies.
//
// THE PROPERTY: the value returned must always be GREATER than the clip it is for. Cloudflare
// does not refuse an upload that exceeds maxDurationSeconds up front; it accepts the bytes and
// fails during processing — the 'error after 100% using TUS' symptom this repo already records
// as its worst video bug. So a value even slightly too small means a guest uploads their whole
// video over venue wifi and watches it fail at 100%, with Cloudflare's error and none of ours.
//
// I broke exactly this by clamping the result to the tier's clip cap, to make Cloudflare enforce
// clip length. It would have fired on the 16% of real videos whose duration the browser cannot
// measure, and on anyone who trimmed a clip to exactly the advertised limit. Clip length is
// enforced by clipTooLong instead, before any bytes move, with a message someone can act on.

const CF_MAX_DURATION_CEILING = 21600 // Cloudflare's absolute max (6h)
// Used ONLY when the client could not measure the video (a failed poster decode). Cloudflare
// reserves this many seconds of account storage quota for the whole time the upload is pending,
// so the exposure is (concurrent failed uploads x this value). At 7200 (2h), six abandoned uploads
// were measured holding 720 of the account's 1000 minutes on 2026-08-20 — 72% of the quota, for
// zero minutes of stored video. Eight would exhaust it, and then EVERY video upload fails for
// everyone, which at an event is the whole room at once.
//
// 900 (15 min) makes that exposure 8x smaller. It caps only videos whose length is unknown;
// anything measurable passes its own tight value computed above. An unmeasurable video longer
// than 15 minutes is refused, which is a far better failure than one stuck upload denying video
// to an entire event.
const FALLBACK_MAX_DURATION = 900
// THIS IS A QUOTA RESERVATION, NOT THE CLIP-LENGTH LIMIT. Do not clamp it to the tier cap.
//
// I tried exactly that and it was the worst idea in this change. Going over maxDurationSeconds is
// NOT a refusal: createStreamUpload's own comment records the symptom — the upload succeeds, then
// "FAILS during processing (the 'error after 100% using TUS' symptom)". So enforcing clip length
// here means a guest uploads their whole video over venue wifi and watches it die at 100% with
// Cloudflare's error and none of ours.
//
// And it fires on people who did nothing wrong. Measured on the live library: 25 of 155 videos
// (16%) have no duration at all, because generateVideoPoster timed out or the browser could not
// decode the file. One live album has 15 videos and 15 of them unmeasured — that device never
// reports duration. Clamping sent every one of those to a 60-second ceiling instead of 900.
//
// The margin below is what this is for, and its only job: Cloudflare RESERVES maxDurationSeconds
// of account quota per pending upload, and six abandoned uploads once held 720 of the account's
// 1,000 minutes and blocked video for everyone. The formula always exceeds the measured duration,
// so it can never kill a real upload — which is the property that matters.
//
// Clip length is enforced by clipTooLong, before any bytes move, with a message someone can act on.
export function resolveMaxDurationSeconds(durationSeconds: unknown): number {
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    const withMargin = Math.ceil(durationSeconds * 1.5) + 60
    return Math.min(CF_MAX_DURATION_CEILING, Math.max(60, withMargin))
  }
  return FALLBACK_MAX_DURATION
}
