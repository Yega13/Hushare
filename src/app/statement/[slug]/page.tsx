import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import HamburgerMenu from '@/components/HamburgerMenu'
import AccountNavLink from '@/components/AccountNavLink'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

type Statement = { slug: string; title: string; summary: string | null; body_html: string; published_at: string }

async function fetchStatement(slug: string): Promise<Statement | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('statements')
      .select('slug, title, summary, body_html, published_at')
      .eq('slug', slug)
      .maybeSingle()
    return (data as Statement) ?? null
  } catch {
    return null
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const s = await fetchStatement(slug)
  if (!s) return { title: 'Announcement' }
  const desc = s.summary ?? 'An official statement from Hushare.'
  return {
    title: s.title,
    description: desc,
    alternates: { canonical: `/statement/${s.slug}` },
    openGraph: { type: 'article', url: `${SITE_URL}/statement/${s.slug}`, title: `${s.title} - Hushare`, description: desc, siteName: 'Hushare' },
    robots: { index: true, follow: true },
  }
}

export default async function StatementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const locale = await getServerLocale()
  const dict = await getDictionary(locale)
  const s = await fetchStatement(slug)
  if (!s) notFound()

  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <Image src="/logo/logo-dark-transparent.png" alt="Hushare" width={618} height={146} className="hush-logo" style={{ width: 'auto' }} draggable={false} />
        </Link>
        <HamburgerMenu>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.pricing']}</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.about']}</Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.collabs']}</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.support']}</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      <article style={{ width: 'min(100% - 3rem, 1200px)', marginInline: 'auto', padding: '2.5rem 0 5rem' }}>
        <Link href="/statement" className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline" style={{ color: '#8B6F4E' }}>
          <ArrowLeft size={15} aria-hidden="true" /> {dict['st.back']}
        </Link>

        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#B98E4C', margin: '2rem 0 0' }}>
          {fmtDate(s.published_at)}
        </p>
        <h1 style={{ fontFamily: 'var(--font-serif)', color: '#630826', fontSize: 'clamp(1.9rem, 5vw, 3rem)', lineHeight: 1.14, fontWeight: 700, margin: '.5rem 0 0' }}>
          {s.title}
        </h1>

        <div className="hush-statement-body" style={{ marginTop: '2rem' }} dangerouslySetInnerHTML={{ __html: s.body_html }} />

        {/* Official Hushare stamp */}
        <div style={{ marginTop: '4rem', paddingTop: '2.5rem', borderTop: '1px solid #E7DDCC', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 112, height: 112, borderRadius: '50%',
              border: '2px solid #630826', boxShadow: 'inset 0 0 0 5px rgba(99,8,38,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.94,
            }}
          >
            <Image src="/logo/logo-icon-dark-transparent.png" alt="Hushare" width={120} height={120} style={{ width: 54, height: 'auto' }} draggable={false} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#630826' }}>Official Statement</div>
            <div style={{ fontSize: 12, letterSpacing: '0.08em', color: '#8B6F4E', marginTop: 5 }}>Hushare · hushare.space · {fmtDate(s.published_at)}</div>
          </div>
        </div>
      </article>

      <style>{`
        .hush-statement-body { color: #2A211C; font-size: 1.075rem; line-height: 1.72; }
        .hush-statement-body p { margin: 0 0 1.15rem; }
        .hush-statement-body h2 { font-family: var(--font-serif); color: #2A211C; font-size: 1.55rem; font-weight: 700; margin: 2.4rem 0 .9rem; padding-bottom: .5rem; border-bottom: 2px solid #E7DDCC; }
        .hush-statement-body h3 { font-family: var(--font-serif); color: #630826; font-size: 1.2rem; font-weight: 700; margin: 1.6rem 0 .35rem; }
        .hush-statement-body strong { color: #630826; }
        .hush-statement-body ul { margin: 0 0 1.15rem; padding-left: 1.25rem; }
        .hush-statement-body li { margin: 0 0 .5rem; }
        .hush-statement-body a { color: #630826; text-decoration: underline; }
        .hush-statement-body table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: .98rem; }
        .hush-statement-body th { background: #630826; color: #fff; padding: 10px 14px; text-align: left; font-size: .8rem; letter-spacing: .05em; text-transform: uppercase; }
        .hush-statement-body td { border: 1px solid #E7DDCC; padding: 9px 14px; }
        .hush-statement-body tr:nth-child(even) td { background: #FBF5EC; }
        .hush-statement-body .hush-callout { border: 1px solid #B98E4C; background: #FBF5EC; border-radius: 12px; padding: 1rem 1.25rem; margin: 1.5rem 0; }
        .hush-statement-body .hush-callout p { margin: 0; }
        .hush-statement-body .hush-sign { margin-top: 2.5rem; border-top: 1px solid #E7DDCC; padding-top: 1.5rem; }
        .hush-statement-body .hush-sign .name { font-family: var(--font-serif); color: #630826; font-size: 1.35rem; font-weight: 700; }
        .hush-statement-body .hush-sign .role { font-size: .82rem; letter-spacing: .06em; text-transform: uppercase; color: #8B6F4E; margin-top: .15rem; }
      `}</style>
    </main>
  )
}
