// Poll definitions. A statement's `poll_key` (statements table) points at one of these; the
// StatementPoll widget renders it and /api/poll/[key] validates votes against it. Options are a
// fixed allowlist so a tampered client can't inject arbitrary option_keys into the tally.

export type PollOption = { key: string; label: string; hint?: string }
export type PollDef = { question: string; note?: string; options: PollOption[] }

export const POLLS: Record<string, PollDef> = {
  'album-looks-2026': {
    question: 'Which look would you want for your album?',
    note: 'Your pick helps us decide which to build first.',
    options: [
      { key: 'blossom', label: 'Blossom', hint: 'Elegant serif · warm blush' },
      { key: 'encore',  label: 'Encore',  hint: 'Bold caps · midnight indigo' },
      { key: 'trail',   label: 'Trail',   hint: 'Clean sans · forest green' },
      { key: 'linen',   label: 'Linen',   hint: 'Light & minimal · near-white' },
    ],
  },
}

export function getPoll(key: string): PollDef | null {
  return POLLS[key] ?? null
}
