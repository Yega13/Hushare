import type { Tier } from '@/types'

// ── Hushare Studio config ───────────────────────────────────────────────────
// A credit = one generated picture. These numbers are PLACEHOLDERS — tune freely.

// Free monthly credits granted per plan tier (applied lazily on first use each month).
export const STUDIO_MONTHLY_CREDITS: Record<Tier, number> = {
  free: 3,
  pro: 30,
  studio: 100,
}

// One-time credit packs bought through Polar. Anchor from the approved "$3 → 20 pcs"; larger packs
// give a small bonus. `custom` lets the user pay any amount at the same per-credit rate.
export const STUDIO_CREDIT_PER_USD = 20 / 3 // ≈ 6.67 credits per $1 (the $3 = 20 anchor)

export type CreditPack = { id: string; usd: number; credits: number }
export const STUDIO_CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_3', usd: 3, credits: 20 },
  { id: 'pack_5', usd: 5, credits: 35 },
  { id: 'pack_10', usd: 10, credits: 75 },
]

// Credits for a custom dollar amount (Phase 4 checkout). Clamped to a sane min/max.
export function creditsForUsd(usd: number): number {
  const clamped = Math.max(1, Math.min(500, usd))
  return Math.round(clamped * STUDIO_CREDIT_PER_USD)
}

// A single generation styles 1–3 uploaded photos; each output image costs one credit.
export const STUDIO_MAX_INPUTS = 3

// ── Style catalog ─────────────────────────────────────────────────────────────
// Each style has a `prompt` (the backend "working prompt" sent to fal Kontext) and an optional
// `example` reference image. These are sensible DEFAULTS — replace names/prompts/examples freely,
// and add an example image URL per style for the picker.
export type StyleDef = {
  id: string
  name: string
  prompt: string
  example?: string
}

export const STUDIO_STYLES: StyleDef[] = [
  { id: 'vintage_film',   name: 'Vintage Film',    prompt: 'Reimagine this photo as a warm vintage 35mm film photograph — soft grain, gently faded highlights and nostalgic tones. Keep the same subject, faces and composition.' },
  { id: 'studio_portrait', name: 'Studio Portrait', prompt: 'Turn this into a professional studio portrait with soft key lighting and a clean neutral backdrop, with subtle natural skin retouching. Preserve the person’s identity, expression and pose.' },
  { id: 'watercolor',     name: 'Watercolor',      prompt: 'Transform this photo into a delicate watercolor painting with visible brush strokes and soft blended colors, keeping the composition and subject clearly recognizable.' },
  { id: 'oil_painting',   name: 'Oil Painting',    prompt: 'Render this photo as a classical oil painting with rich textured brushwork and warm gallery lighting. Preserve the subject and composition.' },
  { id: 'cyberpunk',      name: 'Cyberpunk',       prompt: 'Restyle this photo with a neon cyberpunk aesthetic — moody blue and magenta lighting and futuristic city glow — while keeping the subject, faces and composition intact.' },
  { id: 'anime',          name: 'Anime',           prompt: 'Convert this photo into a clean anime illustration with cel shading and expressive features, keeping the pose and composition.' },
]

export function styleById(id: string): StyleDef | undefined {
  return STUDIO_STYLES.find((s) => s.id === id)
}
