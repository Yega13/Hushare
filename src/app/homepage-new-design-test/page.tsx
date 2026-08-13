import type { Metadata } from 'next'
import Image from 'next/image'

// EXPERIMENT — Hushare homepage in the "Air" design language (air.inc), on HUSHARE's palette: the Air
// token STRUCTURE (spacing / radii / type scale, ghost buttons, haze cards, poster display + cursive
// accent) with WINE-adapted colours — cream text on a near-black wine canvas, one rose-wine accent.
// "Control" faces map to self-hosted (Control→Geist, Compressed→Anton, Cursive→Caveat, TNT→Space
// Grotesk). noindex.
export const metadata: Metadata = { title: 'Hushare — design test', robots: { index: false, follow: false } }

// Air tokens, scoped to .air-test so they never leak into the rest of the app.
const AIR_TOKENS = `
.air-test {
  --color-whiteout: #FDFAF5;      /* cream — primary text on dark */
  --color-haze: #F5F0E8;          /* warm cream card island */
  --color-ink: #2A1015;           /* wine-ink — text on light */
  --color-black-void: #0b0506;    /* near-black wine — the canvas */
  --color-twilight-blue: #e0567a; /* → rose-wine heading accent (Hushare's chromatic accent) */
  --color-signal-blue: #e0567a;   /* → rose-wine link / emphasis accent */

  --font-control: var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-control-compressed: 'Anton', var(--font-sans), ui-sans-serif, system-ui, sans-serif;
  --font-control-cursive: 'Caveat', ui-sans-serif, system-ui, cursive;
  --font-control-tnt: 'Space Grotesk', var(--font-sans), ui-sans-serif, system-ui, sans-serif;

  --text-caption: 13px; --text-body: 16px; --text-subheading: 20px;
  --text-heading: 32px; --text-heading-lg: 56px; --text-display: 259px;

  --spacing-4: 4px; --spacing-8: 8px; --spacing-12: 12px; --spacing-16: 16px; --spacing-20: 20px;
  --spacing-24: 24px; --spacing-32: 32px; --spacing-48: 48px; --spacing-52: 52px; --spacing-64: 64px;
  --spacing-80: 80px; --spacing-120: 120px;

  --radius-cards: 12px; --radius-pills: 9999px; --radius-images: 11px; --radius-inputs: 4px; --radius-buttons: 8px;

  --page-max-width: 1150px; --section-gap: 48px; --card-padding: 20px; --element-gap: 8px;
}
.air-test ::selection { background: var(--color-signal-blue); color: #fff; }
`

const MUTED = 'rgba(253,250,245,0.62)'
const HAIR = 'rgba(253,250,245,0.16)'

const container: React.CSSProperties = { maxWidth: 'var(--page-max-width)', margin: '0 auto', padding: '0 var(--spacing-24)' }
const ghost: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-8)',
  background: 'transparent', color: 'var(--color-whiteout)', border: '1px solid var(--color-whiteout)',
  borderRadius: 'var(--radius-buttons)', padding: '10px var(--spacing-16)',
  fontFamily: 'var(--font-control)', fontSize: 14, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap',
}
const solidLight: React.CSSProperties = {
  ...ghost, background: 'var(--color-haze)', color: 'var(--color-ink)', border: '1px solid var(--color-ink)',
  fontWeight: 500, padding: 'var(--spacing-12) var(--spacing-24)',
}
const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-control)', fontSize: 13, fontWeight: 500, letterSpacing: '0.16em',
  textTransform: 'uppercase', color: 'var(--color-signal-blue)',
}

