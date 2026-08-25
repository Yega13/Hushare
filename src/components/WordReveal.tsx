// A line of text whose words rise into place one after another.
//
// PURE CSS, and rendered on the server. The words are split into spans in the HTML and animated by
// a keyframe with a per-word delay, so the effect runs on the very first paint with no JavaScript
// involved at all — no hydration wait, nothing to load, and nothing that can arrive late on the one
// page every visitor sees first.
//
// FAILS VISIBLE, which is the whole design of it. animation-fill-mode is `backwards`, not `both`:
// before the delay the word borrows the `from` frame, during it animates, and afterwards it returns
// to its natural style. So if the animation never runs — no CSS, reduced motion, an engine that
// does not like something here — every word simply sits there at full opacity. The failure mode of
// `both` is an invisible headline, which is the worst thing that could happen to this page.
//
// Whitespace stays OUTSIDE the spans so the browser wraps and hyphenates the line exactly as it
// would have without any of this; the spans are inline-block only so they can be moved.

export default function WordReveal({
  text,
  /** Words already revealed before this line, so a second line continues the same rhythm. */
  startIndex = 0,
  className,
  style,
}: {
  text: string
  startIndex?: number
  className?: string
  style?: React.CSSProperties
}) {
  const words = text.split(/\s+/).filter(Boolean)

  return (
    <span className={className} style={style}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span
            className="hush-word"
            // Per-word delay as a custom property rather than an inline animation-delay, so the
            // timing curve and duration stay in the stylesheet where they can be read together.
            style={{ ['--hush-word-i' as string]: String(startIndex + i) }}
          >
            {word}
          </span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </span>
  )
}

/** How many words a line has — for passing `startIndex` to the next one. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
