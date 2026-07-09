'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [supabase] = useState(() => createClient())

  async function onClick() {
    if (busy) return
    setBusy(true)
    try {
      await supabase.auth.signOut()
      router.replace('/')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
      style={{ background: '#630826', color: '#FDFAF5' }}
    >
      {busy ? 'Signing out...' : (
        <>
          Sign out <LogOut className="w-4 h-4" />
        </>
      )}
    </button>
  )
}
