import { describe, it, expect } from 'vitest'
import { renewalReminderDue, daysUntil, renewalNotices, type RenewableAlbum } from '../src/lib/package-renewal'

const d = (s: string) => new Date(s)
const NOW = d('2026-09-01T12:00:00Z')

describe('renewalReminderDue — the email IS the renewal mechanism', () => {
  it('is quiet while the expiry is far away', () => {
    expect(renewalReminderDue(d('2027-06-01T00:00:00Z'), null, NOW)).toBeNull()
    expect(renewalReminderDue(d('2026-10-15T00:00:00Z'), null, NOW)).toBeNull()   // 44 days out
  })

  it('sends the FIRST reminder inside 30 days', () => {
    expect(renewalReminderDue(d('2026-09-25T00:00:00Z'), null, NOW)).toBe('first')   // ~24 days
    expect(renewalReminderDue(d('2026-10-01T11:00:00Z'), null, NOW)).toBe('first')   // just under 30
  })

  it('sends the FINAL reminder inside 7 days — even though the first was already sent', () => {
    // The whole point of per-window tracking: a reminder stamped in the 30-day window covers that
    // window only. Entering the last week must always produce the second email, or "warned at 30
    // and 7" quietly becomes "warned once".
    const expires = d('2026-09-05T00:00:00Z')                     // 4 days out
    const remindedInFirstWindow = d('2026-08-10T00:00:00Z')       // stamped 26 days before expiry
    expect(renewalReminderDue(expires, remindedInFirstWindow, NOW)).toBe('final')
  })

  it('never repeats a reminder inside its own window', () => {
    const expires = d('2026-09-25T00:00:00Z')
    const remindedYesterday = d('2026-08-31T12:00:00Z')
    expect(renewalReminderDue(expires, remindedYesterday, NOW)).toBeNull()

    const soon = d('2026-09-05T00:00:00Z')
    const remindedInFinal = d('2026-08-30T00:00:00Z')             // inside the 7-day window
    expect(renewalReminderDue(soon, remindedInFinal, NOW)).toBeNull()
  })

  it('goes quiet once the package has lapsed — the retirement machinery owns it then', () => {
    expect(renewalReminderDue(d('2026-08-30T00:00:00Z'), null, NOW)).toBeNull()
    expect(renewalReminderDue(NOW, null, NOW)).toBeNull()
  })

  it('treats an unreadable reminder stamp as never-reminded', () => {
    // Worst case of this direction is a duplicate email; the other direction skips the only
    // warning between a customer and losing their album.
    expect(renewalReminderDue(d('2026-09-25T00:00:00Z'), d('garbage'), NOW)).toBe('first')
  })

  it('handles the exact window edges', () => {
    // Exactly 7 days out is the final window; exactly 30 days out is the first.
    expect(renewalReminderDue(d('2026-09-08T12:00:00Z'), null, NOW)).toBe('final')
    expect(renewalReminderDue(d('2026-10-01T12:00:00Z'), null, NOW)).toBe('first')
  })
})

describe('daysUntil', () => {
  it('rounds up and never says zero while unexpired', () => {
    expect(daysUntil(d('2026-09-08T12:00:00Z'), NOW)).toBe(7)
    expect(daysUntil(d('2026-09-02T00:00:00Z'), NOW)).toBe(1)
    expect(daysUntil(d('2026-09-01T13:00:00Z'), NOW)).toBe(1)
  })
})


describe('which albums the account page offers to renew', () => {
  // The renewal email now lands here rather than on the album, because an album can be behind a
  // password and the person opening that email two years later has neither the password nor an
  // owner cookie. Whatever this returns IS the renewal path — an album missing from it has no
  // way to be paid for at all.
  const NOW = new Date('2026-09-01T00:00:00Z')
  const at = (iso: string, over: Partial<RenewableAlbum> = {}): RenewableAlbum => ({
    id: 'a-' + iso, slug: 's-' + iso, custom_slug: null, title: 'Album',
    package_tier: 'pro', package_expires_at: iso, ...over,
  })

  it('offers what is inside the 30-day window and ignores what is not', () => {
    const soon = at('2026-09-20T00:00:00Z')        // 19 days out
    const far = at('2027-06-01T00:00:00Z')          // months out
    const out = renewalNotices([far, soon], NOW)
    expect(out.map((n) => n.album.id)).toEqual([soon.id])
    expect(out[0].daysLeft).toBe(19)
    expect(out[0].lapsed).toBe(false)
  })

  it('STILL offers a lapsed package — a late renewal is a real sale', () => {
    // The album is not gone the day the package ends; the retirement sweep warns first. Dropping
    // it from this list would remove the only way to pay right when someone finally means to.
    const out = renewalNotices([at('2026-08-01T00:00:00Z')], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].lapsed).toBe(true)
    expect(out[0].daysLeft, 'no invented time remaining').toBe(0)
  })

  it('soonest first, so the urgent one is the one they see', () => {
    const later = at('2026-09-25T00:00:00Z')
    const sooner = at('2026-09-03T00:00:00Z')
    const lapsed = at('2026-08-20T00:00:00Z')
    expect(renewalNotices([later, sooner, lapsed], NOW).map((n) => n.album.id))
      .toEqual([lapsed.id, sooner.id, later.id])
  })

  it('an album with no package, or an unreadable expiry, is never listed', () => {
    // Rule 20: this card states how long is left. With nothing trustworthy to state it stays quiet
    // rather than printing a number it made up.
    const none = at('2026-09-10T00:00:00Z', { package_tier: null })
    const noDate = at('2026-09-10T00:00:00Z', { package_expires_at: null })
    const junk = at('not-a-date')
    expect(renewalNotices([none, noDate, junk], NOW)).toEqual([])
  })

  it('carries the tier through, because it decides the price charged', () => {
    const max = at('2026-09-10T00:00:00Z', { package_tier: 'studio' })
    expect(renewalNotices([max], NOW)[0].tier).toBe('studio')
  })

  it('the boundary: exactly 30 days out is offered, a minute past it is not', () => {
    const edge = at('2026-10-01T00:00:00Z')                 // exactly 30 days
    const past = at('2026-10-01T00:01:00Z')
    expect(renewalNotices([edge], NOW)).toHaveLength(1)
    expect(renewalNotices([past], NOW)).toHaveLength(0)
  })
})
