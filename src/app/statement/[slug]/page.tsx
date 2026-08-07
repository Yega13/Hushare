import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import { Fragment } from 'react'
import StatementPoll from '@/components/StatementPoll'
import StatementCompare from '@/components/StatementCompare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

type Statement = { slug: string; title: string; summary: string | null; body_html: string; published_at: string; poll_key: string | null }

async function fetchStatement(slug: string): Promise<Statement | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('statements')
      .select('slug, title, summary, body_html, published_at, poll_key')
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
      {/* Minimal header — just the logo, centered (link home) */}
      <header className="hush-nav flex items-center justify-center" style={{ borderBottom: '1px solid rgba(221, 213, 197, 0.5)' }}>
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <Image src="/logo/logo-dark-transparent.png" alt="Hushare" width={618} height={146} className="hush-logo" style={{ width: 'auto' }} draggable={false} />
        </Link>
      </header>

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

        {s.body_html.split('%%COMPARE%%').map((part, i, arr) => (
          <Fragment key={i}>
            <div className="hush-statement-body" style={{ marginTop: i === 0 ? '2rem' : '1.75rem' }} dangerouslySetInnerHTML={{ __html: part }} />
            {i < arr.length - 1 && <StatementCompare />}
          </Fragment>
        ))}

        {s.poll_key && <StatementPoll pollKey={s.poll_key} />}

        {/* Official Hushare seal — solid wax-seal with the mark knocked out */}
        <div style={{ marginTop: '4.5rem', paddingTop: '2.75rem', borderTop: '1px solid #E7DDCC', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 96, height: 96, borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 32%, #7A1533 0%, #630826 55%, #4E0620 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 22px rgba(99,8,38,0.28), inset 0 1px 2px rgba(255,255,255,0.28), inset 0 0 0 5px rgba(255,255,255,0.10)',
            }}
          >
            <Image src="/logo/logo-icon-light-transparent.png" alt="Hushare" width={120} height={120} style={{ width: 44, height: 'auto' }} draggable={false} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#630826' }}>Official Statement</div>
            <div style={{ fontSize: 11.5, letterSpacing: '0.05em', color: '#8B6F4E', marginTop: 6 }}>Hushare · {fmtDate(s.published_at)}</div>
          </div>
        </div>
      </article>

      <style>{`
        .hush-statement-body { color: #2A211C; font-size: 0.95rem; line-height: 1.72; }
        .hush-statement-body p { margin: 0 0 1rem; }
        .hush-statement-body h2 { font-family: var(--font-serif); color: #2A211C; font-size: 1.4rem; font-weight: 700; margin: 2.6rem 0 1rem; padding-bottom: .5rem; border-bottom: 2px solid #E7DDCC; }
        .hush-statement-body h3 { font-family: var(--font-serif); color: #630826; font-size: 1.12rem; font-weight: 700; margin: 1.8rem 0 .5rem; }
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
