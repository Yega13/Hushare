// Preflight for production builds. Fails fast on env values that are correct locally and wrong
// once shipped.
//
// NEXT_PUBLIC_* is INLINED INTO THE BUNDLE at build time, so whatever .env.local says at the moment
// you run the build is what the deployed site believes about itself — forever, until the next
// build. With the dev URL in .env.local, production shipped http://localhost:3000 as its own
// address: rel="canonical" and og:url on every page, the sitemap advertised in robots.txt, all 11
// sitemap entries, and the emailed magic-link redirect. Nothing crashed. Google was simply told the
// real pages live on a machine it cannot reach, and the only way to notice was to read the HTML.
//
// The correct value lives in .env.local; .env.development.local keeps localhost for `next dev`,
// because Next reads .env.$(NODE_ENV).local ahead of .env.local. This check exists so a fresh
// clone, a new machine, or a CI runner cannot quietly reintroduce it.
import fs from 'node:fs'

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {}
  return Object.fromEntries(
    fs.readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
}

// Same precedence Next applies for a production build: process.env wins, then .env.production.local,
// then .env.local.
const env = {
  ...readEnvFile('.env.local'),
  ...readEnvFile('.env.production.local'),
  ...process.env,
}

const problems = []
const siteUrl = env.NEXT_PUBLIC_SITE_URL
if (!siteUrl) {
  problems.push('NEXT_PUBLIC_SITE_URL is not set. The build would fall back to a default that may not match this deployment.')
} else if (/localhost|127\.0\.0\.1|^http:\/\//i.test(siteUrl)) {
  problems.push(`NEXT_PUBLIC_SITE_URL is "${siteUrl}". A production build inlines this as the site's own address, so canonical links, og:url, robots.txt, sitemap.xml and the emailed sign-in link would all point there. Put the real https:// origin in .env.local and keep localhost in .env.development.local.`)
}

if (problems.length > 0) {
  console.error('\n[check-build-env] Refusing to build:\n')
  for (const p of problems) console.error('  - ' + p + '\n')
  process.exit(1)
}
console.log(`[check-build-env] NEXT_PUBLIC_SITE_URL = ${siteUrl} ✓`)
