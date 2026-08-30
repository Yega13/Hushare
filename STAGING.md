# Staging

A second, complete copy of Hushare: its own database, its own bucket, its own domain. It exists so
a change can be broken on purpose — a migration replayed, an album mass-deleted, a load test run at
5,000 photos — without any of it reaching a customer.

Nothing here is shared with production except the source code.

| | production | staging |
|---|---|---|
| Worker | `hushare` | `hushare-staging` |
| Domain | hushare.space | staging.hushare.space |
| Database | its own Supabase project | **a different** Supabase project |
| Bucket | `hushare-media` | `hushare-media-staging` |
| Deploys on | push to `master` | push to `staging`, or by hand |
| Data | real customers | synthetic, shaped like production |

## Why staging does not hold a copy of production's data

"Copy the database" is the obvious way to build this and the wrong one. Production rows carry real
email addresses, real album password hashes, and real owner tokens — and an owner token **is** the
credential, so a copied row is a working key to a stranger's album. Copying them doubles the number
of places a breach can happen, in a project whose repository is public.

It also buys nothing. Architecture work needs the *shape* of the data — how many albums, how many
photos each, which features are on — and none of that requires one real person's details. The
seeder reproduces the shape measured from production on 2026-08-30: 95 albums, ~13,700 photos,
average 212 each, largest 1,378, plus the case production has not hit yet and the next event will —
a 5,000-photo race album with bib search on.

If a specific customer bug ever needs their real data to reproduce, copy **that one album**,
deliberately, and delete it afterwards. Not the database.

## What only you can do

Three things need your Cloudflare and Supabase accounts:

1. **Create a Supabase project** (free tier is enough — staging holds no files). Then note its URL,
   anon key, service-role key, and pooler connection string.
2. **Create an R2 bucket** named `hushare-media-staging`, and point `media-staging.hushare.space`
   at it. Add a DNS record for `staging.hushare.space` on the `hushare.space` zone.
3. **Set the repository secrets** used by `.github/workflows/deploy-staging.yml`:
   `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_DB_URL`.

Then fill in the two placeholder values in `wrangler.toml` under `[env.staging.vars]`, and set the
staging secrets — each one separately from production's:

```
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put ALBUM_PASSWORD_PEPPER --env staging
...and so on for every secret listed at the top of wrangler.toml
```

A staging deploy holding **production's service-role key** can read and delete every real album no
matter which URL it points at. The keys must be different.

## Then

```
$env:STAGING_DB_URL="postgresql://postgres.<staging-ref>:<password>@<host>:5432/postgres"
node scripts/staging-setup.mjs schema     # create the tables
node scripts/staging-setup.mjs seed       # fill it with a realistic dataset
node scripts/staging-setup.mjs reset      # wipe and re-seed, any time
npx wrangler deploy --env staging
```

## The guard rails

Staging pointed at production is the most dangerous object in the system: it is where destructive
work happens deliberately, and wired to production it does that work to real albums — silently,
because a staging deploy holding production's URL does not error, it just works.

Three separate things prevent it, because one is not enough:

- **`wrangler.toml`** — Wrangler environments do not inherit bindings, so every binding is
  redeclared under `[env.staging]`. There is no way to add one at the top of the file and have
  staging pick it up by accident.
- **`src/lib/server/environment.ts`** — the worker refuses to open a privileged database client if
  `HUSHARE_ENV=staging` and any production resource is reachable. Asserted in
  `tests/environment-isolation.test.ts`, in both directions: it must fire for staging, and it must
  never fire for production, because it sits on the hot path of every privileged call.
- **`scripts/staging-setup.mjs`** — refuses to run against production's project ref, before it
  opens a connection, on every command.
