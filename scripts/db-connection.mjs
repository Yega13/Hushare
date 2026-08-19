// Where the database password comes from, for db:migrate and db:check.
//
// Both scripts had their own copy of this, which is the arrangement that quietly drifts: change the
// lookup in one and the other keeps working until the day it doesn't. One copy, imported twice.
//
// The password used to be read from "Supabase Password.txt" in the PROJECT ROOT, alongside the AWS
// key, the Cloudflare Stream token and the Rekognition access keys. Git ignored them, so they were
// never committed — but they still sat in the folder that gets opened in an editor, shared on a
// call, synced to a backup, and swept up by `git add -f` or a stray archive. Ignored is not the same
// as absent. They now live outside the repository entirely, in ~/.hushare-secrets/, where nothing
// about the project can reach them by accident.

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Non-secret connection coordinates (project ref + pooler host). Only the password is secret.
const POOLER_HOST = 'aws-1-ap-southeast-2.pooler.supabase.com'
const DB_USER = 'postgres.yqngmyjquwemwogdyuwv'

export const SECRETS_DIR = join(homedir(), '.hushare-secrets')
const PASSWORD_FILE = join(SECRETS_DIR, 'Supabase Password.txt')

export function connectionString(label) {
  // Env var wins, so CI never needs a file on disk at all.
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL

  if (existsSync(PASSWORD_FILE)) {
    const pw = encodeURIComponent(readFileSync(PASSWORD_FILE, 'utf8').trim())
    return `postgresql://${DB_USER}:${pw}@${POOLER_HOST}:5432/postgres`
  }

  // Name both ways out, and the exact path — a script that just says "aborting" sends you reading
  // its source to find out what it wanted.
  console.error(
    `[${label}] No database password found.\n` +
    `  Set SUPABASE_DB_URL, or put the password in:\n` +
    `    ${PASSWORD_FILE}\n` +
    `  (Secrets deliberately live outside the repository — see scripts/db-connection.mjs.)`,
  )
  process.exit(1)
}
