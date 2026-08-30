# Architecture work

**This branch never deploys.** `.github/workflows/deploy.yml` runs only on `main` and `master`, so
nothing here reaches hushare.space until someone deliberately merges it. Production keeps running
the code on `master`, untouched, for as long as this takes.

There is no separate database — the Supabase free plan is at its project limit — so this branch
shares production's data and **must not be pointed at destructive work**. That is a real constraint,
not a temporary one, and it shapes what can be done here: refactoring and tests, yes; migrations and
mass-deletion experiments, no.

## What is actually wrong

Measured 2026-08-30:

| Area | Lines | Tests that run it |
|---|---|---|
| `src/lib` | 6,616 | 139 |
| `src/components` | 18,914 | 7 |
| `src/app/api` | 9,117 | ~1 |

Every defect two adversarial reviews found this week was in a component or a route handler. Not one
was in `lib`. That is not luck — it is the untested surface, and it is where the four biggest files
live:

- `UploadZone.tsx` — 2,846 lines
- `OwnerToolbar.tsx` — 1,771
- `AlbumPageClient.tsx` — 1,424
- `PhotoGrid.tsx` — 843

The symptoms the owner reports — the account link flickering, a password prompt appearing on the
owner's own album — are all the same shape: a decision made from several pieces of state, expressed
inline in a component too large to test, where being briefly wrong is invisible to everyone except
the person it happens to.

## The method

One that has worked four times this week, each in under an hour, each finding something real:

1. Take ONE decision out of a large component and into `src/lib` as a pure function.
2. Test it — including the boundaries, and both directions of failure.
3. **Break it on purpose.** If the tests still pass, the tests are worthless. This step has caught a
   weak test every single time it has been run, including tests written minutes earlier.
4. Only then move on.

Done so far, on `master`: `collectDeletionTargets` (which files an album deletion destroys),
`upload-policy` (whether a photo is re-encoded, how a retry backs off), `bib-match` (the phone and
the database agreeing), `owner-view` (whether the owner sees their own album's gate).

## Rules for this branch

- **Nothing merges to `master` without the owner saying so.** Not a fix, not a test, not a comment.
- Behaviour does not change. These are extractions: the same code, made reachable. Where behaviour
  must change, that is a separate, named decision — not a side effect of a refactor.
- Every extraction gets the mutation step. A test that survives its subject being broken is worse
  than no test, because it is believed.
