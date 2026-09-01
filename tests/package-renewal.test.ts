import { describe, it, expect } from 'vitest'
import { renewalReminderDue, daysUntil } from '../src/lib/package-renewal'

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
