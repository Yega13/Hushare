'use client'

import { useMemo, useState } from 'react'

// The registered users, and whether they are actually here.
//
// This replaced two columns — the date somebody joined and their email — which could not answer a
// single question worth asking. The first time it ran against real data it said that 21 of 33
// accounts had never created one album, which is an activation problem that had been invisible for
// the whole life of the product.
//
// The FLAGS are the point, not the table. A list of users sorted by date is a database dump; what an
// owner needs is "these four people are about to leave" and "these two are one photo away from
// paying you". Those are computed here and pushed to the top.

export type UserRow = {
  id: string
  email: string
  joined: string
  lastSignIn: string | null
  lastActive: string | null
  albums: number
  media: number
  tier: 'free' | 'pro' | 'studio'
  albumCap: number
  mediaCap: number
}

export type Cohort = { month: string; signups: number; stillActive: number }

const INK = '#2A211C'
const MUTED = '#8A7A66'
const BRAND = '#630826'

const DAY = 86_400_000
const daysSince = (iso: string | null): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null

type Flag = { text: string; tone: 'bad' | 'warn' | 'good' | 'info' }

// Ordered by how much each one should interrupt someone's day.
function flagsFor(u: UserRow): Flag[] {
  const out: Flag[] = []
  const idle = daysSince(u.lastActive)
  const paid = u.tier !== 'free'

  // A paying customer who has stopped using it is the most expensive row here — they churn on
  // renewal day and the first you hear of it is the cancellation webhook.
  if (paid && (idle === null || idle > 30)) out.push({ text: 'paying · gone quiet', tone: 'bad' })
  // Signed up and never made anything. Not a churn risk — a promise never delivered on.
  if (u.albums === 0) out.push({ text: 'never made an album', tone: 'warn' })
  // Close to a wall. On free that is the upgrade conversation; on a paid plan it is a support one.
  else if (u.albums >= u.albumCap) out.push({ text: 'at album limit', tone: paid ? 'info' : 'good' })
  else if (u.media >= u.mediaCap * 0.8) out.push({ text: 'near photo limit', tone: paid ? 'info' : 'good' })

  return out
}

const TONE: Record<Flag['tone'], { bg: string; fg: string }> = {
  bad: { bg: 'rgba(155,44,44,0.12)', fg: '#9B2C2C' },
  warn: { bg: 'rgba(180,83,31,0.12)', fg: '#B4531F' },
  good: { bg: 'rgba(31,81,54,0.12)', fg: '#1F5136' },
  info: { bg: 'rgba(99,8,38,0.09)', fg: BRAND },
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, color: MUTED, fontWeight: 600, padding: '6px 8px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: 12.5, color: INK, padding: '7px 8px', whiteSpace: 'nowrap', borderTop: '1px solid #F0E8DA' }

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone === 'bad' ? '#9B2C2C' : tone === 'warn' ? '#B4531F' : INK, lineHeight: 1.2 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: MUTED }}>{hint}</div>}
    </div>
  )
}

