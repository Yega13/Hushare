// A SIGN-IN OR SIGN-OUT IN ANOTHER TAB, HEARD WITHOUT THE SUPABASE CLIENT.
//
// The nav link on every marketing page created a Supabase browser client for one job: re-asking "who is
// signed in" when that changes in another tab. That single import put supabase-js -- 221 KB, measured by
// the review of 2026-09-14 -- in front of the home page, pricing, about and every SEO landing page, for a
// listener that fires when somebody signs in or out somewhere else.
//
// The client does not need to be here to hear it. supabase-js tells other tabs by posting { event,
// session } on a BroadcastChannel named after its storage key (auth-js GoTrueClient: `new
// BroadcastChannel(this.storageKey)`, `postMessage({ event, session })`), and every tab that signs in
// or out -- the login form, the account page, an album -- still has a client doing that posting. So a
// marketing page listens on the same channel with the browser's own BroadcastChannel and never loads
// the library. tests/auth-tab-sync holds the name equal to the one the real client uses.
//
// What a marketing page gives up is its own background token refresh, which it never needed: the
// middleware refreshes the session on every navigation, and /api/me answers from the server.

/** The events that change WHO is signed in. TOKEN_REFRESHED fires about hourly and changes nothing. */
export const IDENTITY_EVENTS = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'] as const

/** supabase-js's default storage key -- and so its channel name -- for a project URL. Null if unparseable. */
export function authChannelName(supabaseUrl: string): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

/** Whether a message on that channel says the signed-in identity changed. */
export function isIdentityChange(data: unknown): boolean {
  const event = (data as { event?: unknown } | null)?.event
  return typeof event === 'string' && (IDENTITY_EVENTS as readonly string[]).includes(event)
}

type ChannelCtor = new (name: string) => BroadcastChannel

/**
 * Call `onChange` when another tab signs in, signs out, or updates the user. Returns the cleanup.
 *
 * Does nothing where it cannot listen -- no project URL, no BroadcastChannel (an old browser, a test
 * environment) -- which errs toward a nav link that updates on the next page load instead of throwing
 * on every marketing page.
 */
export function watchAuthFromOtherTabs(
  onChange: () => void,
  deps: { url: string | undefined; Channel: ChannelCtor | undefined } = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    Channel: typeof BroadcastChannel === 'function' ? BroadcastChannel : undefined,
  },
): () => void {
  const name = deps.url ? authChannelName(deps.url) : null
  if (!name || !deps.Channel) return () => {}
  let channel: BroadcastChannel
  try {
    // The constructor can throw where the page's origin is opaque (a sandboxed frame). A nav link must
    // not take the page down with it.
    channel = new deps.Channel(name)
  } catch {
    return () => {}
  }
  channel.addEventListener('message', (e: MessageEvent) => { if (isIdentityChange(e.data)) onChange() })
  // A closed channel delivers nothing more, so closing IS the unsubscribe.
  return () => channel.close()
}
