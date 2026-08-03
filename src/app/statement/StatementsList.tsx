'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { useT } from '@/i18n/LocaleProvider'

export type StatementCard = {
  slug: string
  title: string
  summary: string | null
  published_at: string
}

function fmtDate(iso: string): string {
  // Stable, locale-independent (avoids hydration drift): "August 3, 2026"
  const d = new Date(iso)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export default function StatementsList({ statements }: { statements: StatementCard[] }) {
  const { t } = useT()
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return statements
    return statements.filter((s) => {
      const hay = `${s.title} ${s.summary ?? ''} ${fmtDate(s.published_at)}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [q, statements])

  return (
    <div>
      <style>{`
        .hush-statement-card { transition: border-color 180ms ease, box-shadow 180ms ease; }
        .hush-statement-card:hover { border-color: #630826; box-shadow: 0 8px 24px rgba(99,8,38,0.11); }
        .hush-statement-card:hover h2 { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1.5px; }
      `}</style>
      <div style={{ position: 'relative', maxWidth: 560, margin: '0 auto 2.5rem' }}>
        <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#8B6F4E' }} aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('st.searchPlaceholder')}
          aria-label={t('st.searchPlaceholder')}
          style={{
            width: '100%', padding: '12px 16px 12px 42px', borderRadius: 12,
            border: '1px solid #DDD5C5', background: '#FFFFFF', color: '#630826', fontSize: '1rem', outline: 'none',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#8B6F4E', padding: '3rem 0' }}>
          {statements.length === 0 ? t('st.empty') : t('st.noMatch')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', margin: '0 auto' }}>
          {filtered.map((s) => (
            <Link
              key={s.slug}
              href={`/statement/${s.slug}`}
              className="hush-statement-card"
              style={{
                display: 'block', textDecoration: 'none', background: '#FFFFFF',
                border: '1px solid #E4DDD2', borderRadius: 16, padding: '1.5rem 1.75rem',
                boxShadow: '0 4px 20px rgba(99,8,38,0.06)',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B98E4C', margin: 0 }}>
                {fmtDate(s.published_at)}
              </p>
              <h2 style={{ fontFamily: 'var(--font-serif)', color: '#630826', fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.2, margin: '.35rem 0 0' }}>
                {s.title}
              </h2>
              {s.summary && (
                <p style={{ color: '#5C4A3C', fontSize: '.98rem', lineHeight: 1.55, margin: '.5rem 0 0' }}>{s.summary}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
