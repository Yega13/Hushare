import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ALERT_WINDOW_MINUTES } from '@/lib/error-alert-grouping'

// THE EMAIL THAT WAKES SOMEBODY UP, RENDERED RATHER THAN READ.
//
// lib/email sits on the untested-module register, and that exemption is why every escaping mutation
// against this template survived the whole suite: deleting escapeHtml from the customer-written
// album title, from the mailto: href, from the album link — all green. The file has just become the
// one that writes CUSTOMER EMAIL ADDRESSES and CUSTOMER-WRITTEN TITLES into an operator's inbox, so
// it is the wrong file to leave uncovered.
//
// This runs the real template and reads back the exact JSON Resend would receive. Nothing about the
// markup is re-implemented here (rule 17); the only thing stubbed is the network.
//
// The two defects it pins:
//   1. HTML and PLAIN TEXT disagreeing. The text part is what a lock-screen preview shows, and it
//      emitted "and N more albums" unconditionally — so when the HTML omitted the album block, the
//      preview still carried a line pointing at nothing.
//   2. "could not look them up" rendering identically to "none was involved" (rule 20).

type Sent = { subject: string; html: string; text: string; to: string[] }
let sent: Sent[] = []
/** The raw init of each fetch, so the request itself can be asserted and not only its body. */
let fetchInits: Array<Record<string, unknown>> = []

const originalFetch = globalThis.fetch

beforeEach(() => {
  sent = []
  fetchInits = []
  process.env.RESEND_API_KEY = 'test-key-not-a-real-one'
  process.env.RESEND_DOMAIN_VERIFIED = 'false'
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    fetchInits.push((init ?? {}) as Record<string, unknown>)
    sent.push(JSON.parse(init?.body ?? '{}') as Sent)
    return { ok: true, text: async () => '', json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
})

afterEach(() => { globalThis.fetch = originalFetch })

const { sendErrorSpikeEmail, EMAIL_TIMEOUT_MS } = await import('@/lib/email')

const TO = 'ops@example.com'
// A COUNT NO OTHER FIXTURE CAN SPELL. It was 23, and the slug in most of these tests is
// 'abc123' — so `toContain('23')` was already satisfied by the LINK, and would have passed a
// build that printed no count at all the moment an album block appeared in that test. Two
// characters is not an assertion, it is a coincidence waiting to be believed.
const base = { count: 8341, windowMinutes: 10, deviceCount: 4, top: [['upload failed', 20]] as [string, number][] }

describe('the album block says only what is true', () => {
  it('names each album, its count, and a way to reach the owner', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Anna & David', count: 20, owner: 'anna@example.com' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.to).toEqual([TO])
    expect(msg.html).toContain('mailto:anna@example.com')
    expect(msg.text).toContain('anna@example.com')
    expect(msg.text).toContain('/abc123')
  })

  it('prints a guest album as having no account, and does NOT make it a mailto', async () => {
    // Two thirds of albums have no account. "Cannot be contacted" is the fact worth having while
    // something is failing — but it must never become a broken mailto: link.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Untitled', count: 20, owner: '(no account)' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).toContain('(no account)')
    expect(msg.html).not.toContain('mailto:(no account)')
  })

  it('distinguishes a FAILED lookup from a contactable customer', async () => {
    // The defect this replaced: a transient GoTrue blip rendered "no account — cannot be
    // contacted" about a paying customer. '(unknown user)' says we could not name them, which is
    // the honest answer and a different one.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Untitled', count: 20, owner: '(unknown user)' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).toContain('(unknown user)')
    expect(msg.html).not.toContain('cannot be contacted')
    expect(msg.html).not.toContain('mailto:(unknown')
  })

  it('HTML and PLAIN TEXT agree when no album could be listed', async () => {
    // THE DIVERGENCE. The text is the lock-screen preview; it used to emit "and 2 more albums"
    // while the HTML omitted the block entirely, so the preview referred to nothing at all.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 2 })
    const [msg] = sent
    expect(msg.html).not.toContain('more album')
    expect(msg.text).not.toContain('more album')
  })

  it('says the lookup FAILED rather than implying no album was involved', async () => {
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0, lookupFailed: true })
    const [msg] = sent
    expect(msg.html).toContain('could not be looked up')
    expect(msg.text).toContain('could not be looked up')
  })

  it('still reports the count when there is no album block at all', async () => {
    // A number-only alert is the one this replaced and is far better than silence: the enrichment
    // is allowed to fail without losing the alarm.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.subject).toContain('8341')
    expect(msg.html).toContain('8341')
  })
})