function Feature({ eyebrowText, title, cursive, body, img, alt, reverse }: {
  eyebrowText: string; title: string; cursive?: string; body: string; img: string; alt: string; reverse?: boolean
}) {
  return (
    <div style={container}>
      <div style={{ display: 'grid', gap: 'var(--spacing-48)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'center', direction: reverse ? 'rtl' : 'ltr' }}>
        <div style={{ direction: 'ltr' }}>
          <div style={eyebrow}>{eyebrowText}</div>
          <h2 style={{ fontFamily: 'var(--font-control-tnt)', fontWeight: 500, fontSize: 'clamp(var(--text-heading), 4.4vw, var(--text-heading-lg))', lineHeight: 1.05, color: 'var(--color-whiteout)', margin: 'var(--spacing-16) 0 0', letterSpacing: '-0.01em' }}>
            {title}{cursive && <> <span style={{ fontFamily: 'var(--font-control-cursive)', fontStyle: 'italic', color: 'var(--color-twilight-blue)', fontWeight: 500 }}>{cursive}</span></>}
          </h2>
          <p style={{ fontFamily: 'var(--font-control)', fontSize: 'var(--text-body)', fontWeight: 400, lineHeight: 1.5, color: MUTED, margin: 'var(--spacing-20) 0 0', maxWidth: 440 }}>{body}</p>
        </div>
        <div style={{ direction: 'ltr', position: 'relative', aspectRatio: '4 / 3', borderRadius: 'var(--radius-images)', overflow: 'hidden', border: `1px solid ${HAIR}` }}>
          <Image src={img} alt={alt} fill sizes="(max-width: 700px) 100vw, 560px" style={{ objectFit: 'cover' }} />
        </div>
      </div>
    </div>
  )
}

export default function DesignTestPage() {
  return (
    <>
      <style>{AIR_TOKENS}</style>
      <div className="air-test" style={{ background: 'var(--color-black-void)', color: 'var(--color-whiteout)', minHeight: '100vh', fontFamily: 'var(--font-control)', overflowX: 'hidden' }}>

        {/* Nav — minimal top bar, 72px */}
        <nav style={{ ...container, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Image src="/logo/logo-light-transparent.png" alt="Hushare" width={520} height={123} priority style={{ width: 'auto', height: 26 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-12)' }}>
            <a href="/login" style={{ fontFamily: 'var(--font-control)', fontSize: 14, fontWeight: 500, color: 'var(--color-whiteout)', textDecoration: 'none', padding: '0 6px' }}>Log in</a>
            <a href="/" style={ghost}>Create album</a>
          </div>
        </nav>

        {/* Hero — full-bleed photo, wine gradient scrim, bottom-left headline */}
        <section style={{ position: 'relative', minHeight: 'min(92vh, 880px)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Image src="/wedding.jpg" alt="" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(11,5,6,0.5) 0%, rgba(11,5,6,0.18) 40%, rgba(11,5,6,0.92) 100%)' }} />
          </div>
          <div style={{ ...container, position: 'relative', width: '100%', paddingBottom: 'var(--spacing-64)' }}>
            <div style={{ ...eyebrow, marginBottom: 'var(--spacing-20)' }}>No app · No sign-up</div>
            <h1 style={{ margin: 0, lineHeight: 0.85 }}>
              <span style={{ display: 'block', fontFamily: 'var(--font-control-compressed)', fontWeight: 900, textTransform: 'uppercase', fontSize: 'clamp(3rem, 13vw, 9.5rem)', color: 'var(--color-whiteout)' }}>Share the</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-control-cursive)', fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(3rem, 13vw, 9rem)', color: 'var(--color-twilight-blue)', marginTop: '-0.04em' }}>whole night.</span>
            </h1>
            <p style={{ fontFamily: 'var(--font-control)', fontSize: 'clamp(15px, 2vw, 20px)', fontWeight: 400, lineHeight: 1.5, color: 'var(--color-whiteout)', opacity: 0.9, maxWidth: 540, margin: 'var(--spacing-24) 0 0' }}>
              One link. Everyone who was there drops their photos and videos into the same album — in seconds, from any phone.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-12)', marginTop: 'var(--spacing-32)' }}>
              <a href="/" style={solidLight}>Create your album →</a>
              <a href="/" style={ghost}>See it live</a>
            </div>
          </div>
        </section>

        {/* Features */}
        <div style={{ display: 'grid', gap: 'clamp(var(--spacing-64), 9vw, var(--spacing-120))', padding: 'clamp(var(--spacing-64), 9vw, var(--spacing-120)) 0' }}>
          <Feature eyebrowText="One album" title="Everyone's photos, in one place."
            body="No group chat that scrolls away, no shared drive nobody joins. A single Hushare link, and the whole event lands in the same album — photos and videos, from every guest."
            img="/shared-album.jpg" alt="A shared album of event photos" />
          <Feature eyebrowText="AI Face Finder" title="Find" cursive="every" body="One selfie, and Hushare surfaces every photo of you from the entire event — no scrolling through thousands of strangers' shots to find your own."
            img="/children.avif" alt="A guest finding their photos" reverse />
          <Feature eyebrowText="Live Photo Wall" title="The night, on the big screen."
            body="Put the link on any screen at the venue and it becomes a gallery that updates itself — every photo a guest takes appears within seconds. The party, live."
            img="/share.jpg" alt="A live photo wall on a screen" />
        </div>

        {/* Big CTA — poster display */}
        <section style={{ borderTop: `1px solid ${HAIR}`, padding: 'clamp(var(--spacing-80), 11vw, 140px) var(--spacing-24)', textAlign: 'center' }}>
          <h2 style={{ margin: 0, lineHeight: 0.88 }}>
            <span style={{ display: 'block', fontFamily: 'var(--font-control-compressed)', fontWeight: 900, textTransform: 'uppercase', fontSize: 'clamp(2.6rem, 11vw, 8rem)', color: 'var(--color-whiteout)' }}>Keep it</span>
            <span style={{ display: 'block', fontFamily: 'var(--font-control-cursive)', fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(2.6rem, 11vw, 7.5rem)', color: 'var(--color-twilight-blue)', marginTop: '-0.03em' }}>forever.</span>
          </h2>
          <p style={{ fontFamily: 'var(--font-control)', fontSize: 'var(--text-subheading)', fontWeight: 400, lineHeight: 1.5, color: MUTED, maxWidth: 460, margin: 'var(--spacing-24) auto 0' }}>
            Free to create, free to share, yours to keep. Start an album in ten seconds.
          </p>
          <div style={{ marginTop: 'var(--spacing-32)' }}>
            <a href="/" style={solidLight}>Create a free album</a>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ ...container, borderTop: `1px solid ${HAIR}`, padding: 'var(--spacing-48) var(--spacing-24)', display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-16)', alignItems: 'center', justifyContent: 'space-between' }}>
          <Image src="/logo/logo-light-transparent.png" alt="Hushare" width={520} height={123} style={{ width: 'auto', height: 22, opacity: 0.9 }} />
          <div style={{ display: 'flex', gap: 'var(--spacing-20)', fontFamily: 'var(--font-control)', fontSize: 'var(--text-caption)' }}>
            {['Pricing', 'About', 'Privacy', 'Contact'].map((l) => (
              <a key={l} href="/" style={{ color: 'var(--color-signal-blue)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-control)', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>© Hushare 2026</span>
        </footer>
      </div>
    </>
  )
}
