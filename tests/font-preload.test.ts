import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE ROOT LAYOUT PRELOADS ONLY WHAT AN ENGLISH FIRST PAINT USES.
//
// Next preloads every listed subset of every font a root layout declares, on EVERY route, because
// preload defaults to true (node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md).
// The review of 2026-09-14 measured 8 font files preloaded on every page, 235,692 bytes, 129,056 of
// them Armenian and Cyrillic an English visitor never renders. A preload is a download the browser
// starts ahead of the page's own work, whether or not a single glyph ever appears.
//
// Not preloading the rest costs nothing in correctness: next/font self-hosts every @font-face in
// Google's CSS (its loader filters nothing by subset; `subsets` only marks which files get a preload
// tag), each behind its unicode-range, so a Russian or Armenian page still fetches the faces it renders.
// This reads the layout as text because a font call runs at build time, not in a test.

const layout = () => stripJsComments(readFileSync(join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8'))

type FontCall = { name: string; body: string }

function fontCalls(text: string): FontCall[] {
  const imported = /import \{([^}]+)\} from "next\/font\/google"/.exec(text)
  expect(imported, 'the root layout must load its fonts through next/font/google').not.toBeNull()
  const names = imported![1].split(',').map((s) => s.trim()).filter(Boolean)
  return names.map((name) => {
    const call = new RegExp(`= ${name}\\(\\{([\\s\\S]*?)\\}\\);`).exec(text)
    expect(call, `${name} is imported but never called`).not.toBeNull()
    return { name, body: call![1] }
  })
}

const subsetsOf = (c: FontCall) => {
  const m = /subsets:\s*\[([^\]]*)\]/.exec(c.body)
  return m ? m[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean) : []
}
// next/font's own rule, not a guess at it: preload defaults to true, and the loader preloads the files of
// the LISTED subsets (`preload ? subsets : undefined`). A family Google lists no subset for -- the
// handwriting face -- has preload switched off by the validator and cannot even be given the option.
const preloads = (c: FontCall) => !/preload:\s*false/.test(c.body) && subsetsOf(c).length > 0

describe('the root layout preloads Latin, and only for the first paint', () => {
  it('found the font calls it is about (a scan that finds nothing proves nothing)', () => {
    expect(fontCalls(layout()).length).toBeGreaterThanOrEqual(6)
  })

  it('exactly two faces are preloaded: the body text and the headings', () => {
    expect(fontCalls(layout()).filter(preloads).map((c) => c.name).sort()).toEqual(['Geist', 'Playfair_Display'])
  })

  it('and each of them preloads the Latin subset and nothing else', () => {
    for (const c of fontCalls(layout()).filter(preloads)) {
      expect(subsetsOf(c), `${c.name} preloads ${subsetsOf(c).join(', ')} for every visitor`).toEqual(['latin'])
    }
  })

  it('the Armenian faces are still declared, and download only on a page that renders Armenian', () => {
    const calls = fontCalls(layout())
    for (const name of ['Noto_Serif_Armenian', 'Noto_Sans_Armenian']) {
      const c = calls.find((x) => x.name === name)
      expect(c, `${name} must stay declared -- Armenian pages render in it`).toBeDefined()
      expect(preloads(c!), `${name} is preloaded for every visitor`).toBe(false)
    }
  })

  it('every declared face is still applied to the page, so not preloading never means not loading', () => {
    const text = layout()
    const vars = [...text.matchAll(/const (\w+) = \w+\(\{/g)].map((m) => m[1])
    expect(vars.length).toBeGreaterThanOrEqual(6)
    for (const v of vars) expect(text, `${v}.variable is not on <html>`).toContain(`\${${v}.variable}`)
  })
})