describe('nothing a customer wrote can break out of the markup', () => {
  it('escapes a hostile album title in the link text', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{
        slug: 'abc123',
        title: '"><img src=x onerror=alert(1)><a href="',
        count: 20,
        owner: 'anna@example.com',
      }],
      moreAlbums: 0,
    })
    const [msg] = sent
    // The raw tag must not survive; the escaped form must.
    expect(msg.html).not.toContain('<img src=x')
    expect(msg.html).toContain('&lt;img src=x')
  })

  it('escapes an ampersand rather than emitting a stray entity', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Anna & Bob <3', count: 20, owner: 'a@b.com' }],
      moreAlbums: 0,
    })
    expect(sent[0].html).toContain('Anna &amp; Bob &lt;3')
  })

  it('escapes a quote in the slug so it cannot break out of the href attribute', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'a"onmouseover="x', title: 'T', count: 1, owner: 'a@b.com' }],
      moreAlbums: 0,
    })
    expect(sent[0].html).not.toContain('"onmouseover="')
  })

  it('escapes a hostile OWNER value — the field this file exists to protect', async () => {
    // Three escapeHtml calls survived mutation here, and all three were on `owner`: the mailto
    // href, the link text, and the label span. Every owner value in this file was
    // metacharacter-free, so the field carrying a CUSTOMER EMAIL ADDRESS was the one thing the
    // escaping tests did not exercise.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'T', count: 1, owner: 'a@b.com"><script>x</script>' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).not.toContain('<script>')
    expect(msg.html).toContain('&lt;script&gt;')
    // And it must not have broken out of the href attribute either.
    expect(msg.html).not.toContain('mailto:a@b.com"><')
  })

  it('escapes an owner LABEL too, which takes a different branch', async () => {
    // The label branch is chosen when the value has no '@'. My first hostile-owner test used an
    // address, so it went down the mailto branch and left this one untested — the mutation removing
    // escapeHtml here survived. Only '(no account)' and '(unknown user)' reach it today, but the
    // branch must not depend on that staying true.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'T', count: 1, owner: '(unknown <script>alert(1)</script>)' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).not.toContain('<script>')
    expect(msg.html).toContain('&lt;script&gt;')
  })

  it('states the per-album count, in BOTH parts', async () => {
    // The test named "names each album, its count, and a way to reach the owner" never asserted the
    // count. Zeroing it in the HTML and again in the plain text both survived.
    //
    // 4242 ON PURPOSE. The first version of this test used 20, which is also the count in `base`'s
    // message tally — so both assertions passed on the tally line and the mutations STILL survived.
    // A test that passes for the wrong reason is the thing rule 16 exists to find, and it found this
    // one. The number here must appear nowhere else in the email.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Anna', count: 4242, owner: 'a@b.com' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).toContain('4242')
    expect(msg.text).toContain('4242x')
  })

  it('keeps the heading that introduces the list', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Anna', count: 20, owner: 'a@b.com' }],
      moreAlbums: 0,
    })
    expect(sent[0].html).toContain('Which albums:')
    expect(sent[0].text).toContain('Which albums:')
  })

  it('says "1 more album", not "1 more albums" — in both parts', async () => {
    // The pluralisation is written TWICE, once for the HTML and once for the text, and neither copy
    // was asserted. Inverting either survived. One fact, two places (rule 13).
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'Anna', count: 20, owner: 'a@b.com' }],
      moreAlbums: 1,
    })
    const [msg] = sent
    expect(msg.html).toContain('1 more album')
    expect(msg.html).not.toContain('1 more albums')
    expect(msg.text).toContain('1 more album')
    expect(msg.text).not.toContain('1 more albums')
  })

  it('truncates a very long title, and truncates BEFORE escaping', async () => {
    // The reverse order would cut an entity in half and emit broken markup.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: 'abc123', title: 'x'.repeat(500), count: 1, owner: 'a@b.com' }],
      moreAlbums: 0,
    })
    expect(sent[0].html).not.toContain('x'.repeat(100))
  })
})

