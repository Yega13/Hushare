import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GRACE_DAYS } from '@/lib/server/media-backup'

// THE PRIVACY POLICY'S BACKUP PROMISE IS THE BACKUP'S OWN NUMBER.
//
// A translation cannot import a module, so the number is typed into each language (rule 13) -- and
// typed copies drift: the free video cap once read 50 MB in two languages after English had been
// corrected to 200. If GRACE_DAYS changes and the policy does not, the policy is wrong about how long a
// deleted photo survives, which is exactly the sentence a privacy policy must not get wrong.
//
// Armenian joins this test when its translation arrives. If GRACE_DAYS changes, the Russian number
// needs its grammar redone by hand (31 день, 30 дней), and these expectations with it.

function retentionSection(file: string): string {
  const src = readFileSync(join(process.cwd(), 'src', 'app', 'privacy', file), 'utf8')
  const start = src.indexOf("id: 'retention'")
  expect(start, `no retention section found in ${file}`).toBeGreaterThan(-1)
  const end = src.indexOf('id: ', start + 1)
  return end === -1 ? src.slice(start) : src.slice(start, end)
}

describe('the privacy policy says how long the backup keeps a deleted photo', () => {
  it('in English', () => {
    const text = retentionSection('content-en.tsx')
    expect(text).toContain(`<strong style={INK}>${GRACE_DAYS} days</strong>`)
    expect(text).toContain(`within those ${GRACE_DAYS} days`)
    expect(text).toContain(`Once the ${GRACE_DAYS} days have passed`)
  })

  it('in Russian', () => {
    const text = retentionSection('content-ru.tsx')
    expect(text).toContain(`их копия ещё ${GRACE_DAYS} день хранится`)
    expect(text).toContain(`По истечении ${GRACE_DAYS} дня`)
  })

  it('in Armenian (the owner\'s own translation, 2026-09-14)', () => {
    const text = retentionSection('content-hy.tsx')
    expect(text).toContain(`դրանց պատճենը ${GRACE_DAYS} օր պահվում է`)
    expect(text).toContain(`Երբ ${GRACE_DAYS} օրը լրանա`)
  })
})

// WHAT THE POLICY MAY PROMISE ABOUT ERASING, AND WHAT IT MUST ADMIT.
//
// "Erased within the following day" was not something the code could keep: a deletion the queue missed
// is recorded by the daily walk up to a day later, and the prune sweeps every six hours (lib/server/
// media-backup). And a photo deleted before its copy was made -- seconds after upload, or during the first
// backfill -- has nothing to restore. The owner approved the corrected wording on 2026-09-14. A policy
// that promises more than the code does is the one kind of text this product must not ship.
describe('the privacy policy promises only what the backup can keep', () => {
  it('in English: erased normally within a day, and a photo with no copy cannot be recovered', () => {
    const text = retentionSection('content-en.tsx')
    expect(text).toContain('erased, normally within a day')
    expect(text).toContain('A photo deleted before its backup copy was made')
    expect(text).not.toContain('within the following day')
  })

  it('in Russian: the same two corrections', () => {
    const text = retentionSection('content-ru.tsx')
    expect(text).toContain('стирается, как правило, в течение суток')
    expect(text).toContain('раньше, чем была сделана её резервная копия')
    expect(text).not.toContain('в течение следующих суток')
  })

  it('in Armenian: the same two corrections, in the owner\'s words', () => {
    const text = retentionSection('content-hy.tsx')
    expect(text).toContain('սովորաբար մեկ օրվա ընթացքում ջնջվում է')
    expect(text).toContain('մինչև դրա պահուստային պատճենի ստեղծումը')
    expect(text).not.toContain('հաջորդ օրվա ընթացքում')
  })
})
