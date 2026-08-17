'use client'

import { useEffect } from 'react'
import { isStaleDocument, reloadOnceForStaleDeploy, reportClientError } from '@/lib/report-error'

// A loading skeleton is supposed to be a moment, not a destination.
//
// Rendered inside a route's loading.tsx, this component exists only while that route's fallback is
// on screen. If the fallback is still mounted long after any real navigation would have finished,
// something is wedged — and by far the most common cause is a stale tab: a deploy replaced the
// hashed chunks, this document still asks for the old filenames, the import 404s inside a Suspense
// boundary, and React waits forever with nothing thrown for the error reporter to catch. The album
// never opens and there is no error anywhere to explain why.
//
// We do not guess. isStaleDocument() asks whether the scripts this document actually booted with
// still exist; only a 404 triggers the reload, so a slow phone on a bad connection is left alone
// (its chunks answer 200, just later). Reloading is guarded to once per tab, shared with the thrown
// -error path, so a genuinely broken build cannot start a reload loop.

const FALLBACK_PATIENCE_MS = 6000

export default function StaleDeployWatchdog() {
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void isStaleDocument().then((stale) => {
        if (cancelled || !stale) return
        reportClientError({
          source: 'stale-deploy-watchdog',
          message: 'Navigation stuck on loading fallback; document chunks are gone (stale deploy)',
          context: { waitedMs: FALLBACK_PATIENCE_MS },
        })
        reloadOnceForStaleDeploy()
      })
    }, FALLBACK_PATIENCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])
  return null
}
