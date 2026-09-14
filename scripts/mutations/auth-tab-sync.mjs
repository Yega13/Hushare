// Mutation set for src/lib/auth-tab-sync.ts -- run with: node scripts/mutations/run.mjs auth-tab-sync
//
// A listener that listens on the wrong channel, or reacts to the wrong events, is silent in every way
// a person would notice: the nav link simply never updates, or re-asks /api/me every hour.
export default {
  file: 'src/lib/auth-tab-sync.ts',
  test: 'tests/auth-tab-sync.test.ts',
  mutations: [
    { name: 'an hourly TOKEN_REFRESHED counts as an identity change (re-asks on a schedule)',
      from: "export const IDENTITY_EVENTS = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'] as const",
      to: "export const IDENTITY_EVENTS = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'TOKEN_REFRESHED'] as const" },
    { name: 'a sign-out in another tab is not heard',
      from: "export const IDENTITY_EVENTS = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'] as const",
      to: "export const IDENTITY_EVENTS = ['SIGNED_IN', 'USER_UPDATED'] as const" },
    { name: 'the channel is named with the whole hostname, so it listens where supabase-js never posts',
      from: "new URL(supabaseUrl).hostname.split('.')[0]", to: "new URL(supabaseUrl).hostname" },
    { name: 'the channel name loses its -auth-token suffix',
      from: "}-auth-token`", to: "}`" },
    { name: 'every message on the channel counts as a change',
      from: "  return typeof event === 'string' && (IDENTITY_EVENTS as readonly string[]).includes(event)",
      to: "  return true" },
    { name: 'cleanup leaves the channel open, so an unmounted link keeps listening',
      from: "  return () => channel.close()", to: "  return () => {}" },
    { name: 'a channel that refuses to open throws into the page',
      from: "  try {\n    // The constructor can throw where the page's origin is opaque (a sandboxed frame). A nav link must\n    // not take the page down with it.\n    channel = new deps.Channel(name)\n  } catch {\n    return () => {}\n  }\n",
      to: "  channel = new deps.Channel(name)\n" },
  ],
}
