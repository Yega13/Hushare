import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { track } from '@/lib/analytics'

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

SAFETY — CRISIS / SELF-HARM (HIGHEST PRIORITY — this overrides every other rule below):
If someone mentions suicidal thoughts, self-harm, wanting to die, harming someone else, or being in danger, drop the Hushare topic completely — their safety is the only thing that matters. Be warm, calm, and non-judgmental; never minimize or dismiss what they feel. You are NOT a therapist: do not try to counsel, diagnose, or "fix" them, do NOT ask for their email, and do NOT say the Hushare team will help them — Hushare is a photo app, not a crisis service, and a false promise can delay the real help they need. Instead:
- Gently tell them that people trained for exactly this are available right now, and that reaching out is worth it.
- Share these (translate naturally into the language they're writing in): "If you're in immediate danger, call your local emergency number now — 112 or 911. To reach a free, confidential helpline in your country, go to findahelpline.com. In the US you can call or text 988."
- Encourage them to contact one of these right now, and a trusted person if they have one.
- Keep listening with genuine care if they keep talking, but keep guiding them back to those real resources. Do not lecture or repeat a robotic disclaimer.
Then, on the very last line of your reply, output exactly [[WELFARE]] and nothing after it. This is a silent internal flag so our team is aware something serious happened — never mention it, never explain it, never show its format. Never use the [[HANDOFF]] flow for a crisis; use these SAFETY rules only.

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
- Free albums auto-retire after 1 year of inactivity (with an email warning first); paid plans keep them, plus a year after cancelling.

WHEN YOU TRULY CAN'T SOLVE IT — HANDOFF TO A HUMAN
Most things you can answer yourself; do that first. Some things genuinely need a person: refunds, billing/payment problems, a lost owner link, a specific broken or missing album, account changes, or partnership/press/booking requests. For those, do NOT just tell them to visit a page. Instead:
1. Understand it first — ask a brief question or two (what happened, which album by name or link, and when). One short question at a time.
2. Ask for their email so the team can reply, if they haven't given one.
3. Once you have a clear picture AND their email, reply warmly that you've passed it to the Hushare team and they'll email them soon. Then, on the FINAL line of that same reply, output exactly this tag and nothing after it:
[[HANDOFF|their@email.com|one-line summary of the issue|category]]
category is one of: refund, billing, lost-link, broken-album, partnership, other.

HANDOFF RULES: Only output the tag once you actually have their email address. The tag is invisible plumbing — never mention it, never show its format, never ask the user to type it, never explain it. If the user refuses to give an email, tell them to reach us at hushare.space/support (and output no tag). Never use HANDOFF for a self-harm/crisis situation — follow the SAFETY rules at the very top instead.`

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
}

// Pull the hidden [[HANDOFF|...]] tag out of the model's reply. Returns the cleaned reply (tag
// removed) and, when the tag carried a valid email, the parsed escalation info.
const WELFARE_RE = /\[\[WELFARE\]\]/i
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

// Server-side crisis backstop — a guaranteed net under the model's own judgement. Checks ONLY the
// latest user message (so a past crisis turn doesn't re-fire forever once the chat moves on).
// Patterns are deliberately specific to avoid idioms ("this bug is killing me" won't match).
const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(?:ing)? (?:myself|my ?self)\b/i,
  /\b(?:end|ending|take|taking) (?:my|my own) life\b/i,
  /\bend it all\b/i,
  /\b(?:want|wanna|going) to die\b/i,
  /\bdon'?t (?:want to|wanna) (?:live|be alive|exist)\b/i,
  /\bbetter off dead\b/i,
  /\b(?:self[-\s]?harm|harm(?:ing)? myself|hurt(?:ing)? myself|cut(?:ting)? myself)\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bno (?:reason|point|purpose) (?:to|in|for) (?:live|living|life|being alive)\b/i,
  /покончить с собой/i, /не хочу (?:больше )?жить/i, /убить себя/i, /суицид/i, /свести счёты с жизнью/i,
  /ինքնասպան/i, /չեմ ուզում ապրել/i,
]
function detectCrisisKeywords(msgs: ChatMsg[]): boolean {
  const last = [...msgs].reverse().find(m => m.role === 'user')?.content ?? ''
  return CRISIS_PATTERNS.some(re => re.test(last))
}
const CRISIS_RESOURCES = "You matter, and people trained for exactly this are available right now. If you're in immediate danger, call your local emergency number — 112 or 911. To reach a free, confidential helpline in your country, go to findahelpline.com (in the US, call or text 988). Please reach out to one of them, and to someone you trust if you can."
const HAS_RESOURCES_RE = /findahelpline|helpline|hotline|emergency|\b988\b|\b112\b|\b911\b/i

// Strip PII before anything gets logged to analytics.
function redactPII(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
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

// Silent welfare alert — fires when the model flags a possible crisis/self-harm conversation. This is
// for the team's AWARENESS only; the visitor has already been shown crisis-line resources by the bot.
// Deliberately NOT a "we'll help you" handoff: no reply-to a person in crisis, no promise of a reply.
async function sendWelfareAlert(history: ChatMsg[], finalReply: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) { console.error('[support/chat] RESEND_API_KEY not set — welfare alert dropped'); return false }
  const from = process.env.RESEND_DOMAIN_VERIFIED === 'true' ? VERIFIED_FROM : FALLBACK_FROM

  const turns = [...history, { role: 'assistant', content: finalReply }]
    .map(m => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const disclaimer = 'A visitor to the chat may be in crisis. The assistant has already shown them crisis-line resources (emergency numbers + findahelpline.com). Hushare is NOT a crisis or mental-health service — please do not attempt to provide clinical or crisis counselling, and do not promise them help you cannot give. This alert is for your awareness only. If you have genuine reason to believe someone is in immediate danger and you can identify them, contact local emergency services.'

  const text = ['⚠ Possible crisis in the support chat', '', disclaimer, '', '---- conversation ----', turns, '----------------------'].join('\n')
  const html = `
    <div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;font-size:18px;">⚠ Possible crisis in the support chat</h2>
      <p style="margin:0 0 16px;color:#8a4b00;background:#fff6e6;border:1px solid #f0d9a8;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">${escapeHtml(disclaimer)}</p>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5;color:#5C4A3C;margin:0;">${escapeHtml(turns)}</pre>
    </div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [SUPPORT_TO], subject: '[Welfare] possible crisis in support chat', html, text }),
    })
    if (!res.ok) { console.error('[support/chat] welfare Resend error:', res.status, await res.text()); return false }
    return true
  } catch (err) {
    console.error('[support/chat] welfare alert fetch failed:', err)
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

    // Crisis/self-harm takes precedence over everything. Fires on EITHER the model's own [[WELFARE]]
    // flag OR the server-side keyword backstop, so a missed model flag can't leave someone unhelped.
    // We guarantee crisis resources are in the reply, alert the team silently, and never log the text.
    if (WELFARE_RE.test(rawReply) || detectCrisisKeywords(messages)) {
      let clean = rawReply.replace(WELFARE_RE, '').replace(/[`\s]+$/, '').trimEnd()
      if (!HAS_RESOURCES_RE.test(clean)) clean = clean ? `${clean}\n\n${CRISIS_RESOURCES}` : CRISIS_RESOURCES
      await sendWelfareAlert(messages, clean)
      return NextResponse.json({ reply: clean }, { headers: NO_STORE })
    }

    const { clean, info } = parseHandoff(rawReply)

    if (info) {
      const sent = await sendHandoffEmail(messages, clean, info)
      track({ name: 'support_chat', outcome: 'handoff' })
      const reply = sent
        ? clean
        : `${clean}\n\nIf you don't hear back within a day, please also reach us at hushare.space/support.`
      return NextResponse.json({ reply, handoff: sent }, { headers: NO_STORE })
    }

    track({ name: 'support_chat', question: redactPII(messages[messages.length - 1].content), outcome: 'answered' })
    return NextResponse.json({ reply: clean }, { headers: NO_STORE })
  } catch (e) {
    console.error('[support/chat] AI run failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ reply: "I'm having a moment — please try again, or reach us at hushare.space/support." }, { headers: NO_STORE })
  }
}
