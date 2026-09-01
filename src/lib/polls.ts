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
      { key: 'design',     label: 'Designable albums',            hint: 'Give every album its own cover, colour, font and mood, in seconds.' },
      { key: 'music',      label: 'Music on the wall',            hint: 'Play a soundtrack under the live slideshow, so the room has a pulse, not just pictures.' },
      { key: 'reactions',  label: 'Reactions & comments',         hint: 'Let guests heart a photo or drop a line under it, right inside the album.' },
      { key: 'guestbook',  label: 'A guestbook',                  hint: 'A place for guests to leave the host a written message — the words, not only the photos.' },
      { key: 'facefinder', label: 'Find-your-photos everywhere',  hint: 'Take one selfie and pull every photo you appear in — on every plan, not just Max.' },
      { key: 'privacy',    label: 'More privacy',                 hint: 'Secret albums, password locks, and reveal-later timers for moments you want held back.' },
      { key: 'recap',      label: 'Auto highlight video',         hint: 'We stitch the best shots into a short recap reel you can share the moment it ends.' },
    ],
  },
}

// hasOwn, not `POLLS[key] ?? null`: a plain object inherits from Object.prototype, so the keys
// 'constructor', 'toString', '__proto__' and friends all resolved to truthy inherited members and
// sailed past the caller's `if (!poll) return 404`. GET /api/poll/constructor answered 200 with a
// malformed body after running a real database query for a poll that does not exist, and POST threw
// on `poll.options` being undefined — a 500 on an unauthenticated route. Neither leaked anything,
// but "Unknown poll" is a promise the lookup has to keep for every key, not just the ones that are
// not also property names (rule 20: say no when the answer is no).
export function getPoll(key: string): PollDef | null {
  return Object.hasOwn(POLLS, key) ? POLLS[key] : null
}
