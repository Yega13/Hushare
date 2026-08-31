import { flushSync } from 'react-dom'

// Morph the tapped thumbnail into the full-size photo, instead of cutting to it.
//
// Opening a photo is the most repeated interaction in the product — every guest, every album,
// dozens of times — and it was a hard cut: the grid vanished, the lightbox appeared. The View
// Transitions API lets the browser animate between the two DOM states, so the thumbnail visibly
// becomes the photo and shrinks back into its own tile on close.
//
// DEGRADES TO EXACTLY TODAY'S BEHAVIOUR. Chrome, Edge and Android have it; Safari only from 18.2.
// Where it is missing the state change simply happens, which is the hard cut everyone already has —
// nobody loses anything, and there is nothing to rebuild for those browsers.

const MORPH = 'hush-photo-morph'
// Closing uses a DIFFERENT name so the two directions can be styled independently.
//
// With the cross-fade killed, exactly one snapshot is visible — and which one has to differ. Opening
// shows the NEW (the full lightbox photo): the group starts at the tile's small square, so
// object-fit: cover crops it to exactly what the tile was showing, then un-crops as it grows.
// Closing shown the same way meant the NEW was the tile's SQUARE thumbnail displayed in the wide
// lightbox box — cover scaled it up to fill, so the picture visibly zoomed IN before shrinking away.
// Closing therefore shows the OLD, the full photo already on screen, and simply crops as it
// travels down into the tile. Mirror image of opening, which is what it should have been.
const MORPH_OUT = 'hush-photo-morph-out'

// Marks the document while a CLOSE is in flight, so the stylesheet can hold the backdrop dark until
// the photo is nearly home. Opening wants the opposite and gets the default. Direction is not
// something CSS can see on its own — the transition looks identical from the outside either way.
const CLOSING = 'hush-morph-closing'

// The lightbox photo currently on screen. It carries MORPH by default; closing renames it so the
// pair is matched under the outbound name.
function lightboxImage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.hush-lightbox-photo')
}

type WithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> }
}

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined'
    && typeof (document as WithVT).startViewTransition === 'function'
    // Honour the same preference everything else here does. A morph is motion.
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// The tile's <img> for a given photo, or null if it is not currently in the DOM (scrolled far out
// of a virtualised grid, or already removed).
function tileImage(root: HTMLElement | null, photoId: string): HTMLElement | null {
  if (!root) return null
  return root.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(photoId)}"] img`)
}

// A morph is only worth having when its destination is on (or near) the screen. A tile can be
// MOUNTED yet thousands of pixels away — swipe from photo 100 to photo 2,000 and close, and the
// return tile exists far below the fold. Morphing there makes the browser snapshot a page with
// thousands of image tiles and fly the photo across several screen-heights: a visible stall on a
// phone, for an animation that lands somewhere the person cannot see anyway. Near-viewport
// closes keep the morph; distant ones take the plain cut.
function tileNearViewport(img: HTMLElement): boolean {
  const r = img.getBoundingClientRect()
  const margin = 200
  return r.bottom > -margin && r.top < window.innerHeight + margin
}

// Run `update` as a view transition, morphing between the grid tile and the lightbox.
//
// `update` MUST change the DOM synchronously, hence flushSync — React would otherwise batch the
// state change to after the browser has already snapshotted the "new" state, and the transition
// would capture no change at all.
export function morphPhoto(
  gridRoot: HTMLElement | null,
  photoId: string,
  update: () => void,
): void {
  const doc = document as WithVT
  const img = tileImage(gridRoot, photoId)

  if (!supportsViewTransitions() || !img || !doc.startViewTransition) {
    update()
    return
  }

  // Name the OLD element so the browser knows what this photo looked like before.
  img.style.viewTransitionName = MORPH

  const transition = doc.startViewTransition(() => {
    // Cleared BEFORE the DOM update, not after. The old state was captured the moment the
    // transition started, so the name has already done its job — and clearing it first means the
    // tile and the newly mounted lightbox image never hold the same name at the same instant. A
    // duplicate makes the browser abandon the transition, and the window between two statements is
    // not empty here: mounting the lightbox runs a ref callback that forces a layout read.
    img.style.viewTransitionName = ''
    flushSync(update)
  })

  // Belt and braces — an interrupted transition (a second tap, a navigation) can leave a stray name
  // behind, which then breaks the NEXT transition rather than this one: the sort of bug that looks
  // random and is miserable to chase.
  void transition.finished.catch(() => {}).finally(() => {
    img.style.viewTransitionName = ''
  })
  // `ready` REJECTS whenever a transition is skipped — a second tap, a backgrounded tab. Untouched,
  // that surfaces as an unhandled rejection, and this app reports those to the server at error
  // level. On the most-tapped interaction in the product that is a spurious alert during a live
  // event, which is worse than the animation it came from.
  void transition.ready.catch(() => {})
}

// Closing is the same morph in reverse: the lightbox image carries the name already, and the tile
// needs to claim it for the new state.
export function morphPhotoClosed(
  gridRoot: HTMLElement | null,
  photoId: string,
  update: () => void,
): void {
  const doc = document as WithVT

  // Bail when there is no tile to return to — the photo was deleted, or the grid has scrolled far
  // away. Opening already did this; closing did not, so a photo with no destination dissolved in
  // mid-screen for 280ms instead of simply closing. Without a counterpart there is nothing to morph
  // INTO, and the animation is worse than none.
  const target = tileImage(gridRoot, photoId)
  if (!supportsViewTransitions() || !doc.startViewTransition || !target || !tileNearViewport(target)) {
    update()
    return
  }

  // Renamed before the transition begins — the OLD state is captured the instant startViewTransition
  // is called, so this has to be in place first.
  const leaving = lightboxImage()
  if (leaving) leaving.style.viewTransitionName = MORPH_OUT
  const root = document.documentElement
  root.classList.add(CLOSING)

  const transition = doc.startViewTransition(() => {
    flushSync(update)
    // Looked up AFTER the update: on the way out the destination tile may only exist once the
    // lightbox has gone, and on the way in it may have been re-rendered since.
    const img = tileImage(gridRoot, photoId)
    if (img) img.style.viewTransitionName = MORPH_OUT
  })

  void transition.finished.catch(() => {}).finally(() => {
    root.classList.remove(CLOSING)
    const img = tileImage(gridRoot, photoId)
    if (img) img.style.viewTransitionName = ''
  })
  void transition.ready.catch(() => {})
}
