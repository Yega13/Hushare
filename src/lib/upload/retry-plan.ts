import type { DictKey } from '@/i18n/dictionaries/en'

// WHAT A RETRY MEANS, AND WHAT A REFUSED SAVE IS OWED.
//
// Three rules that were written in four places each inside UploadZone.
//
// 1. RE-SAVE, NEVER RE-UPLOAD. When the server refuses the database insert -- a full album, a
//    network blip on the save -- the file's BYTES are already in R2 and its row is held for the
//    "Finish saving" button. But the tile is marked 'error', so it also appeared in the failed
//    chip, and tapping either the chip or the tile RE-UPLOADED it: new presigned key, the same
//    bytes again, a second row queued for the same file. Once the guest registered and the album
//    had room, both rows inserted and the album showed the photo twice, with the first upload's
//    bytes orphaned in R2 if they never did. An entry whose row is already waiting must be
//    re-saved, which is one request, and never re-sent.
// 2. ONE AUTOMATIC RESUME PER FILE. A parked tile tapped by hand only skips the wait, so it
//    spends the one resume; a genuinely failed tile tapped by hand is a fresh decision by someone
//    who may have just switched to mobile data, so it earns a new one.
// 3. WHICH WALL THE BANNER SHOWS when refusals of different kinds arrive together.

export type FileStatus = 'pending' | 'uploading' | 'done' | 'error' | 'waiting'
export type RetryTrigger = 'tap' | 'chip' | 'auto'

/**
 * Does this failure park the tile and wait for the network, or become a manual Retry? Recoverable
 * only counts once: a second network failure means the automatic recovery is not working for this
 * file, so it stops being clever and hands the guest the button.
 */
export function shouldPark(recoverable: boolean, entry: { autoResumed?: boolean }): boolean {
  return recoverable && !entry.autoResumed
}

/**
 * How a retry of this entry must be carried out. 'resave' when its row is already queued for the
 * save that was refused -- the bytes are in R2 and re-uploading them duplicates the photo.
 */
export function retryMode(entryId: string, pendingSaveIds: ReadonlySet<string>): 'resave' | 'reupload' {
  return pendingSaveIds.has(entryId) ? 'resave' : 'reupload'
}

/**
 * The entry as it starts its retry, or null when this entry is not retryable at all. `tap` on a
 * parked tile spends the automatic resume (rule 2 above); every other manual trigger earns a fresh
 * one; `auto` is the automatic resume itself, so it spends it.
 */
export function freshEntryFor<E extends { status: FileStatus; autoResumed?: boolean }>(entry: E, trigger: RetryTrigger): E | null {
  // Each trigger has its own subject. The TILE offers both: a failed file to retry, and a parked
  // one for anyone who would rather not wait for the probe. The CHIP collects failures only -- a
  // parked tile is about to upload itself and must never be listed as something to act on. The
  // AUTO resume is the probe answering, and it acts on exactly what is parked.
  if (trigger === 'tap' && entry.status !== 'error' && entry.status !== 'waiting') return null
  if (trigger === 'chip' && entry.status !== 'error') return null
  if (trigger === 'auto' && entry.status !== 'waiting') return null
  return {
    ...entry,
    status: 'pending' as FileStatus,
    progress: 0,
    error: undefined,
    // The auto resume IS the one resume. Tapping a parked tile only skips its wait, so it spends
    // it too. Tapping a failed tile, or the chip, is a fresh decision and earns a new one.
    autoResumed: trigger === 'auto' || (trigger === 'tap' && entry.status === 'waiting'),
  }
}

/** Which banner a refused save puts up. */
export type Wall = 'full' | 'fullOther' | 'refused' | 'failed'

/**
 * 'full' is the state that OFFERS AN ACCOUNT, so it is only correct when the server actually said
 * registering would help: inferring it from the code alone showed a signed-in Max owner "Your
 * album is full -- create a free account", above a button that would be refused forever.
 */
export function wallFor(code: string | undefined, nudge: string | undefined, expected = false): Wall {
  // `expected` is isExpectedRefusal's answer about the message, passed in rather than recomputed:
  // the album turned this save down ON PURPOSE (uploads switched off, a password gate, a reveal
  // date). It is not 'failed', whose words promise a brief connection drop and tell the guest to
  // retry a step that will be declined again. It is deliberately ONE wall for every such reason --
  // the specific one is already on each tile, and a wall that named a cause would name the wrong
  // one for the other two.
  if (code !== 'album_full') return expected ? 'refused' : 'failed'
  return nudge === 'register' ? 'full' : 'fullOther'
}