describe('a real alert never reads like a test, and says what broke', () => {
  // FOUR MUTATIONS SURVIVED IN THIS BLOCK, and it is the only part of the email that says WHAT is
  // wrong. The heading, the explanation and the message list were all unasserted.

  it('a real alert does not claim to be a test', async () => {
    // `const heading = true` survived: the subject would read "8341 uploads or pages failed" while
    // the body read "This is a test. Nothing is wrong." An alert that contradicts itself is exactly
    // what teaches an operator to ignore the next one.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.html).not.toContain('This is a test')
    expect(msg.html).not.toContain('Nothing is wrong')
    expect(msg.html).toContain('8341 things failed')
  })

  it('a TEST alert says so in both the subject and the body', async () => {
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0, test: true })
    const [msg] = sent
    expect(msg.subject).toContain('test alert')
    expect(msg.html).toContain('This is a test')
  })

  it('names the failing messages, with their counts, in BOTH parts', async () => {
    // Emptying the list, zeroing the counts, and replacing the body with a literal all survived.
    // This is the only content that answers "what is broken".
    await sendErrorSpikeEmail(TO, {
      ...base,
      top: [['tus chunk failed', 777], ['presign timed out', 3]],
      albums: [], moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).toContain('tus chunk failed')
    expect(msg.html).toContain('777')
    expect(msg.text).toContain('777x tus chunk failed')
    expect(msg.html).toContain('presign timed out')
  })

  it('escapes a hostile failure message — it arrives from an unauthenticated POST', async () => {
    // Every `top` value in this file was 'upload failed', metacharacter-free, so removing
    // escapeHtml here survived. The string comes straight from /api/log/client-error into the
    // operator's inbox HTML.
    await sendErrorSpikeEmail(TO, {
      ...base,
      top: [['<img src=x onerror=alert(1)>', 9]],
      albums: [], moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).not.toContain('<img src=x')
    expect(msg.html).toContain('&lt;img src=x')
  })

  it('truncates a very long failure message', async () => {
    await sendErrorSpikeEmail(TO, { ...base, top: [['z'.repeat(600), 9]], albums: [], moreAlbums: 0 })
    expect(sent[0].html).not.toContain('z'.repeat(200))
  })

  it('states the window, and the device count with the right plural', async () => {
    await sendErrorSpikeEmail(TO, { ...base, deviceCount: 1, albums: [], moreAlbums: 0 })
    expect(sent[0].html).toContain('10 minutes')
    expect(sent[0].html).toContain('1 device')
    expect(sent[0].html).not.toContain('1 devices')
  })

  it('links to the dashboard, in both parts', async () => {
    // Replacing the link with about:blank survived in HTML and text. It is the only action in the
    // email — an alert you cannot act from is a notification.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.html).toContain('/admin#errors')
    expect(msg.text).toContain('/admin#errors')
  })
})

describe('an album we could not identify gets no link', () => {
  it('never offers the marketing home page as an album link', async () => {
    // `${SITE_URL}/${slug}` with an empty slug is https://hushare.space/ — the marketing page —
    // rendered as a confident link to that album, in the email an operator opens during an
    // incident. Not reachable today, because attachAlbumOwners resolves all-or-nothing and the
    // all-failed case renders a different block. It is guarded anyway: the uncertain branch must do
    // nothing rather than guess (rule 19), and every "not reachable today" in this file's history
    // became reachable when somebody made a resolution partial.
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [{ slug: '', title: 'Mystery album', count: 5, owner: '(unknown user)' }],
      moreAlbums: 0,
    })
    const [msg] = sent
    expect(msg.html).toContain('could not be identified')
    expect(msg.html).not.toMatch(/href="https:\/\/hushare\.space\/"/)
    expect(msg.text).toContain('could not be identified')
    expect(msg.text).not.toMatch(/— https:\/\/hushare\.space\/ —/)
  })

  it('still links an album that DID resolve, in the same email', async () => {
    await sendErrorSpikeEmail(TO, {
      ...base,
      albums: [
        { slug: '', title: 'Mystery', count: 5, owner: '(unknown user)' },
        { slug: 'realslug', title: 'Real', count: 3, owner: 'a@b.com' },
      ],
      moreAlbums: 0,
    })
    expect(sent[0].html).toContain('/realslug')
    expect(sent[0].text).toContain('/realslug')
  })
})

