// Drive real Chrome and photograph an animation, frame by frame.
//
// Written because "it still glitches" and "it has a ghost self" are the best a person can do from
// the other side of a screen, and I kept guessing at what they meant — three wrong fixes on one
// transition. This looks instead.
//
// It slows a named animation down (screenshots take ~200ms, far slower than a 280ms transition),
// clicks something, and writes JPEG frames that can be opened and inspected.
//
// USAGE
//   node scripts/capture-frames.mjs --url https://hushare.space/SLUG --click "[data-photo-id]" \
//        --slow "::view-transition-group(hush-photo-morph),::view-transition-new(hush-photo-morph)"
//
// Chrome must already be listening:
//   "C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
//     --remote-debugging-port=9222 --disable-gpu --user-data-dir=C:/tmp/vtcheck/profile about:blank
//
// Frames land in --out (default C:/tmp/vtcheck). Keep the viewport under 2000px in either
// direction — larger images cannot be read back.

import fs from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const url = arg('url')
const click = arg('click')
const slow = arg('slow')
const out = arg('out', 'C:/tmp/vtcheck')
const slowMs = Number(arg('slowMs', '3000'))
const waitMs = Number(arg('wait', '9000'))
if (!url) { console.error('need --url'); process.exit(1) }

const base = `http://127.0.0.1:${arg('port', '9222')}`
const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find(t => t.type === 'page')
if (!page) { console.error('no page target — is Chrome running with --remote-debugging-port?'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

await send('Page.enable')
await send('Runtime.enable')
// Deliberately under 2000px: a frame larger than that cannot be read back for inspection, which
// defeats the entire point of capturing it.
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(arg('width', '1200')), height: Number(arg('height', '850')),
  deviceScaleFactor: 1, mobile: arg('mobile') === 'true',
})
await send('Page.navigate', { url })
await new Promise(r => setTimeout(r, waitMs))

if (slow) {
  // Slow ONLY the named selectors. Slowing everything (including ::view-transition-*(root)) makes
  // the whole page appear to dissolve and hides the thing being examined behind a bigger effect.
  await send('Runtime.evaluate', { expression: `
    const s = document.createElement('style')
    s.textContent = ${JSON.stringify(`${slow} { animation-duration: ${slowMs}ms !important; }`)}
    document.head.appendChild(s)
  ` })
}

fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(out)) if (f.endsWith('.jpg')) fs.unlinkSync(`${out}/${f}`)

if (click) await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(click)})?.click()` })

const t0 = Date.now()
let n = 0
while (Date.now() - t0 < slowMs + 300) {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 })
  if (shot.result?.data) {
    fs.writeFileSync(`${out}/f${String(n).padStart(2, '0')}_${Date.now() - t0}ms.jpg`, Buffer.from(shot.result.data, 'base64'))
    n++
  }
}
console.log(`captured ${n} frames to ${out}`)
ws.close()
