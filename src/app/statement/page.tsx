import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import StatementsList, { type StatementCard } from './StatementsList'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

export const metadata: Metadata = {
  title: 'Announcements',
  description: 'Product updates and official statements from Hushare — new features, plan changes, and news.',
  alternates: { canonical: '/statement' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/statement`,
    title: 'Announcements - Hushare',
    description: 'Product updates and official statements from Hushare.',
    siteName: 'Hushare',
  },
  robots: { index: true, follow: true },
}

export default async function StatementIndexPage() {
  const locale = await getServerLocale()
  const dict = await getDictionary(locale)

  let statements: StatementCard[] = []
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('statements')
      .select('slug, title, summary, published_at')
      .order('published_at', { ascending: false })
      .limit(200)
    statements = (data as StatementCard[]) ?? []
  } catch {
    statements = []
  }

  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      {/* Minimal header — just the logo, centered (link home) */}
      <header className="hush-nav flex items-center justify-center" style={{ borderBottom: '1px solid rgba(221, 213, 197, 0.5)' }}>
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <Image src="/logo/logo-dark-transparent.png" alt="Hushare" width={618} height={146} className="hush-logo" style={{ width: 'auto' }} draggable={false} />
        </Link>
      </header>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-8 text-center">
        <p className="text-xs sm:text-sm font-medium uppercase mb-4" style={{ color: '#8B6F4E', letterSpacing: '0.18em' }}>
          {dict['st.eyebrow']}
        </p>
        <h1 style={{ fontFamily: 'var(--font-serif)', color: '#630826', fontSize: 'clamp(2rem, 4.2vw, 3.25rem)', lineHeight: 1.1, fontWeight: 700 }}>
          {dict['st.title']}
        </h1>
        <p style={{ color: '#5C4A3C', fontSize: '1.05rem', lineHeight: 1.6, maxWidth: 560, margin: '1rem auto 0' }}>
          {dict['st.subtitle']}
        </p>
      </section>

      <section className="pb-24" style={{ width: 'min(100% - 3rem, 1200px)', marginInline: 'auto' }}>
        <StatementsList statements={statements} />
      </section>
    </main>
  )
}
