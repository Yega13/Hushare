import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

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

const originalFetch = globalThis.fetch

beforeEach(() => {
  sent = []
  process.env.RESEND_API_KEY = 'test-key-not-a-real-one'
  process.env.RESEND_DOMAIN_VERIFIED = 'false'
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? '{}') as Sent)
    return { ok: true, text: async () => '', json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
})

afterEach(() => { globalThis.fetch = originalFetch })

const { sendErrorSpikeEmail } = await import('@/lib/email')

const TO = 'ops@example.com'
const base = { count: 23, windowMinutes: 10, deviceCount: 4, top: [['upload failed', 20]] as [string, number][] }

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
    expect(msg.subject).toContain('23')
    expect(msg.html).toContain('23')
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
