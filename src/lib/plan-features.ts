import type { Tier } from '@/types'
import {
  albumCountLimitForTier,
  albumMediaCapForTier,
  uploadCapsForTier,
  formatCapSize,
} from '@/lib/media'

// What each plan actually gives you — one list, derived from the limits the server enforces.
//
// This exists because the lists were written by hand in two places and had drifted away from the
// code AND from each other. The Pro card advertised "Max Collections", which is Max only, next to
// "Password protection", which every free album has had all along — so it simultaneously promised
// something Pro does not include and took credit for something nobody has to pay for. The dashboard
// still quoted a 250-item cap that the server stopped using long ago.
//
// Nothing here is a hardcoded number. Album counts, per-album caps and upload sizes are read from
// the same constants the API routes check against, so a limit cannot be changed in one place and
// left stale on the page that sells it.
//
// SCOPE IS THE HONEST PART. Only features that are genuinely gated appear under a paid plan. As of
// today the server gates exactly these:
//   pro and above  — custom album URL (api/album/custom-url), removing Hushare branding
//                    (api/album/branding), and the higher album/media/upload limits
//   studio only    — Face Finder (api/album/face-index, face-search) and Collections (app/c/[slug])
// Password protection, custom backgrounds, the live photo wall and QR sharing are NOT gated, and
// listing them as paid perks would be selling something already free.

export type PlanFeature = { key: string; vars?: Record<string, string | number> }

function limits(tier: Tier): PlanFeature[] {
  const caps = uploadCapsForTier(tier)
  return [
    { key: 'plan.albums', vars: { n: albumCountLimitForTier(tier) } },
    { key: 'plan.perAlbum', vars: { n: albumMediaCapForTier(tier) } },
    {
      key: 'plan.uploads',
      vars: { photo: formatCapSize(caps.image), video: formatCapSize(caps.video) },
    },
  ]
}

export function planFeatures(tier: Tier, isAdmin = false): PlanFeature[] {
  if (isAdmin) return [{ key: 'plan.everything' }, ...limits('studio')]

  if (tier === 'studio') {
    return [
      ...limits('studio'),
      { key: 'plan.faceFinder' },
      { key: 'plan.collections' },
      { key: 'plan.noBranding' },
    ]
  }

  if (tier === 'pro') {
    return [...limits('pro'), { key: 'plan.customUrl' }, { key: 'plan.noBranding' }]
  }

  // Free. Named for what it genuinely includes rather than what it lacks — these are real, and
  // people are choosing whether to trust the product at all before they consider paying for it.
  return [...limits('free'), { key: 'plan.password' }, { key: 'plan.photoWall' }, { key: 'plan.qr' }]
}
