import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Llama 3.3 70B (fp8, fast) — strong answer quality for grounded FAQ support, still cheap/fast on
// Workers AI. Must be an ID actually available on the account (verified via `wrangler ai models`).
// For lower cost at extreme traffic, @cf/meta/llama-3.1-8b-instruct-fp8 is the swap.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const MAX_MESSAGES = 16
const MAX_CHARS = 1500 // per message

// Minimal binding shapes — avoids importing @cloudflare/workers-types globally (DOM type clash).
type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> }
type AiBinding = { run(model: string, opts: unknown): Promise<{ response?: string } | unknown> }
type ChatEnv = { AI?: AiBinding; SUPPORT_CHAT_LIMITER?: RateLimitBinding }

// Everything the bot is allowed to know. Kept factual + current; the bot is told NOT to invent
// anything beyond this and to hand off to a human for account-specific issues.
const SYSTEM_PROMPT = `You are the friendly support assistant for Hushare (hushare.space), an app for collecting everyone's photos and videos from an event into one shared album.

Answer ONLY from the facts below. If something isn't covered, or it's account-specific (billing, a lost owner link, a specific broken album, refunds), say you're not sure and point them to the support page at hushare.space/support. Never invent features, prices, or limits. Keep replies short, warm, and practical. Reply in the SAME language the user writes in (English, Russian, or Armenian).

WHAT IT IS
- A shared album for an event. The host creates an album and gets one link + QR code. Guests scan/open it and add their own photos and videos — no app to download, no account, no sign-up.

HOW TO USE IT
- Create an album on the homepage (hushare.space) — you get a private owner link (bookmark it — it's how you manage the album) plus a public link/QR to share with guests.
- Guests just open the link or scan the QR, then tap to add photos/videos.
- Download everything later as a ZIP from the owner view (big albums download in parts).

KEY FEATURES
- Live Photo Wall: put the album on a screen/projector; guest photos appear live as they're added, with a QR on screen to join.
- Face Finder (Max plan): guests find their own photos by taking a selfie.
- Moderation: hosts can turn on "Require approval" so guest photos are reviewed before they show.
- Works in English, Russian, and Armenian (switch in the footer).

PLANS (photos & videos = same pool)
- Guest (no account): 2 albums, up to 150 items each.
- Free (free account): 3 albums, up to 250 items each.
- Pro (~$4/month): 15 albums, up to 2,500 items each, password protection, custom album URLs, HD video, larger uploads.
- Max (~$10/month): 50 albums, up to 10,000 items each, Face Finder, custom branding, priority support.
- You can start free with no credit card. Big partner/event albums can be raised on request.

FILES & LIMITS
- Free: images (JPG/PNG/HEIC/WebP) up to 25 MB, videos (MP4/MOV/WebM) up to 50 MB. Pro/Max allow much larger (up to 4 GB video on Max).
- Albums are unlisted and not indexed by search engines — only people with the link can see them.
- Free albums auto-retire after ~3 months of inactivity (with an email warning first); paid plans keep them.`

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
}

export async function POST(req: Request): Promise<Response> {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const env = getCloudflareContext()?.env as ChatEnv | undefined

  // Edge rate limit (abuse/cost backstop). Fails open if the binding isn't present (e.g. local dev).
  try {
    const limiter = env?.SUPPORT_CHAT_LIMITER
    if (limiter) {
      const { success } = await limiter.limit({ key: clientIp(req) })
      if (!success) {
        return NextResponse.json({ error: "You're sending messages a little fast — give it a moment." }, { status: 429, headers: NO_STORE })
      }
    }
  } catch { /* fail open */ }

  let body: { messages?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }) }

  const raw = Array.isArray(body.messages) ? body.messages : []
  const messages = raw
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof (m as { content?: unknown }).content === 'string' &&
      ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant'))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question provided.' }, { status: 400, headers: NO_STORE })
  }

  if (!env?.AI) {
    // Binding missing (local dev without --remote, or not yet deployed) — graceful fallback.
    return NextResponse.json({ reply: "I'm having trouble reaching the assistant right now. Please email us via hushare.space/support and we'll help." }, { headers: NO_STORE })
  }

  try {
    const result = await env.AI.run(MODEL, {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 500,
      temperature: 0.3,
    }) as { response?: string }
    const reply = (result?.response ?? '').trim() || "Sorry, I didn't catch that — could you rephrase? For anything account-specific, hushare.space/support can help."
    return NextResponse.json({ reply }, { headers: NO_STORE })
  } catch (e) {
    console.error('[support/chat] AI run failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ reply: "I'm having a moment — please try again, or reach us at hushare.space/support." }, { headers: NO_STORE })
  }
}
