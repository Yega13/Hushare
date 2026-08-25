'use client'

import { useEffect } from 'react'
import { startEngagement } from '@/lib/engagement'

// Mounts the page-engagement collector. Renders nothing.
//
// A component rather than a call inside each page because the measurement has to start when the
// page becomes interactive and stop when it goes away, and an effect is the only thing that reliably
// knows both. It is also the reason this is the one place that decides a page's NAME: the endpoint
// only accepts names from a fixed list, so a typo here shows up as missing data rather than as a new
// row nobody notices.
export default function EngagementBeacon({
  page,
  albumId,
}: {
  page: 'album' | 'home' | 'pricing' | 'account' | 'statement' | 'login' | 'other'
  albumId?: string | null
}) {
  useEffect(() => startEngagement(page, albumId), [page, albumId])
  return null
}
