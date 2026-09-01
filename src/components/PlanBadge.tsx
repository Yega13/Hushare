import type { Tier } from '@/types'

// The small "PRO" / "MAX" mark next to a control the album's plan cannot use.
//
// Without it a gated control is just a thing that does not work. The owner clicks, nothing happens
// or an error appears, and there is no way to tell "broken" from "not on your plan" — which is the
// worst possible version of an upsell, because it reads as a bug and it never mentions the product.
//
// It says which plan, not "upgrade". Someone who reads "MAX" knows what to buy; someone who reads
// "upgrade" has to go and find out, and most will not.

const LABEL: Record<'pro' | 'studio', string> = { pro: 'Pro', studio: 'Max' }

export function planRank(tier: Tier | null): number {
  return tier === 'studio' ? 2 : tier === 'pro' ? 1 : 0
}

/** True when this album's plan can use a feature needing `need`. */
export function canUse(tier: Tier | null, need: 'pro' | 'studio'): boolean {
  return planRank(tier) >= planRank(need as Tier)
}

export default function PlanBadge({
  need,
  tier,
  className = '',
}: {
  need: 'pro' | 'studio'
  /** The album owner's tier. `null` means not known yet — see below. */
  tier: Tier | null
  className?: string
}) {
  // Nothing at all until the tier is actually known. The badge used to be able to appear and then
  // disappear a few hundred milliseconds later once the tier arrived, which looks like a glitch and
  // briefly tells a paying customer they do not have what they are paying for.
  if (tier === null) return null
  if (canUse(tier, need)) return null

  // A CHIP, not loose text. As bare letters beside a label it read as part of the sentence — people
  // saw "CUSTOM URL PRO" and could not tell whether PRO was a heading, a state, or a word that
  // belonged to the setting. A bordered pill is unmistakably a tag on the thing next to it.
  const studio = need === 'studio'
  return (
    <span
      className={`text-[9.5px] font-bold uppercase ${className}`}
      style={{
        letterSpacing: '0.09em',
        padding: '2px 7px',
        borderRadius: 999,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        flex: 'none',
        color: studio ? '#7A5A22' : '#7C4A2D',
        background: studio ? 'rgba(201, 166, 120, 0.22)' : 'rgba(124, 74, 45, 0.11)',
        border: `1px solid ${studio ? 'rgba(201, 166, 120, 0.55)' : 'rgba(124, 74, 45, 0.28)'}`,
      }}
    >
      {LABEL[need]}
    </span>
  )
}

// The look of a control the album's plan cannot use — ONE definition, so they cannot drift.
//
// They had drifted. Some gated rows dimmed to 0.6, one to 0.55, several not at all; one icon was
// hand-coloured grey (`showLockedCustomize ? '#A89880' : '#7C5C3E'`) while the icons beside it
// stayed full colour. The result read as a half-broken panel rather than a plan boundary, which is
// exactly what the badge exists to prevent.
//
// `grayscale(1)` is what makes the rule hold for anything added later: it drains the icon, the
// wine-coloured label and any swatch in one stroke, so a new gated row cannot forget to grey its
// own icon the way the old per-row styling could. Opacity alone left colour showing and read as
// "loading" rather than "locked".
//
// Deliberately NOT display:none — with ONE carve-out. On a free or subscription album, someone
// who cannot see the control cannot learn the product has it, so locked rows grey out and carry
// their badge as an upsell. A PACKAGE album is different by the owner's explicit rule ("don't
// show anything that is unaccessible"): its owner bought a finished product, and a purchased
// product that nags about the next tier up is noise. So `hideWhenLocked` — passed as true only
// for albums with a live package — makes a locked row vanish instead of greying.
export function gatedRowStyle(locked: boolean, hideWhenLocked = false): {
  cursor: 'not-allowed' | 'pointer'
  opacity: number
  filter: string | undefined
  display?: 'none'
} {
  return {
    cursor: locked ? 'not-allowed' : 'pointer',
    opacity: locked ? 0.55 : 1,
    filter: locked ? 'grayscale(1)' : undefined,
    ...(locked && hideWhenLocked ? { display: 'none' as const } : {}),
  }
}
