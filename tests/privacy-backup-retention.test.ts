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
})
