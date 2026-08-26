import { redirect } from 'next/navigation'
import Image from 'next/image'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasAccountAccess } from '@/lib/access'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
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

  const dict = getDictionary(await getServerLocale())

  return (
    <main className="min-h-screen flex flex-col px-4" style={{ background: '#FDFAF5' }}>
      {/* ONE CENTRED BLOCK, not a mark pinned to the top with the card centred in what is left.
          That arrangement put roughly 450px of nothing between the two on a phone, which reads as a
          page that failed to load rather than a page that is calm. */}
      <div className="flex-1 flex items-center justify-center py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            {/* The actual mark, as on every other page. This was the word "Hushare" set in the serif
                face — the one place in the product where the logo was retyped instead of used, and
                it is the page a paying customer lands on to sign in. */}
            <Link href="/" className="inline-block mb-6" aria-label="Go to Hushare home">
              <Image
                src="/logo/logo-dark-transparent.png"
                alt="Hushare"
                width={618}
                height={146}
                priority
                style={{ width: 'auto', maxWidth: '150px', height: 'auto' }}
              />
            </Link>
            <h1
              className="text-3xl font-bold mb-2"
              style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
            >
              {dict['login.heading']}
            </h1>
            <p className="text-sm" style={{ color: '#5C4A3C' }}>
              {dict['login.subtitle']}
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
