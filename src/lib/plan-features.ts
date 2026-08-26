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
// SCOPE IS THE HONEST PART, AND IT MOVES. Only features the server genuinely gates may appear under
// a paid plan — and the gates are not frozen, so this list is only correct while it tracks them.
// Grep for `refuseBelowTier` and `albumHasTier`; as of today they are:
//   pro and above  — custom album URL (api/album/custom-url), removing Hushare branding
//                    (api/album/branding), a custom logo (api/album/logo), photo moderation
//                    (api/album/media-settings), the countdown reveal (api/album/reveal), and the
//                    higher album/media/upload limits
//   studio only    — Face Finder (api/album/face-index, face-search), Collections (app/c/[slug]),
//                    the live photo wall (app/wall/[slug]), sponsor logos (api/album/sponsors) and
//                    bib-number search (api/album/bib-search)
// Password protection, custom backgrounds and QR sharing are NOT gated, and listing them as paid
// perks would be selling something already free.
//
// THE LIVE WALL MOVED AND THIS FILE DID NOT. It used to be ungated, so it was listed as a free
// feature; once app/wall/[slug] started requiring Max, the free plan went on promising a page the
// product refuses to open — on the account page, which is where someone decides whether to pay. The
// test that was supposed to prevent exactly this asserted the OLD gate, so it passed. Whenever a
// gate is added or removed, this list and tests/plan-features.test.ts have to move with it.

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
      { key: 'plan.photoWall' },
      { key: 'plan.sponsors' },
      { key: 'plan.bibSearch' },
      { key: 'plan.noBranding' },
    ]
  }

  if (tier === 'pro') {
    return [
      ...limits('pro'),
      { key: 'plan.customUrl' },
      { key: 'plan.noBranding' },
      { key: 'plan.logo' },
      { key: 'plan.moderation' },
      { key: 'plan.reveal' },
    ]
  }

  // Free. Named for what it genuinely includes rather than what it lacks — these are real, and
  // people are choosing whether to trust the product at all before they consider paying for it.
  return [...limits('free'), { key: 'plan.password' }, { key: 'plan.qr' }]
}
