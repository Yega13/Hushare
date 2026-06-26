import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasAccountAccess } from '@/lib/access'
import LoginForm from './LoginForm'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Sign in — Hushare',
  description: 'Sign in to your Hushare account with Google or an email magic link — no password needed.',
  robots: { index: false, follow: false },
}

type Props = {
  searchParams: Promise<{ next?: string; error?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams
  let requestedNext: string | null = null
  if (next) {
    try {
      // Use URL constructor to normalise encoded variants before validating same-origin.
      const parsed = new URL(next, 'https://hushare.space')
      if (parsed.origin === 'https://hushare.space') requestedNext = parsed.pathname + parsed.search
    } catch { /* invalid URL — leave null */ }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    if (await hasAccountAccess(user)) {
      redirect(requestedNext ?? '/account')
    }
    redirect('/')
  }

  return (
    <main className="min-h-screen flex flex-col px-4" style={{ background: '#FDFAF5' }}>
      <div className="pt-8 text-center">
        <Link href="/" className="inline-block" aria-label="Go to Hushare home">
          <span style={{ fontFamily: 'var(--font-serif)', color: '#254F22', fontSize: '28px', fontWeight: 700 }}>
            Hushare
          </span>
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1
              className="text-3xl font-bold mb-2"
              style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
            >
              Sign in
            </h1>
            <p className="text-sm" style={{ color: '#5C4A3C' }}>
              Continue with Google or get a magic link by email.
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
