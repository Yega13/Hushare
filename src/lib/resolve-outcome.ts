import type { Album } from '@/types'

// WHAT THE RESOLVE ANSWER MEANS -- five outcomes from a status and a body, in an order that matters.
//
// This sat inline in AlbumPageClient's fetch as five if-blocks, each ending in a setState. The
// ORDER is the documented bug: a 404 is decided before any body flag is read, because an API that
// answers 404 + password_required to hide whether an album exists would otherwise put the visitor
// in a password prompt that can never succeed, forever. And a gate body missing its title is a
// server fault, not a gate with "undefined" on it. The network stays in the component; only the
// judgement lives here, where a test can hold the order.

export type ResolveOutcome =
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'password'; slug: string; title: string }
  | { kind: 'reveal'; revealAt: string; slug: string; title: string }
  | { kind: 'album'; album: Album }

function gateFields(body: Record<string, unknown>): { slug: string; title: string } | null {
  if (typeof body.slug !== 'string' || typeof body.title !== 'string') return null
  return { slug: body.slug, title: body.title }
}

export function classifyResolve(status: number, ok: boolean, body: unknown): ResolveOutcome {
  // Real not-found (deleted or never existed) -- BEFORE the body flags, see above.
  if (status === 404) return { kind: 'not-found' }
  // Anything else the server refused is transient: the page offers a retry, not a gate.
  if (!ok) return { kind: 'error' }
  const json = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  // Password gate: 200 with the flag. Missing name or slug is a malformed answer, not a gate.
  if (json.password_required === true) {
    const gate = gateFields(json)
    return gate ? { kind: 'password', ...gate } : { kind: 'error' }
  }
  // Reveal gate: 200 with locked + a reveal time. A time that is not a string is a malformed
  // answer (a reviewer found the first version of this quietly rendering such a body as the
  // album). locked with NO time falls through to the album check, which refuses it for having no
  // id -- the route never sends that shape; this is the inline code's behaviour kept exactly.
  if (json.locked === true && json.reveal_at) {
    if (typeof json.reveal_at !== 'string') return { kind: 'error' }
    const gate = gateFields(json)
    return gate ? { kind: 'reveal', revealAt: json.reveal_at, ...gate } : { kind: 'error' }
  }
  // A full album has a string id; gate answers legitimately do not, and were handled above.
  if (typeof json.id !== 'string') return { kind: 'error' }
  return { kind: 'album', album: json as unknown as Album }
}
