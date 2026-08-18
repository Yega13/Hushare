import fs from 'fs'
const s = fs.readFileSync('src/app/privacy/content-en.tsx','utf8')
const parts = s.split(/\n  \{\n    id: /).slice(1)
console.log('sections found:', parts.length)
let i = 0
for (const p of parts) {
  i++
  if (i > 8) break
  const id = p.match(/^'([^']+)'/)?.[1]
  const heading = p.match(/heading: '((?:[^'\]|\.)*)'/)?.[1]
  const txt = p
    .replace(/\{'\s*'\}/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/&apos;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&middot;/g,'·')
    .replace(/\s+/g, ' ').trim()
  console.log('\n### ' + i + ' [' + id + '] ' + heading)
  console.log(txt.slice(0, 2600))
}
