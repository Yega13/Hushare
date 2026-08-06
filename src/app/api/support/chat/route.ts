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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Where chat escalations land (same inbox as the contact form).
const SUPPORT_TO = 'husharesupport@gmail.com'
const VERIFIED_FROM = 'Hushare Support <support@hushare.space>'
const FALLBACK_FROM = 'Hushare Support <onboarding@resend.dev>'

// Minimal binding shapes — avoids importing @cloudflare/workers-types globally (DOM type clash).
type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> }
type AiBinding = { run(model: string, opts: unknown): Promise<{ response?: string } | unknown> }
type ChatEnv = { AI?: AiBinding; SUPPORT_CHAT_LIMITER?: RateLimitBinding }
type ChatMsg = { role: string; content: string }

// Everything the bot is allowed to know. Kept factual + current; the bot is told NOT to invent
// anything beyond this and to hand off to a human for account-specific issues.
const SYSTEM_PROMPT = `You are the friendly support assistant for Hushare (hushare.space), an app for collecting everyone's photos and videos from an event into one shared album.

Your job is to actually HELP, not to bounce people away. Answer questions about how Hushare works, its features, and its plans directly from the facts below (e.g. "can runners find their photos?" → yes, with Face Finder). If a question is vague, ask ONE short clarifying question instead of guessing. Never invent features, prices, or limits beyond what's listed.

STYLE: Be concise and warm — usually 1–2 short sentences. No preamble, no restating the question, no filler like "Great question" or "I'd be happy to help". Reply in the SAME language the user writes in (English, Russian, or Armenian).

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

WHO USES HUSHARE / COLLABORATIONS
- Hushare is a young startup but already partners with musicians and events. Examples: Eurovision artists Ladaniva and Tali Golergant — fans upload their concert photos via a QR into one shared album; and running events like the Tricolor Night Run and Puma Run Club, where runners find and download their own photos (including by selfie with Face Finder). We've powered events across roughly 15 countries.

PLANS (photos & videos = same pool)
- Guest (no account): 2 albums, up to 150 items each.
- Free (free account): 3 albums, up to 250 items each.
- Pro (~$4/month): 15 albums, up to 2,500 items each, password protection, custom album URLs, HD video, larger uploads.
- Max (~$10/month): 50 albums, up to 10,000 items each, Face Finder, custom branding, priority support.
- You can start free with no credit card. Big partner/event albums can be raised on request.

FILES & LIMITS
- Free: images (JPG/PNG/HEIC/WebP) up to 25 MB, videos (MP4/MOV/WebM) up to 50 MB. Pro/Max allow much larger (up to 4 GB video on Max).
- Albums are unlisted and not indexed by search engines — only people with the link can see them.
- Free albums auto-retire after ~3 months of inactivity (with an email warning first); paid plans keep them.

WHEN YOU TRULY CAN'T SOLVE IT — HANDOFF TO A HUMAN
Most things you can answer yourself; do that first. Some things genuinely need a person: refunds, billing/payment problems, a lost owner link, a specific broken or missing album, account changes, or partnership/press/booking requests. For those, do NOT just tell them to visit a page. Instead:
1. Understand it first — ask a brief question or two (what happened, which album by name or link, and when). One short question at a time.
2. Ask for their email so the team can reply, if they haven't given one.
3. Once you have a clear picture AND their email, reply warmly that you've passed it to the Hushare team and they'll email them soon. Then, on the FINAL line of that same reply, output exactly this tag and nothing after it:
[[HANDOFF|their@email.com|one-line summary of the issue|category]]
category is one of: refund, billing, lost-link, broken-album, partnership, other.

HANDOFF RULES: Only output the tag once you actually have their email address. The tag is invisible plumbing — never mention it, never show its format, never ask the user to type it, never explain it. If the user refuses to give an email, tell them to reach us at hushare.space/support (and output no tag).`

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
}

