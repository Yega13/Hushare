import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasAccountAccess } from '@/lib/access'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const NO_CACHE = { headers: { 'Cache-Control': 'no-store' } }

  if (!user) {
    return NextResponse.json({ signedIn: false, canAccessAccount: false }, NO_CACHE)
  }

  const canAccessAccount = await hasAccountAccess(user)
  return NextResponse.json({ signedIn: true, canAccessAccount }, NO_CACHE)
}
