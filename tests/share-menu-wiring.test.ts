import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE TABLE-CARD PDF DOWNLOAD, WHICH FAILED WITHOUT A WORD.
//
// ShareMenu loads jspdf only when the owner asks for a PDF. That chunk is not part of the toolbar's
// chunk group, so on a device that will not fetch it -- the unexplained failure behind 26 album-page
// rows -- the import rejects. The handler had try/finally and no catch: the rejection went unhandled,
// reached report-error in chunk words, and reloaded the owner's page; once that reload was spent,
// the button simply went back to "Download" and nothing was shown.
//
// The decision (report in which words, whether to spend the reload) is lib/optional-load's
// failOptionalPart, tested there. This pins that the handler hands the failure to it, and tells the
// owner when the page is not about to reload.

const src = () =>
  stripJsComments(readFileSync(join(process.cwd(), 'src', 'components', 'owner-toolbar', 'ShareMenu.tsx'), 'utf8'))
    .split(String.fromCharCode(13)).join('')

describe('ShareMenu table-card download', () => {
  it('catches a failed download, reports it as the table card, and tells the owner unless the page reloads', () => {
    expect(src()).toMatch(
      /\} catch \(error\) \{\s*if \(!failOptionalPart\('table-card', error\)\) showAppToast\(t\('common\.errorGeneric'\), 'error'\)\s*\} finally \{ setDownloading\(false\) \}/,
    )
  })

  it('imports both from where they are decided', () => {
    const text = src()
    expect(text).toMatch(/import \{ failOptionalPart \} from '@\/lib\/optional-load'/)
    expect(text).toMatch(/import \{ showAppToast \} from '@\/components\/AppToast'/)
  })
})
