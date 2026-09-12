import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'
import {
  MAX_FILE_NAME_LEN, fileNameValid, contentTypeValid, fileSizeValid, unusableUpload,
} from '@/lib/upload/presign-fields'
// The classifiers themselves, imported rather than copied: this module's whole purpose is that the
// error it causes to be thrown is RECOGNISED, and a copied regex stays green while the real one
// drifts (rule 17).
import { readFailure, isFileReadFailure } from '@/lib/file-read'
import { friendlyUploadError, isRecoverableNetworkFailure, READ_FAILURE_MESSAGE } from '@/lib/upload/failure'

describe('the rules an upload door enforces', () => {
  it('a file name must be present and at most 255 characters', () => {
    expect(fileNameValid('IMG_2741.jpeg')).toBe(true)
    expect(fileNameValid('a'.repeat(MAX_FILE_NAME_LEN))).toBe(true)
    expect(fileNameValid('a'.repeat(MAX_FILE_NAME_LEN + 1))).toBe(false)
    expect(fileNameValid('')).toBe(false)
    expect(fileNameValid(undefined)).toBe(false)
    expect(fileNameValid(null)).toBe(false)
    expect(fileNameValid(12)).toBe(false)
  })

  it('a content type must be present -- whether we ACCEPT it is a different question (lib/media)', () => {
    expect(contentTypeValid('image/jpeg')).toBe(true)
    // Not this module's business: the door asks lib/media whether the type is allowed. An empty
    // string is the case here, and on iOS it is a real one.
    expect(contentTypeValid('application/x-not-a-real-type')).toBe(true)
    expect(contentTypeValid('')).toBe(false)
    expect(contentTypeValid(undefined)).toBe(false)
    expect(contentTypeValid(null)).toBe(false)
  })

  it('a size must be a positive whole number of bytes', () => {
    expect(fileSizeValid(1)).toBe(true)
    expect(fileSizeValid(9_000_000)).toBe(true)
    // The one that actually happened.
    expect(fileSizeValid(0), 'a zero-byte file is not a valid declaration').toBe(false)
    expect(fileSizeValid(-1)).toBe(false)
    expect(fileSizeValid(1.5)).toBe(false)
    expect(fileSizeValid(NaN)).toBe(false)
    expect(fileSizeValid(Infinity)).toBe(false)
    expect(fileSizeValid('9000')).toBe(false)
    expect(fileSizeValid(undefined)).toBe(false)
  })
})

describe('unusableUpload -- asked before any bytes move', () => {
  const ok = { size: 2_400_000, name: 'IMG_2741.jpeg', mimeType: 'image/jpeg' }

  it('says nothing about a file that can be uploaded', () => {
    expect(unusableUpload(ok)).toBeNull()
  })

  it('names the empty blob -- error_events 1226, an iPhone whose photo was never materialised', () => {
    // processImage's last resort hands back the original File untouched. When the device never
    // produced the bytes, that File has size 0, and presign answers "Missing or invalid fields"
    // about somebody's photograph.
    expect(unusableUpload({ ...ok, size: 0 })).toBe('empty')
  })

  it('names a missing file name and a missing type', () => {
    expect(unusableUpload({ ...ok, name: '' })).toBe('name')
    expect(unusableUpload({ ...ok, name: 'x'.repeat(300) })).toBe('name')
    expect(unusableUpload({ ...ok, mimeType: '' })).toBe('type')
  })

  it('reports the EMPTY blob first when more than one rule is broken', () => {
    // Not cosmetic: 'empty' is the one that means the device would not hand the file over, and it
    // is the one the recovery is built for. Reporting 'name' instead would send the guest looking
    // at a filename they cannot change.
    expect(unusableUpload({ size: 0, name: '', mimeType: '' })).toBe('empty')
  })
})

describe('THE DOORS IMPORT THESE RULES RATHER THAN KEEPING THEIR OWN COPY (rule 13)', () => {
  // Written because the first version of this module CLAIMED the deduplication in a comment while
  // all three routes still carried hand-written copies -- a review found it by changing
  // MAX_FILE_NAME_LEN to 280 and watching every test stay green while the client waved through
  // names all three doors refuse. A claim about where a rule lives is worth nothing without a test
  // that fails when a second copy appears.
  const read = (rel: string) => stripJsComments(readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8'))
  const DOORS = [
    'app/api/upload/presign/route.ts',
    'app/api/upload/stream/route.ts',
    'app/api/upload/image-relay/route.ts',
  ]

  it('every door imports the predicates from this module', () => {
    for (const door of DOORS) {
      expect(read(door), door).toMatch(/from '@\/lib\/upload\/presign-fields'/)
    }
  })

  it('and none of them retypes the name ceiling or the size rule', () => {
    for (const door of DOORS) {
      const text = read(door)
      expect(text, `${door} retypes the 255 ceiling`).not.toMatch(/length > 255/)
      // image-relay deliberately does not enforce a size rule at all (a missing Content-Length is
      // not a reason to refuse somebody's photo on the last-resort path), so this asserts the
      // absence of a COPY, which is true of all three either way.
      expect(text, `${door} retypes the size rule`).not.toMatch(/Number\.isInteger/)
    }
  })
})

describe('the refusal it produces is one the uploader already understands', () => {
  // THE POINT OF THE WHOLE CHANGE. A guard that throws words nothing recognises would swap one
  // meaningless sentence for another, so the wiring is pinned here rather than assumed.
  const err = readFailure('empty')

  it('is classified as the DEVICE failing, not the network', () => {
    expect(isFileReadFailure(err)).toBe(true)
  })

  it('parks the file, so a photo that becomes readable a moment later is still saved', () => {
    expect(isRecoverableNetworkFailure(err)).toBe(true)
  })

  it('shows the guest the sentence the product already owns for this', () => {
    expect(friendlyUploadError(err)).toBe(READ_FAILURE_MESSAGE)
    expect(READ_FAILURE_MESSAGE).toContain('Could not read this file from your device')
  })

  it('carries the reason for /admin without scattering the grouping', () => {
    // One message shape per cause, with the detail in parentheses -- /admin groups by exact string.
    expect(err.message).toBe('Could not be read from this device (empty)')
  })
})