/**
 * A cap refusal outranks a refusal of another kind, which outranks a transient failure, and the one
 * that offers an account outranks all three.
 *
 * A RANK, not a chain of pairs. With three walls the pairs were readable; the fourth is where a
 * hand-written chain stops being a total order without anyone noticing -- the old code returned
 * `next` for every case it had not enumerated, so adding 'refused' to it would have let a later
 * plain failure quietly demote a refusal, and nothing would have said so.
 */
const WALL_RANK: Record<Wall, number> = { full: 3, fullOther: 2, refused: 1, failed: 0 }

export function mergeWall(prev: Wall | null, next: Wall): Wall {
  if (prev === null) return next
  return WALL_RANK[next] > WALL_RANK[prev] ? next : prev
}

/**
 * WHAT THE BANNER SAYS, AND WHICH BUTTONS BELONG ON IT.
 *
 * The wall began as the answer to a refused SAVE, where the bytes are already in R2 and the rows are
 * held -- so every sentence promises that "{n} photos are uploaded but not saved yet" and every wall
 * offers "Finish saving". Presign refuses a full album now, BEFORE any bytes move, and that wall has
 * nothing held: the same copy would claim photos were uploaded that never left the phone, and the
 * button would post an empty list.
 *
 * So the words follow the number of rows actually held, and the buttons follow what there is to do.
 * Pure, and here rather than in the component, because a three-way ternary inside JSX is a decision
 * no test can reach.
 */
export type WallCopy = { title: DictKey; body: DictKey; offersAccount: boolean; canFinish: boolean }

export function wallCopy(wall: Wall, heldRows: number): WallCopy {
  const canFinish = heldRows > 0
  // Registering only helps when the server said it would (see wallFor), so only 'full' offers it.
  if (wall === 'failed') return { title: 'uploadWall.failedTitle', body: 'uploadWall.failedBody', offersAccount: false, canFinish }
  if (wall === 'refused') {
    // The TITLE is failedTitle on purpose: "{n} photos uploaded, not saved yet" is exactly as true
    // of a refusal, and it is already translated in all three languages -- so an Armenian guest
    // keeps an Armenian heading instead of falling back to English for the whole banner. Only the
    // BODY had to change, because failedBody explains the cause as a connection drop and tells them
    // to tap a button the album will decline again.
    return { title: 'uploadWall.failedTitle', body: canFinish ? 'uploadWall.refusedBody' : 'uploadWall.refusedBodyNone', offersAccount: false, canFinish }
  }
  if (wall === 'full') {
    return { title: 'uploadWall.title', body: canFinish ? 'uploadWall.body' : 'uploadWall.bodyNone', offersAccount: true, canFinish }
  }
  return { title: 'uploadWall.fullTitle', body: canFinish ? 'uploadWall.fullBody' : 'uploadWall.fullBodyNone', offersAccount: false, canFinish }
}

/**
 * THE BANNER DESCRIBES THE LAST ATTEMPT, so a new attempt clears one that has nothing left to say.
 *
 * The wall used to be raised only where rows were queued, and finishing those rows took it down. A
 * full album refused at PRESIGN raises it with nothing queued -- and then nothing could ever clear
 * it: the only reset lives behind "Finish saving", which is neither rendered nor reachable when the
 * queue is empty. The owner frees space, the guest re-adds the same photos, they upload and save,
 * and "This album has no room left" sits above the green tiles (rule 20).
 *
 * A wall with rows still held survives, because those rows are still waiting and the sentence is
 * still true. Everything else goes, and the attempt that follows re-raises whatever it earns.
 */
export function wallOnNewAttempt(prev: Wall | null, heldRows: number): Wall | null {
  return heldRows > 0 ? prev : null
}

/**
 * The queue of rows waiting for "Finish saving", with each entry held ONCE. Without the key a
 * second refusal for the same file appended a second pair, the banner counted the same photo
 * twice, and finishing the job posted both.
 */
export function queuePendingRows<P extends { entryId: string }>(existing: P[], incoming: P[]): P[] {
  const byId = new Map(existing.map((p) => [p.entryId, p]))
  for (const p of incoming) byId.set(p.entryId, p)
  return [...byId.values()]
}