describe('nothing a stranger writes can forge a line of this email', () => {
  // The plain-text part is assembled as LINES on purpose - it is what a lock-screen preview shows.
  // The failure message reached it unescaped AND untruncated, while the HTML sliced to 140. Since
  // /api/log/client-error is unauthenticated and stores the message with its newlines intact, one
  // POST could write its own lines into that preview.
  it('collapses newlines in a failure message, so it cannot add its own lines', async () => {
    const forged = 'boom' + String.fromCharCode(10) + String.fromCharCode(10) + 'Which albums:' + String.fromCharCode(10)
      + '12000x Everything is fine - https://hushare.space/admin' + String.fromCharCode(10) + String.fromCharCode(10)
      + 'Resolved automatically. No action needed.'
    await sendErrorSpikeEmail(TO, { ...base, top: [[forged, 9]], albums: [], moreAlbums: 0 })
    const [msg] = sent
    const lines = msg.text.split(String.fromCharCode(10)).map((l: string) => l.trim())
    expect(lines, 'the forged line must not stand on its own')
      .not.toContain('Resolved automatically. No action needed.')
    expect(msg.text, 'but the text itself is still reported, on one line').toContain('boom')
  })

  it('truncates the failure message in the TEXT part too, not only the HTML', async () => {
    // 140 in the HTML and unbounded in the text meant the two halves of one email disagreed by up
    // to 360 characters.
    await sendErrorSpikeEmail(TO, { ...base, top: [['z'.repeat(600), 9]], albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.text).not.toContain('z'.repeat(200))
    expect(msg.html).not.toContain('z'.repeat(200))
    expect(msg.text, 'it is still reported, just bounded').toContain('z'.repeat(100))
  })
})

describe('the email states the window it actually measured', () => {
  it('names the widened window, not the nominal one', async () => {
    // The query looks back WINDOW_MINUTES + COALESCE_WINDOW_MINUTES, because a row absorbing repeats
    // keeps its original created_at. The email named WINDOW_MINUTES, so every alert ever sent
    // reported a window nobody had computed.
    await sendErrorSpikeEmail(TO, { ...base, windowMinutes: ALERT_WINDOW_MINUTES, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(ALERT_WINDOW_MINUTES).toBe(15)
    expect(msg.subject).toContain('15 min')
    expect(msg.html).toContain('last 15 minutes')
  })
})

describe('a count drawn from a truncated sample says so', () => {
  it('says "at least" when the sample was full', async () => {
    await sendErrorSpikeEmail(TO, { ...base, truncated: true, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.subject).toContain('at least 8341')
    expect(msg.html).toContain('At least 8341')
  })

  it('and does NOT when it was not', async () => {
    // The mirror error matters as much: hedging a number that is exact teaches the reader to
    // discount every number in the email.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0 })
    const [msg] = sent
    expect(msg.subject).not.toContain('at least')
    expect(msg.html).not.toContain('At least')
  })
})

describe('a send that hangs is abandoned, not waited on forever', () => {
  it('gives every request an abort signal', async () => {
    // WHY THIS IS NOT COSMETIC. The error-alert cron claims its cooldown BEFORE sending, on purpose
    // - claiming after means a failed write re-sends on every tick. So a send that never returns
    // means the catch never runs, the hourly slot is never released, no log line is written, and
    // the next 59 ticks answer 'same-incident'. A full hour of silence from the alarm, during the
    // incident it exists to report. The route already bounds its album lookup at 4s and explains
    // exactly this - the bound was on the small loss and not on the send.
    await sendErrorSpikeEmail(TO, { ...base, albums: [], moreAlbums: 0 })
    expect(fetchInits).toHaveLength(1)
    expect(fetchInits[0].signal, 'an unbounded send costs the alarm a whole hour').toBeInstanceOf(AbortSignal)
  })

  it('bounds it at ten seconds, pinned against a literal', async () => {
    // Against a LITERAL, because `toBe(EMAIL_TIMEOUT_MS)` says n === n and would pass at ten
    // minutes - which restores the hang this exists to prevent (MISTAKES entry 15).
    //
    // Ten seconds is deliberately generous: six senders share sendEmail, including customer-facing
    // renewal and expiry warnings, and a tight bound turns delivered-but-slow into "failed".
    expect(EMAIL_TIMEOUT_MS).toBe(10_000)
  })
})

// WHAT THIS FILE CANNOT ASSERT, said plainly rather than left as an implied guarantee: that the
// abort actually FIRES. Node's AbortSignal.timeout does not route through vitest's patched
// setTimeout, so fake timers cannot drive it, and a real-time test would take ten seconds of every
// suite run. The two assertions above kill both realistic mutations - deleting the signal, and
// raising the constant past usefulness - and that is the honest limit of it (rule 20).
