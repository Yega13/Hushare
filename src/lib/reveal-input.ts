// THE DELAYED-REVEAL PANEL'S DECISIONS, without the panel.
//
// Three small rules lived inline in OwnerToolbar: how an ISO timestamp becomes the value a
// <input type="datetime-local"> can hold, what "save" and "clear" send (and when an input is
// refused BEFORE the request goes out, so an invalid date never leaves the button stuck on
// "Saving..."), and whether an album's reveal is still ahead. None of them needs a component;
// all of them decide what a guest can see and when.

/** An ISO timestamp as the LOCAL wall-clock value a datetime-local input holds; '' for none/invalid. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type RevealRequest =
  | { ok: true; revealAt: string | null }
  | { ok: false; error: 'invalid' }

/**
 * What to send for a save or a clear.
 *
 * 'clear' always sends null. 'set' with an empty input also sends null (the button is disabled on an
 * empty input, so this is the keyboard path). 'set' with text that is not a date is refused HERE,
 * before any request: the old panel validated after flipping "saving" on, and an invalid date left
 * the button on "Saving..." forever.
 */
export function revealRequestFor(action: 'set' | 'clear', input: string): RevealRequest {
  if (action === 'clear' || !input) return { ok: true, revealAt: null }
  const parsed = new Date(input)
  if (isNaN(parsed.getTime())) return { ok: false, error: 'invalid' }
  return { ok: true, revealAt: parsed.toISOString() }
}

export type RevealStatus = 'none' | 'future' | 'past'

/** Is this album still sealed? Decided against a `now` the caller supplies, so it is testable and stable within one render. */
export function revealStatus(revealAt: string | null | undefined, now: Date): RevealStatus {
  if (!revealAt) return 'none'
  const at = new Date(revealAt)
  if (isNaN(at.getTime())) return 'none'
  return at > now ? 'future' : 'past'
}
