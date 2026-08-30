import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertEnvironmentIsCoherent } from '@/lib/server/environment'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminClient(): SupabaseClient<any> {
  if (_client) return _client

  // THE SERVICE-ROLE CLIENT BYPASSES EVERY ROW-LEVEL SECURITY POLICY, so this is the last place
  // worth asking whether this build is allowed to talk to the database it is about to open. A
  // staging deploy still holding production's URL would pass every other check in the system.
  assertEnvironmentIsCoherent()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase admin credentials')
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return _client
}
