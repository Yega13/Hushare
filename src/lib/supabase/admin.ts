import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { assertEnvironmentIsCoherent } from '@/lib/server/environment'

// TYPED, where this was `SupabaseClient<any>` behind an eslint-disable — the only two `any` in
// src/. With `any` the client's whole surface was unchecked: a misspelled column in a .select()
// produced an empty result rather than an error, and `.eq('hiden', false)` compiled.
let _client: SupabaseClient<Database> | null = null

export function createAdminClient(): SupabaseClient<Database> {
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
