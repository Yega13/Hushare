'use client'

import dynamic from 'next/dynamic'
import { retryImport } from '@/lib/lazy-retry'

// Lazy wrapper so Recharts (~450KB) stays OUT of the server bundle and out of every other route.
//
// ssr:false keeps the whole module graph off the Worker, which matters here: the server handler is
// already 2.18MB gzipped against Cloudflare's 10MB cap, and a charting library has nothing to do
// on a server that renders no charts. It is also owner-only code — no guest should ever download a
// byte of it to look at photos.
//
// `ssr:false` dynamic imports are only legal inside a client component, and admin/page.tsx is a
// server component, hence this thin wrapper. Exactly the arrangement Globe3DLazy uses for three.js,
// and for the same two reasons.
//
// The placeholder reserves the chart's real height so the dashboard does not jump when it loads.
const AdminAreaChart = dynamic(retryImport(() => import('./AdminAreaChart')), {
  ssr: false,
  loading: () => (
    <div style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ height: 18, marginBottom: 2 }} />
      <div style={{ height: 120 }} aria-hidden />
    </div>
  ),
})

type Point = { day: string; value: number }

export default function AdminAreaChartLazy(props: {
  label: string
  points: Point[]
  color: string
  unit?: string
}) {
  return <AdminAreaChart {...props} />
}