export default function AdminUsers({ users, cohorts }: { users: UserRow[]; cohorts: Cohort[] }) {
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  const rows = useMemo(() => {
    const withFlags = users.map((u) => ({ u, flags: flagsFor(u) }))
    // Anything needing attention first; within that, the most recently active, because a person who
    // was here yesterday is worth a message today.
    return withFlags.sort((a, b) => {
      const sev = (f: Flag[]) => (f.some((x) => x.tone === 'bad') ? 0 : f.length > 0 ? 1 : 2)
      const d = sev(a.flags) - sev(b.flags)
      if (d !== 0) return d
      return (b.u.lastActive ?? '').localeCompare(a.u.lastActive ?? '')
    })
  }, [users])

  const shown = onlyFlagged ? rows.filter((r) => r.flags.length > 0) : rows
  const total = users.length
  const activated = users.filter((u) => u.albums > 0).length
  const active30 = users.filter((u) => { const d = daysSince(u.lastActive); return d !== null && d <= 30 }).length
  const paying = users.filter((u) => u.tier !== 'free').length
  const peak = Math.max(1, ...cohorts.map((c) => c.signups))

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))' }}>
        <Card label="Registered" value={total.toLocaleString('en-US')} />
        <Card
          label="Made an album"
          value={`${activated}`}
          hint={total ? `${Math.round((activated / total) * 100)}% of signups` : undefined}
          tone={total > 0 && activated / total < 0.5 ? 'warn' : undefined}
        />
        <Card label="Active in 30 days" value={`${active30}`} hint={total ? `${Math.round((active30 / total) * 100)}% of signups` : undefined} />
        <Card label="Paying" value={`${paying}`} />
      </div>

      <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 2 }}>Do they come back?</div>
        <p style={{ fontSize: 11, color: '#A5977F', margin: '0 0 12px' }}>
          Signups per month, and how many of those people have touched an album in the last 30 days.
          A signup chart alone cannot tell these apart.
        </p>
        {cohorts.length === 0 ? (
          <div style={{ fontSize: 12, color: '#A5977F' }}>no signups yet</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {cohorts.map((c) => (
              <div key={c.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: MUTED, width: 58, flex: 'none' }}>{c.month}</div>
                <div style={{ flex: 1, height: 14, background: '#F4EEE4', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, width: `${(c.signups / peak) * 100}%`, background: BRAND, opacity: 0.22 }} />
                  {/* The retained slice is drawn INSIDE the signup bar, so the gap between them is
                      the thing the eye lands on. Two separate bars would need arithmetic. */}
                  <div style={{ position: 'absolute', inset: 0, width: `${(c.stillActive / peak) * 100}%`, background: BRAND, opacity: 0.85 }} />
                </div>
                <div style={{ fontSize: 11.5, color: INK, fontVariantNumeric: 'tabular-nums', width: 96, textAlign: 'right', flex: 'none' }}>
                  <strong>{c.stillActive}</strong>
                  <span style={{ color: MUTED }}> / {c.signups}</span>
                  <span style={{ color: c.signups && c.stillActive / c.signups < 0.3 ? '#9B2C2C' : MUTED }}>
                    {c.signups ? ` · ${Math.round((c.stillActive / c.signups) * 100)}%` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Everyone</div>
          <button
            type="button"
            onClick={() => setOnlyFlagged((v) => !v)}
            style={{
              fontSize: 11.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${onlyFlagged ? BRAND : '#DDD5C5'}`,
              background: onlyFlagged ? 'rgba(99,8,38,0.07)' : '#FFFFFF',
              color: onlyFlagged ? BRAND : '#5C4A3C', fontWeight: onlyFlagged ? 700 : 500,
            }}
          >
            {onlyFlagged ? 'Showing only flagged' : 'Show only flagged'}
          </button>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
          {/* minWidth, or the seven columns shrink to fit a phone instead of scrolling — and the
              email column, the one you actually came to read, is the one that loses. The parent has
              scrolled horizontally all along; the table just never asked for the room. */}
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead><tr>
              <th style={th}>Email</th><th style={th}>Joined</th><th style={th}>Plan</th>
              <th style={th}>Albums</th><th style={th}>Media</th><th style={th}>Last active</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td style={td} colSpan={7}>Nobody to show.</td></tr>}
              {shown.map(({ u, flags }) => {
                const idle = daysSince(u.lastActive)
                return (
                  <tr key={u.id}>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>{u.email || '(no email)'}</td>
                    <td style={{ ...td, color: MUTED }}>{u.joined}</td>
                    <td style={td}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                        background: u.tier === 'free' ? '#F2ECE1' : 'rgba(99,8,38,0.09)',
                        color: u.tier === 'free' ? MUTED : BRAND,
                      }}>
                        {u.tier === 'studio' ? 'Max' : u.tier === 'pro' ? 'Pro' : 'Free'}
                      </span>
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      {u.albums}<span style={{ color: MUTED }}> / {u.albumCap}</span>
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{u.media.toLocaleString('en-US')}</td>
                    <td style={{ ...td, color: idle !== null && idle > 30 ? '#9B2C2C' : MUTED }}>
                      {idle === null ? '—' : idle === 0 ? 'today' : `${idle}d ago`}
                    </td>
                    <td style={td}>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {flags.map((f) => (
                          <span key={f.text} style={{
                            fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                            background: TONE[f.tone].bg, color: TONE[f.tone].fg, whiteSpace: 'nowrap',
                          }}>
                            {f.text}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
