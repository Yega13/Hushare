# Hushare

Shared photo albums for events. A host creates an album, guests scan a QR code and upload photos
and video from their phones — no app, no account required to contribute.

Live at [hushare.space](https://hushare.space).

## Stack

| Piece | What it is |
| --- | --- |
| Next.js 16 (App Router) + React 19 | The app |
| Cloudflare Workers, via OpenNext | Where it runs |
| Supabase (Postgres + Auth) | Albums, photos, subscriptions, sessions |
| Cloudflare R2 | Photo storage |
| Cloudflare Stream | Video storage and playback |
| Polar | Subscriptions and checkout |
| AWS Rekognition | Face search and race-number (bib) reading, Studio tier |
| Cloudflare Workers AI | The on-site support chat |

Read `AGENTS.md` before changing anything. It carries the project rules.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.development.local` holds the local overrides (notably `NEXT_PUBLIC_SITE_URL=http://localhost:3000`);
`.env.local` holds the real values. Next reads `.env.$(NODE_ENV).local` first, which is what keeps
localhost out of production builds.

## Deploying

**Not Vercel.** This deploys to Cloudflare Workers.

```bash
npm run deploy       # check env → clean → patch → OpenNext build → wrangler deploy
```

`npm run preview` runs the same build locally under `wrangler dev`.

The build refuses to run if `NEXT_PUBLIC_SITE_URL` looks like localhost. That value is baked into
the bundle, so a wrong one ships canonical links, `og:url`, `robots.txt` and sign-in emails all
pointing at a machine nobody can reach — see `scripts/check-build-env.mjs`.

Rolling back is a Cloudflare operation, not a git one:

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

**Avoid deploying while an event is running.** Every deploy renames the JavaScript chunks, so any
tab already open asks for files that no longer exist. The app detects this and reloads itself once,
but guests see a flash of "Something went wrong" first.

## Database

Every schema change goes in a migration file. Never hand-edit the database.

```bash
npm run db:migrate   # apply pending migrations from supabase/migrations/
npm run db:check     # assert the live schema has what the code needs
```

`db:check` is the drift guard — run it after merging and before an event. `schema.sql` in the repo
root is an old snapshot and has fallen well behind the migrations; it cannot recreate the database.
Treat `supabase/migrations/` as the source of truth.

## Secrets

Runtime secrets live on the Worker, set with `wrangler secret put <NAME>`. The full list is in the
comments at the bottom of `wrangler.toml` — keep it current, since an unset secret usually fails
silently rather than loudly.

Local credential files live in `~/.hushare-secrets/`, deliberately outside this repository. The
database scripts read the password from there (`scripts/db-connection.mjs`), or from
`SUPABASE_DB_URL` if it is set.

## Checks

```bash
npx tsc --noEmit     # types
npm run lint         # eslint over src/ (build output is ignored)
```