// Pull the hidden [[HANDOFF|...]] tag out of the model's reply. Returns the cleaned reply (tag
// removed) and, when the tag carried a valid email, the parsed escalation info.
const HANDOFF_RE = /\[\[HANDOFF\|([^\]]*?)\]\]/i
function parseHandoff(reply: string): { clean: string; info: { email: string; summary: string; category: string } | null } {
  const m = reply.match(HANDOFF_RE)
  const clean = reply.replace(HANDOFF_RE, '').replace(/[`\s]+$/,'').trimEnd()
  if (!m) return { clean, info: null }
  const parts = m[1].split('|').map(s => s.trim())
  const email = parts[0] ?? ''
  const summary = (parts[1] || 'Support request from chat').slice(0, 200)
  const category = (parts[2] || 'other').toLowerCase().slice(0, 40)
  if (!EMAIL_RE.test(email)) return { clean, info: null } // bad/placeholder email → strip tag, don't send
  return { clean, info: { email, summary, category } }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

// Best-effort escalation email to the support inbox with the full chat transcript. Returns true on
// success; the caller adjusts the user-facing reply if it fails so we never falsely promise a reply.
async function sendHandoffEmail(
  history: ChatMsg[],
  finalReply: string,
  info: { email: string; summary: string; category: string },
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) { console.error('[support/chat] RESEND_API_KEY not set — handoff email dropped'); return false }
  const from = process.env.RESEND_DOMAIN_VERIFIED === 'true' ? VERIFIED_FROM : FALLBACK_FROM

  const turns = [...history, { role: 'assistant', content: finalReply }]
    .map(m => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const subjectLine = `[Chat] ${info.category} — ${info.summary}`.slice(0, 120)
  const text = [
    'New support request from the on-site AI chat',
    '',
    `Reply-to: ${info.email}`,
    `Category: ${info.category}`,
    `Summary: ${info.summary}`,
    '',
    '---- conversation ----',
    turns,
    '----------------------',
    '',
    `Reply directly to this email to respond to the visitor.`,
  ].join('\n')

  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;">New support request from the AI chat</h2>
      <p style="margin:0 0 6px;color:#5C4A3C;"><strong>Reply-to:</strong> ${escapeHtml(info.email)}</p>
      <p style="margin:0 0 6px;color:#5C4A3C;"><strong>Category:</strong> ${escapeHtml(info.category)}</p>
      <p style="margin:0 0 6px;color:#5C4A3C;"><strong>Summary:</strong> ${escapeHtml(info.summary)}</p>
      <hr style="border:none;border-top:1px solid #E8E0D0;margin:16px 0;" />
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5;color:#5C4A3C;margin:0;">${escapeHtml(turns)}</pre>
      <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
      <p style="margin:0;color:#B0A090;font-size:12px;">Reply directly to this email to reach the visitor.</p>
    </div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [SUPPORT_TO], reply_to: info.email, subject: subjectLine, html, text }),
    })
    if (!res.ok) { console.error('[support/chat] Resend error:', res.status, await res.text()); return false }
    return true
  } catch (err) {
    console.error('[support/chat] handoff email fetch failed:', err)
    return false
  }
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
  const messages: ChatMsg[] = raw
    .filter((m): m is ChatMsg =>
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
      max_tokens: 220,
      temperature: 0.3,
    }) as { response?: string }

    const rawReply = (result?.response ?? '').trim() || "Sorry, I didn't catch that — could you rephrase? For anything account-specific, hushare.space/support can help."
    const { clean, info } = parseHandoff(rawReply)

    if (info) {
      const sent = await sendHandoffEmail(messages, clean, info)
      const reply = sent
        ? clean
        : `${clean}\n\nIf you don't hear back within a day, please also reach us at hushare.space/support.`
      return NextResponse.json({ reply, handoff: sent }, { headers: NO_STORE })
    }

    return NextResponse.json({ reply: clean }, { headers: NO_STORE })
  } catch (e) {
    console.error('[support/chat] AI run failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ reply: "I'm having a moment — please try again, or reach us at hushare.space/support." }, { headers: NO_STORE })
  }
}
