'use client'

import { useEffect } from 'react'
import { installGlobalErrorReporting } from '@/lib/report-error'

// Renders nothing. Mounted once in the root layout so uncaught errors and unhandled promise
// rejections anywhere in the app reach /admin. Before this existed, only UploadZone reported
// anything, so the admin error panel stayed empty no matter what users actually hit.
export default function ErrorReporter() {
  useEffect(() => installGlobalErrorReporting(), [])
  return null
}
