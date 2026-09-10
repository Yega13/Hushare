import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE MODULES ARE PROVEN. THIS PINS THE LINES IN UploadZone THAT DECIDE WHETHER THEY RUN.
// Same rule as album-page-wiring: names are pinned, because every wrong name is "derived".

const SOURCE = join(process.cwd(), 'src', 'components', 'UploadZone.tsx')
const src = () => stripJsComments(readFileSync(SOURCE, 'utf8'))

describe('UploadZone classifies failures through lib/upload/failure and defines none of its own', () => {
  it('imports the classifiers and the error class from the module', () => {
    const text = src()
    for (const name of ['VideoUploadError', 'friendlyUploadError', 'isDeterministicTusError', 'isRecoverableNetworkFailure', 'tusHttpStatus']) {
      expect(text, name).toMatch(new RegExp(String.raw`import \{[^}]*\b` + name + String.raw`\b[^}]*\} from '@/lib/upload/failure'`, 's'))
    }
  })
  it('keeps no local definition of any of them (a second copy is where they drift apart)', () => {
    const text = src()
    expect(text).not.toMatch(/class VideoUploadError|function friendlyUploadError|function isDeterministicTusError|function isRecoverableNetworkFailure|function tusHttpStatus|function errText/)
    expect(text).not.toMatch(/failed to fetch\|/)
  })
  it('the park decision is the module\'s verdict on the real error, with nothing hard-wired', () => {
    expect(src()).toMatch(/const parked = isRecoverableNetworkFailure\(e\) && !entry\.autoResumed/)
  })
})
