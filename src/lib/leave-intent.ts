// IS THIS A REAL LEAVE? The two questions behind the owner "save this album" prompt.
//
// An owner who has never signed in gets one prompt when they are about to leave the album: a
// back press, or a click on an in-app link to another page. Eight predicates decide "leave", and
// one of them is a shipped bug: the download buttons create a hidden <a download> and click it,
// and that synthetic click bubbles to the same capture listener -- intercepting it cancelled the
// download and popped the modal instead. The listeners and the history entry stay in the
// component; the judgement lives here.

/**
 * A back press landed on some history entry. Ours (`hushSave`) or the lightbox's (`hushLightbox`)
 * is not a leave; only the album's base entry, with neither flag, is.
 */
export function isRealLeavePop(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return true
  const s = state as { hushSave?: unknown; hushLightbox?: unknown }
  return !s.hushSave && !s.hushLightbox
}

export type LeaveClick = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  /** The anchor's href attribute as written, or null when the click was not on a link. */
  href: string | null
  /** The anchor carries a download attribute. */
  download: boolean
  /** The anchor's target attribute, or null. */
  target: string | null
}

export type CurrentPage = { origin: string; pathname: string; href: string }

/**
 * The absolute URL the click would navigate to, when it is a plain left click on an in-app link
 * to ANOTHER same-origin path -- or null when the click is not a leave: a modifier (new tab), a
 * middle button, a link something already handled, a download, a link that opens elsewhere, a
 * same-page or hash link, mailto/tel, a foreign site we could not pop a prompt over anyway.
 */
export function leaveDestination(click: LeaveClick, current: CurrentPage): string | null {
  if (click.defaultPrevented || click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  if (!click.href) return null
  if (click.download) return null
  if (click.target && click.target !== '_self') return null
  let dest: URL
  try { dest = new URL(click.href, current.href) } catch { return null }
  if (dest.origin !== current.origin || dest.pathname === current.pathname) return null
  return dest.href
}
