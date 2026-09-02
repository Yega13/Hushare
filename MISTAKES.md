# Mistakes

Written at the end of every check-protocol circle (AGENTS.md rule 27). **Read this before making a
change, not after.** If the same entry appears twice, the loop is not working.

Each entry: what I did, what it cost, and the rule that would have prevented it.

---

## 2026-09-02 — Circle 1 (security audit + upload/video work)

### 1. I reported a fixed bug as still broken, from two-day-old logs

Told the user the Polar intro discount was "still unfixed on your side" and that customers were
being charged full price. The evidence was error rows from **Aug 30–31**. It was **Sep 2**. They had
already fixed it — their own screenshot showed a live checkout at $1.99. I then escalated the wrong
claim into a whole instruction block telling them to *create discounts that already existed*.

**Cost:** the user's trust, and the first "I'll cancel my plan" message.
**Rule:** 20 — never state a negative you cannot back up. An error log is a record of the PAST.
"No errors since X" is a fact; "still broken" is a claim about NOW and needs a check against NOW.
**Habit to build:** before reporting any live problem, query the current state. Last-seen timestamp
vs. today's date, every time.

### 2. I called a token "expired" because a 401 body listed "expired" among four possibilities

Polar returns `"expired, revoked, malformed, or invalid for other reasons"`. I picked the first
word. The token never expires — the dashboard says so — and the real cause was a stale value in my
local `.env.local` after the user rotated it. Production was never affected, which I also failed to
say clearly enough up front.

**Cost:** a second false alarm in the same message as the first.
**Rule:** 18 — verify against reality, not against a plausible-sounding word. When an error lists
several causes, it has told you it does not know; do not pick one and present it as the diagnosis.

### 3. I wrote a pricing limit from the code without checking it against the agreed design

Put "2 min per clip" on the pricing page for Pro. The code said 120s, so I believed it. The agreed
design (saved in my own memory, from the user's own words) said Pro was **1 min**, and 2 min
belonged to the **$49 package**. The code had been wrong the whole time and I was about to publish
its error to customers, in three languages.

**Cost:** the "LAST CHANCE" message.
**Rule:** 13/18 — the code is not automatically the source of truth. When a number is a DECISION,
the decision is the source and the code is a copy that can be wrong. Check the agreement first,
then make the code match it — never the reverse.
**Also:** I had the memory file. I paraphrased it from recall instead of opening it.

### 4. Two wrong theories about the upload stall, stated before I had the data

Blamed (a) the owner-vs-guest image path and (b) the phone suspending the tab. The user was on
mobile, uploading as a guest, and did not lock the screen. Only after that did I pull the real
numbers, which showed 55 photos in 2m42s, then **one 28.8-minute stall**, then 23 more in 49s.

**Cost:** two rounds of the user correcting me instead of me diagnosing.
**Rule:** 12c — diagnose from evidence first. The gap analysis took one query and would have killed
both theories before I said either of them out loud.
**Still open:** that stall is unexplained and it is ours. Suspension is ruled out by the user.

### 5. I did the mutation testing myself and called it verification

Ran rule-16 mutations on my own changes and reported them as proof. Rule 16 requires the mutation;
it does not make me the reviewer. The user's correction: agents break the change, my own run is
homework, not verification.

**Cost:** the protocol now written as rule 27, which should have existed already.
**Rule:** 10 and now 27 — I am the worst possible reviewer of my own reasoning.

### 6. I let an agent mutate source files in the working tree I was editing

The regression reviewer applied and restored mutations in the same files I had open. I caught a
`if (false)` on the discount-codes guard mid-flight and had to diff the whole tree afterwards to
prove nothing was left behind. Nothing was — but a leftover mutation there would have silently
reopened a money hole.

**Rule:** new. An agent doing mutation testing needs its own copy of the tree, or I stop editing
while it runs. Two writers in one working tree is a corruption waiting to happen.

### 7. I added a `src/lib` module with no test

`error-alert-grouping.ts`. The architecture test caught it, which is the system working — but it
should not have needed to.

**Rule:** 14 — a new module in `src/lib` arrives WITH its test, in the same edit.

### 8. I said an agent was running, twice, without checking — it had been killed

Launched a breaking agent, the user interrupted that turn, and the interrupt killed it. I then
reported "the breaking agent is still running" in two separate messages and planned around it. The
user asked "you sure they're running?" — `ListAgents` returned an empty subagent list.

**Cost:** a third false statement about current state in one session, and it was the user who
caught it, not me.
**Rule:** 20, and it is the SAME failure as entry 1 in this file — the discount. Both times I
described a live state from memory of having started something, rather than from a check. Starting
a thing is not evidence that it is still running.
**Habit to build:** `ListAgents` before every sentence that claims an agent is working. An
interrupt kills in-flight agents; a turn boundary is exactly where that happens.

**Also fixed here:** agents now run with `isolation: "worktree"` so they get their own copy of the
repo (entry 6). That requires the work to be COMMITTED first — a worktree is built from a commit,
so uncommitted changes are invisible to it. Committing locally is safe: the deploy workflow runs on
push, not on commit.

### 9. `git worktree remove --force` wiped the main repo's node_modules

Cleaned up three finished agent worktrees with `git worktree remove --force`. On Windows the
worktrees' `node_modules` are junctions to the main checkout's, and the removal followed them:
`node_modules` went to **zero entries**, and vitest could not even load its own config.

No source was lost — HEAD was still `bd89e7b` and only MISTAKES.md was dirty — because
`node_modules` is gitignored and regenerable. `npm ci` restored it and the suite went straight back
to 901/901. But for a few minutes the toolchain was gone and I could not run a single test.

**Rule:** the AGENTS.md advice that a worktree is "auto-cleaned if unchanged" does not mean cleaning
one by hand is free. Two habits:
1. Let finished worktrees be cleaned automatically, or remove them WITHOUT `--force` and stop if git
   objects.
2. Only isolate agents that WRITE. A read-only planning or review agent that runs no mutations can
   share the tree safely, and then there is nothing to tear down.

**What made it recoverable:** everything that mattered was committed. The cost of the whole incident
was one `npm ci`, precisely because the work was in git rather than only in the working tree.
