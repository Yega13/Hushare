// Poll definitions. A statement's `poll_key` (statements table) points at one of these; the
// StatementPoll widget renders it and /api/poll/[key] validates votes against it. Options are a
// fixed allowlist so a tampered client can't inject arbitrary option_keys into the tally.

export type PollOption = { key: string; label: string; hint?: string; swatch?: string }
export type PollDef = { question: string; note?: string; options: PollOption[] }

export const POLLS: Record<string, PollDef> = {
  // Roadmap poll — asks what to build next (useful product signal), not cosmetic preferences.
  'hushare-roadmap-2026': {
    question: 'What should we build next?',
    note: 'Pick the one you would want most — it genuinely shapes what we build first.',
    options: [
      { key: 'design',     label: 'Designable albums',            hint: 'Custom covers, fonts & colours — the mockup above' },
      { key: 'music',      label: 'Music on the wall',            hint: 'A soundtrack for the live slideshow' },
      { key: 'reactions',  label: 'Reactions & comments',         hint: 'Like and reply to photos' },
      { key: 'guestbook',  label: 'A guestbook',                  hint: 'Guests leave a written note' },
      { key: 'facefinder', label: 'Find-your-photos everywhere',  hint: 'Selfie search on every plan, not just Max' },
      { key: 'privacy',    label: 'More privacy',                 hint: 'Secret & reveal-later albums' },
      { key: 'recap',      label: 'Auto highlight video',         hint: 'A recap reel of the whole event' },
    ],
  },
}

export function getPoll(key: string): PollDef | null {
  return POLLS[key] ?? null
}
