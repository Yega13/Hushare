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

## 2026-09-02 — Circle 2

### 10. THE SAME RULE-15 MISTAKE, A THIRD AND FOURTH TIME

This is the entry that matters. Three separate times now I have fixed a DECISION, put it in a
tested module, written a commit message about rule 15 — and left the ENFORCEMENT one layer away
where nothing can see it.

1. **The tus ordering.** `isMissingContentLengthFailure` was correct and tested; the loop asked
   "is this fatal?" first, so it never ran. Dead for three commits.
2. **The video budget.** The pure functions scored 12/12; five mutations to the route survived all
   901 tests, including deleting the budget entirely.
3. **The reservation, at the CALL SITE.** I moved `resolveMaxDurationSeconds` into the module and
   returned it so a test could pin it — and then `createStreamUpload(fileSize, safeName, 60)` in
   the route passed all 937 tests. I fixed the exact defect inside the module and recreated it one
   line further down, in the same commit, while writing about having fixed it.
4. **The whole authorization call.** `const auth = { ok: true }` in the route — gate, rate limit,
   size cap, budget all gone — passes everything. And moving the `gate-direction` entry to the
   module is what left the route uncovered.

**The pattern, stated so I stop rediscovering it:** extracting logic into `src/lib` moves the thing
I can test and leaves behind the thing that decides whether it runs. A test of the module proves
the module. It proves nothing about the two lines that call it, and those two lines are where the
customer's video actually lives or dies.

**Habit to build:** after extracting anything, mutate the CALL SITE, not the module. If stubbing
the call passes the suite, the extraction made the code more testable and no better tested.

### 11. I put a security claim in a commit title without testing it as an attacker

Titled a commit "one request can no longer silence it" after capping `context.repeats` at 1000. The
alert threshold is 8. The cap sits 125x above the bar it was meant to enforce, so `{"repeats":8}`
still fires the alert and burns the 60-minute cooldown — and 8 posts with 8 distinct messages do it
with nothing the cap touches at all.

**Cost:** a false security claim in the permanent record, which is worse than no claim: the next
person greps the log, sees it handled, and moves on.
**Rule:** 20. A cap is not a defence until the number has been compared against the threshold it is
defending. Before writing "X can no longer happen", do X.

### 12. A comment that says try/catch fixes a hang

Wrote that wrapping the enrichment in try/catch fixes the hour-long silence caused by an unbounded
wait. `try/catch` catches a throw; it does nothing about a hang. There are no timeouts on those
calls, and the repo already uses `AbortSignal.timeout` in eight places.

**This is the third comment in one session asserting something the code does not do** — after the
"self-corrects" reconcile claim and the "a test holds these cron strings" claim. Two of the three I
caught myself; this one an agent caught. By the user's own standard for this file, a repeated entry
means the loop is not working on that pattern yet.

**Habit to build:** a comment claiming a failure is handled must name the mechanism, and the
mechanism must be re-read at the moment of writing. "Wrapped in try/catch" answers "what if it
throws", never "what if it never returns".

### 13. Two process hazards, from the agents rather than from me

- **CRLF broke a mutation harness.** These files are CRLF on disk; every multi-line pattern written
  with bare `\n` matched zero times. One agent's runner asserted its match count and refused a
  verdict — which is the only reason it did not report nine fake survivors. Any harness here must
  normalise line endings AND assert the hit count (rule 16's "assert the mutation applied").
- **Two agents collided in a shared scratchpad**, each writing `scratchpad/mutate.mjs`; one briefly
  ran the other's script. Agents need a namespaced scratch directory, not a shared one.

## 2026-09-02 — Circle 3

### 14. I FIXED ONE DIRECTION OF A BOUND AND SHIPPED THE OTHER AS AN EXPLOIT

Entry 10's shape, but worse, because I was actively editing the line.

`duration_seconds` was unbounded in both directions. I clamped it at the BOTTOM — negative values
were disabling album budgets — wrote a commit about having fixed it, and left the top open on the
same expression. Two requests and zero bytes then broke any album's video permanently:

    POST /api/upload/stream        durationSeconds omitted   -> approved, stores nothing
    POST /api/album/photos/create  duration_seconds: 2147483647

int4 holds that exactly, so the album's total exceeded every budget forever. With require_approval
on, the poison row is HIDDEN — the owner cannot see the video they are told to delete.

**Habit to build:** a bound has two ends. When clamping one, say out loud what the other end is and
why it is safe. "Math.max(0, x)" is half a sentence.

### 15. TWO TESTS ASSERTED AGAINST THE CONSTANT THEY WERE TESTING

`expect(chargeableDurationSeconds(BIG)).toBe(MAX_STORED_DURATION_SECONDS)` only ever says n === n.
Raising that constant to 2147483647 — which re-opens entry 14 completely — passed the whole file.
Same for MAX_ALERTS_PER_HOUR: every value >= 3 passed, including 99999, which removes the ceiling
the flood argument depends on.

**Rule 17, in tests written the same day I quoted rule 17 in a commit message.**
**Habit to build:** a constant's VALUE gets one assertion against a literal, with the reason beside
it. Everything else may use the import.

### 16. THE SAME FALSE-SECURITY-CLAIM MISTAKE, INSIDE THE COMMIT THAT FIXED IT

Entry 11 was "I put a security claim in a commit title without testing it as an attacker". The
commit that recorded entry 11 then claimed a poisoner "can make the alarm noisier, never silence".
Four unauthenticated POSTs with four different messages spend the hourly ceiling and silence a real
incident for the rest of the hour. Narrower than before, not closed.

**Habit to build:** when writing "X can no longer happen", spend five minutes being the attacker
first. If the sentence survives, keep it; if not, write the residual down instead. The residual is
now asserted by a test, because a comment saying it can be believed and a test cannot.

### 17. A TEST THAT NEVER RAN THE THING IT TESTED

Wrote `it('sizes the per-album budget...', () => {` with no `async` and no call to the function.
It read an empty array and failed on a confusing assertion. Caught immediately, but the shape is
worth recording: a test whose subject is never invoked can also PASS, if its assertions happen to
hold on empty input.

### 18. TOOLING: agent worktrees were created FIFTEEN COMMITS BEHIND

Both round-3 agents found their worktree at `28a3ead` rather than `f472e8e`, and both reset
themselves forward before starting. Round 2's agents were on the same stale base. **A whole round
could have reviewed code that no longer exists and reported it as sound.**

**Habit to build:** every agent brief must say "verify your HEAD is <sha> before you start, and say
so in your report". Both round-3 agents did this unprompted; do not rely on that.

### 19. TOOLING: a mutation harness that reported 52/52 kills, all fake

One agent's runner passed `--reporter=basic`, which vitest 4 does not have, so every run crashed
before loading a test and exited non-zero — scored as KILLED. It only noticed because 52/52 was too
good to be true. A second agent hit the CRLF version of the same trap: multi-line search strings
written with bare `\n` matched zero times on these files.

**The rule for any harness here:** pre-flight the UNMUTATED file and require a real summary line;
assert the find-string hit count is exactly 1; print the mutated line back off disk; refuse a
verdict rather than guessing. This is rule 16's "assert the mutation applied", and it has now nearly
produced false proofs three times.

## 2026-09-02 — Circle 3, clearing the backlog before circle 4

### 20. MY MUTATION HARNESS PRINTED BACK A LINE THE MUTATION NEVER TOUCHED

Entry 19 one level up. I wrote the harness that fixes entry 19, and its readback located the mutated
line by searching for the REPLACEMENT string. Replacing `await signedInUserForGate(album))` with
`null)` printed:

    KILLED   IMAGE: the signed-in lookup is replaced by a hardcoded null
             on disk -> 75: .is('retired_at', null)

`null)` is not unique, so it found the first match — thirty lines above the change. The mutation had
genuinely applied and the kill was genuinely real, but the EVIDENCE was of a different line. Had it
been a survivor I would have investigated the wrong code.

It now diffs the before and after text and prints the line at the first differing byte, which cannot
point anywhere else.

**Habit to build:** a proof that cannot be wrong about WHICH thing it proved. "The replacement is in
the file somewhere" is not the same claim as "this line changed".

### 21. THREE TIMES IN ONE SESSION, A FILE'S OWN DOCUMENTATION DISARMED ITS OWN CHECK

Same shape, three places, found within an hour of each other:

1. `tests/architecture.test.ts` scans every test file for `@/lib/x` to decide what is tested. I added
   a comment TO THAT FILE explaining that mocking `@/lib/report-server-error` must not count as
   coverage — and the comment's own mention of the path marked it covered and took it off the debt
   register.
2. `tests/error-spike-email.test.ts` asserted `toContain('23')` on a fixture whose album slug was
   `abc123`. The assertion was already satisfied by the LINK; it would have passed a build that
   printed no count at all.
3. `supabase/migrations/…_album_video_seconds.sql` opens by quoting the query it replaces, including
   `media_type = 'video'`. My test asserted the function still filters on that — and deleting the
   real filter from the function body left the test green, because the paragraph explaining the fix
   answered for it.

**Habit to build:** when a test greps a file, ask what ELSE in that file can answer. Strip comments,
scope to the construct (the function body, not the file), and never assert on a needle short enough
to appear by accident. Two characters is a coincidence, not an assertion.

### 22. I ADDED A SECOND GUARD THAT COULD NOT FIRE AND CALLED IT DEFENCE IN DEPTH

After moving the video sum into SQL I validated the returned total — null, non-finite, negative all
rejected — and THEN also passed it through `sumVideoSeconds`, with a comment about belt and braces.
A mutation deleting that second call changed no test, because the first check had already excluded
every input it could catch.

That is not defence in depth, it is a line that makes the real guard look optional: the next person
to read it cannot tell which of the two is load-bearing, and deleting the wrong one is silent.

**Habit to build:** if a guard cannot be made to fire by any input, it is decoration — delete it and
make the real one obvious. Rule 15 applies to guards, not just to timers.

### 23. I WROTE AN ASSERTION THAT CONTRADICTED MY OWN FIXTURE

A decode test set the fake to label its output `'decoded'` and then asserted `'bitmap-of-frame'`.
Caught in seconds by running it — recorded because the instinct on a red test is to suspect the
CODE, and here the code was right and the test was wrong. I nearly edited `image-decode.ts`.

**Habit to build:** on a fresh test's first failure, re-read the fixture before the subject.

## 2026-09-02 - Circle 4 (three breakers, one planner, then a real crash)

### 24. I SHIPPED SIX BLIND TESTS IN ONE DAY, AND EVERY ONE PASSED

Circle 4's breakers found nothing wrong with the CODE I had written that morning. They found that
the tests guarding it could not see it. Six defects, all mine, all green:

- both new alarm tests used `hourStartedAt`; the field is `hourStart`. The claim under test was 1
  instead of 3, so `sentThisHour: 0` hardcoded passed the test written to prove it was not hardcoded;
- `cfg.enrichDelayMs` was declared, reset and read by the mock, and no test ever set it, so the
  4-second bound was unexercised and deleting the whole race passed 13 tests;
- the SQL guard asserted fragments and passed five wrong functions;
- the call-site test counted occurrences anywhere in a 2,800-line file, and its two assertions were
  not bound to each other;
- the ImageDecoder fake ignored its init and its decode options;
- a fixture used `image/heic`, which is the value a hardcoding mutation would naturally use - so the
  fixture could not detect the mutation. Same shape as `toContain('23')` answered by `abc123`.

**Habit to build:** a fixture value must be one the mutation cannot coincide with, and a test that
reads source must be scoped to the construct. But the real lesson is the count: SIX, in one day,
after writing MISTAKES entries about exactly this. Writing the rule down is not the same as applying
it, and only an adversarial agent has ever caught these.

### 25. THE SECOND HALF OF A BUG I HAD JUST FIXED WAS EIGHTY LINES BELOW THE FIRST

I fixed the error-alert cron's cooldown claim to read `{ error }` instead of discarding it, wrote a
commit explaining that supabase-js RESOLVES with `{ error }` rather than throwing - and left the
rollback eighty lines further down doing `.then(() => {}, ...)`, the identical defect, in the same
function, in the same commit.

**Habit to build:** when a defect is a MISUSE OF AN API, grep the file for every other use of that
API before closing it. Entry 14 was the same shape (one direction of a bound fixed, the other
shipped as an exploit); this is its third occurrence.

### 26. A COMMENT CLAIMED A SECURITY PROPERTY THE CODE DID NOT HAVE, FOR THE THIRD TIME

`alertVerdict` said "keying the suppression to the dominating message means a poisoner can only
silence the incident they are themselves manufacturing." An agent disproved it in one run: the
suppression is on the TICK, `source` is attacker-controlled and part of the coalescing key, the
per-ROW repeat cap is not a per-MESSAGE cap, and the 200-row newest-first sample lets fresh rows
evict the real incident. ~1,340 requests an hour silences the alarm indefinitely.

Entries 11 and 16 are the same mistake. The difference this time: the corrected comment is backed by
a TEST that asserts the residual, so closing the hole fails the test and forces the comment to change
with it.

**Habit to build:** a comment claiming an attack is closed must name the test that proves it. If
there is no such test, write what is true instead: "narrower, and not closed."

### 27. I WROTE A NEW MODULE AND MISSED THE CODEBASE'S OWN HARD-WON LESSON THREE LINES ABOVE IT

image-decode.ts read the file with a bare `arrayBuffer()`. `readFileRobust` exists in this repo
SPECIFICALLY because Android content:// references throw NotReadableError intermittently -
UploadZone calls it in four places and says so in comments - and production has logged 165 of them.
The new path is reached ONLY by Android Chrome with a HEIC, which is exactly that population. A blip
therefore told a guest to "add it from an iPhone" for a photo the decoder had already accepted.

**Habit to build:** when moving code into a new module, grep for how the REST of the codebase does
that same I/O. The lesson was already written down; I just did not go and read it.

### 28. THE BUG THAT MATTERED MOST WAS FOUND BY A LINT RULE THAT HAD BEEN INSTALLED ALL ALONG

A real guest, unlocking a real password-protected wedding album, got "Something went wrong": five
useMemo calls below an early return, so the gated first render called five fewer hooks and React
threw #310 when the album arrived. It survived review, tsc, 1,110 tests, and TWO full adversarial
rounds - all of which were looking at the code I had just changed, and this was not it.

Worse: I then wrote my own scanner for exactly this pattern. It produced 119 false positives and
missed the real one. `eslint --rule react-hooks/rules-of-hooks` named all five in a single run. The
plugin was in node_modules the entire time and nothing in CI ever ran it.

**Habit to build:** before hand-rolling a detector, check whether a purpose-built one is already
installed. And when a customer error report arrives, the report IS the lead - the two #310 rows named
the page, the hook type and the build, and I went to the source instead of to the tool that decides
this exact question. `npm run check:hooks` now gates the deploy.

### 29. THE ERROR REPORT THAT FOUND IT HAD BEEN CRIPPLED BY OUR OWN LIMITS

The #310 report's stack stopped at `at r.useMemo (https://hushare.space/_ne` - one character before
anything that could name the component. Two independent caps did it: the boundary stored
`error.stack.slice(0, 400)` and `error.stack` begins with React's ~180-character message, and the
server DROPPED THE WHOLE CONTEXT when its JSON passed 800 characters. So the deeper the crash, the
less was recorded about it - a digest, a build id and a path all lost together because the stack
beside them was long.

**Habit to build:** a truncation rule that discards the whole record is not a size limit, it is a
data-loss bug that fires hardest on the most serious events. Clamp the field, keep the keys.


### 30. TEN NIGHTS OF DATABASE DUMPS WERE SERVED TO THE INTERNET, AND EVERY RUN WAS GREEN

`backup-upload.mjs` read `R2_BACKUP_BUCKET || R2_BUCKET_NAME || 'hushare-media'`. The first was never
set as a repository secret, the second is unset in that job, and the third is the bucket published at
`videos.hushare.space`. So every nightly dump - every owner token and every album password hash -
was uploaded to a public, unauthenticated, date-stamped URL. Ten of them, from 24 August.

Nothing was ever wrong from the script's point of view. The upload succeeded, the log said
"uploaded", the admin heartbeat went green, and the workflow had a preflight step written after an
EARLIER backup incident that checked four secrets and not this one.

**Habit to build:** a fallback chain is a decision made silently at 3am by whatever config is
missing. For anything that decides WHERE customer data is written, the missing-config branch must
refuse. `||` with a literal at the end of it is the shape to grep for.

### 31. MY FIRST FIX FOR THAT LEAK WOULD HAVE DELETED THE ONLY BACKUP

To prove the destination was private I uploaded the dump, then fetched the dump's own public URL,
and deleted the object on a 200. That URL resolves to the MEDIA bucket, not the destination - so an
unrelated object sitting at the same key would have read as "exposed" and deleted the night's only
backup. I wrote it, and the comment above it explaining how careful it was, in one pass.

It surfaced only because I ran the guard instead of reading it. The replacement writes a
random-named canary BEFORE the dump, probes that, and deletes only the canary.

**Habit to build:** when a check's failure branch destroys data, the check has to be unambiguous, not
merely cautious. Ask what ELSE could produce this signal - and if the answer is "something I do not
control", the branch is not allowed to delete. Prose about care is not care; running it is.

### 32. I HANDED THREE WRONG FACTS TO AN AGENT AND ONE OF THEM WOULD HAVE WASTED THE WHOLE RUN

Briefing a design agent I stated PhotoWall.tsx was on the SIZE_BUDGET list (it is not, and it is 172
lines), that UploadZone held ~1,981 lines of tangled component logic (lines 1-1961 are already at
module scope - a library missing the word `export`), and that there were ~40 react-hooks findings
(there are 82). The agent measured all three itself and corrected me.

A briefing is not context, it is INPUT. Every wrong number in it either sends the agent to rewrite
code that does not need rewriting, or gets quoted back to me as confirmation of what I already
believed.

**Habit to build:** measure the numbers in the brief at the moment of writing the brief, not from
memory of an earlier session. And read what comes back for corrections to my own premises first -
those are worth more than the findings, because they say where I am currently wrong.

### 33. THE FIX FOR RULE 20 WENT TO THE COMPONENT THAT REPORTED IT, NOT THE ONE THAT PRINTED IT

`BibSearchBar` computes `answerIsFinal = !awaitingServer && !failed` and correctly refuses to say
"No photos with that number" until it holds a real answer. That fix was made, tested, and believed.
One component lower, `PhotoGrid` received `filtered` -- `bibEnabled && !!bibDigits`, true on the
first keystroke -- and printed the negative anyway. So the bar said "Searching…" while the card
directly beneath it said "No photos with that number. Try a different number, or clear the box to
see the whole album."

On a 5,000-photo race album the loaded window is ~500 rows, so this was the DEFAULT experience for
any runner numbered outside it. The subtitle is the worst part: it tells someone to abandon a
correct search that was about to succeed.

Both components were "covered". `tests/bib-search-bar.test.ts` rendered the bar alone and passed.
Nothing rendered the grid at all, and nothing rendered them together -- so the screen was wrong
while every test of its parts was green. vitest.config.ts's own comment names this exact scenario as
the reason jsdom was added, and the grid still had no test.

**Habit to build:** when a fix is "make sure X is not said before Y is known", grep for every place
that says X. The concept lived in one component as a private const; the fix is to move it to
`src/lib` so the other surface can read the same value rather than re-derive it from a weaker one.

### 34. I SHIPPED A GUARD WHOSE FAILURE BRANCH DELETED THE THING IT WAS PROTECTING

To prove the new backup destination was private I uploaded the dump, fetched the dump's own public
URL, and deleted the object on a 200. But that URL resolves to the MEDIA bucket, not the
destination -- so any unrelated object at the same key reads as "exposed" and the night's only
backup gets deleted. I wrote the check and the comment praising its care in one pass, and it only
surfaced because I ran it instead of re-reading it.

**Habit to build:** for any check whose failure branch destroys data, ask what ELSE could produce
this signal. If the answer is "something I do not control", the branch may not delete. Make the
check unambiguous rather than cautious -- here, a random-named canary written BEFORE the dump, which
cannot collide with anything.

### 35. MY OWN NEW MODULE DOCUMENTED A PRECONDITION IT NEVER ESTABLISHED

`searchPhase` checks failure before a held answer, and I wrote a comment justifying it: "any result
still in hand is older than that failure". A review proved that false. The caller tagged failures
and never retired them on success, so a number that failed once read as failed for the whole
session -- including while its own successful results were on screen, with the count and the Face
Finder escape hatch hidden.

The ordering was right. The sentence defending it was an assumption about the caller that I never
checked, written confidently enough to stop the next reader checking either.

**Habit to build:** when a comment justifies a branch with a claim about a CALLER, go read that
caller in the same sitting. And when the precondition turns out not to hold, fix it upstream and say
in the comment that the branch depends on it -- rather than reordering the branch to paper over it.

### 36. MY COMMENT EXPLAINING A COMPILER DIRECTIVE BECAME ONE

Writing a compile-time assertion, I explained the mechanism in a comment that began:

    // @ts-expect-error is the exercise. It fails the build in BOTH directions...

TypeScript does not read that as prose. It read the sentence as a directive and silently suppressed
the error on the following line -- so the REAL directive underneath reported "unused", and the
guarantee I was proving looked broken when it was fine. I then spent six tool calls hunting a
type-system mystery that did not exist, including writing isolated probes that behaved "differently"
from the test file for no visible reason.

What finally found it was putting two probes in the same block and noticing that only ONE errored:
the first was being eaten by the sentence above it.

**Habit to build:** never begin a comment line with the literal name of a directive the toolchain
parses -- `@ts-expect-error`, `@ts-ignore`, `eslint-disable`, `prettier-ignore`. Refer to it in the
middle of a sentence, or rename it ("the expectation directive below"). This is rule 24's family:
text that means one thing to a reader and another to a parser, invisible in review because it looks
exactly like documentation.

### 37. I INSERTED A LINE INTO THE MIDDLE OF A MULTI-LINE IMPORT

A script placed a constant "after the last import" by finding the last line STARTING with `import `.
That line was `import {` -- the opening of a multi-line import -- so the constant landed inside the
braces and split the statement in half. tsc caught it immediately, so it cost a minute, but the
script would have done the same thing silently in any file whose imports are formatted that way.

**Habit to build:** anchor an insertion to something unambiguous and unique in the file (an existing
`const`, a closing brace of a known statement) rather than to a prefix that appears at the start of
a construct as well as at the start of a line. And read back the region you edited, not just the
compiler's verdict -- here they agreed, but they often do not.

### 38. I STRENGTHENED A TYPE THAT WAS NOT GOVERNING THE CODE I STRENGTHENED IT FOR

A review found two 429 branches in album-owner-access.ts throwing away the wait time they had just
computed, on a path 28 route files depend on. I split `AccessFail` into a union so that a
rate_limited failure without `retryAfterSeconds` would be a compile error, wrote a comment saying
exactly that, and moved on.

Then I ran the mutation. Deleting the field from both branches left `tsc` completely green.

The cause: the two wrapper functions had NO DECLARED RETURN TYPE. `AccessFail` was named on the two
inner functions, not on the wrappers where those 429s actually live, and an inferred return type does
not constrain anything -- it simply widens to whatever the body returns. So the type I had just made
stricter was decorative at the only two sites it was written for. Annotating both wrappers turned it
into a real gate, verified: the same deletion now produces TS2322 at both lines.

This is the second time in one session I documented an enforcement I had not exercised (see 35), and
the pattern is the same both times: I wrote the comment at the moment the change felt finished,
which is exactly the moment I had not yet tested it.

**Habit to build:** a comment claiming "this is now a compile error" is a claim, and rule 16 applies
to it as much as to a test. Delete the thing it protects and watch the build go red BEFORE writing
the sentence. And when adding a union to constrain a function, check the function has a declared
return type -- without one, the union is a suggestion.

Checked afterwards for the systemic version: only 5 other exported async functions in src/lib lack a
return annotation (email, three rekognition helpers, supabase/server createClient), and none returns
a union a type is meant to constrain. So this was a real one-off, not the tip of a pattern.

### 39. MY TYPE GENERATOR ASSERTED SOMETHING FALSE ABOUT POSTGRES, AND EIGHT CORRECT CALL SITES PAID

The first version emitted function arguments as plain `T`. Typing the Supabase clients then produced
seventeen errors, and eight of them were against code that was completely correct: `p_album_id: null`
passed to `coalesce_error_event` for every error not tied to an album, `p_ua: null` from the server.

Postgres has no NOT NULL on a function parameter. `f(p_album_id uuid)` accepts NULL, always. My
emitter was not being strict, it was being WRONG — and the failure mode of that is worse than a
missing check, because it points a developer at working code and invites them to "fix" it.

Emitting `T | null` dropped the count from seventeen to six, and every remaining error was real.

**Habit to build:** when a generated type produces errors against shipping code, the first
hypothesis is that the GENERATOR is wrong, not the code. Check what the database actually accepts
before changing a call site to satisfy a type I just invented (rule 18).

### 40. THE TEST I WROTE TO PROVE COMMA-SPLITTING SURVIVED THE MUTATION THAT BROKE COMMA-SPLITTING

`splitArgs` tracks quote and bracket depth so a default like `'{"a":1,"b":2}'` does not get split in
half. I wrote a test for it using the fixture `p_meta jsonb DEFAULT '{}'::jsonb`.

That default contains no comma. So splitting on EVERY comma produced exactly the same three
arguments, the test passed, and the mutation harness reported SURVIVED — the only one of nine.

A fixture has to contain the thing the code defends against. Mine described the feature and
exercised nothing.

**Habit to build:** when writing a test for a parser or a guard, ask what input distinguishes the
correct implementation from the naive one, and use THAT. If the fixture would pass under the naive
version, the test is decoration — and I would not have known without running the mutation.

### 41. A BUG IN CODE I HAD JUST WRITTEN, CAUGHT BY THE TEST FOR IT, ON THE FIRST RUN

information_schema reports `column_default = NULL` for an identity column — the sequence is not a
column default. My "required on insert" rule was `NOT NULL and no default`, so a
GENERATED BY DEFAULT identity column came out REQUIRED, forcing every caller to supply an id the
database fills itself.

No live column is BY DEFAULT today, so nothing would have failed. It would have sat there until the
day somebody added one, and then presented as an unexplainable compile error in unrelated code.

Worth recording as the counter-example to the two entries above: the test caught it because it
described a state the database can actually be in, rather than the state it happens to be in now.

### 42. I INVENTED A BUG TO JUSTIFY A CHANGE, AND WROTE IT DOWN IN THREE PLACES

Typing the Supabase client made `r.stream_uid` (nullable) fail to compile where it was added to a
`Set<string>`. I added the guard, and then explained it as a fix: "a nullable stream_uid was
poisoning the dedup set with a junk entry."

A review checked it against the live database. The query filters `.in('stream_uid', incomingUids)`,
and SQL IN NEVER MATCHES NULL — `select (null::text in ('a','b'))` returns NULL, not true. So a null
could never have reached that loop. The bug I described could not happen.

The guard is still needed, because the TYPE requires it. But I had written the false story into the
code comment, the commit message, and the SIZE_BUDGET justification — and a budget raise is exactly
the artifact that becomes lore, because the next person reads it as precedent rather than checking
it.

This is the third time in one session I documented something I had not verified (see 35 and 38).
The shape is identical every time: the moment a change compiles is the moment I write the sentence
explaining it, and that is before I have any evidence for the sentence.

**Habit to build:** a compile error tells me the TYPE requires something. It does NOT tell me a bug
existed. Those are different claims and only the first one is free. Before writing "this was a bug",
ask what input actually reaches the line — and if the answer needs a query, run the query.

### 43. THE COMMIT TITLED "THE SELECT FETCHED 44 COLUMNS WHILE ITS TYPE DECLARED 42" DID NOT CLOSE THAT GAP

I wrote the title in the past tense. A review measured it afterwards:

    AlbumRow fields: 42   selected columns: 44
    SELECTED but NOT in AlbumRow: [ 'package_tier', 'package_expires_at' ]

Exactly the two columns that decide whether a PAID album gets what it paid for. They were read
through two `as` casts twenty lines below the query, which is why deleting the outer
`.returns<AlbumRow[]>()` did not surface them.

The reviewer proved the cost rather than describing it: with those casts in place, DELETING both
columns from the select still compiled and still passed all 1,260 tests. At runtime every packaged
album would fall back to its owner's ACCOUNT tier — logo masked, sponsor marks emptied, bib search
gone from a race album while the API kept working. One live paying album sits behind it.

In the same commit I wrote that PHOTO_SELECT_COLS was "a literal, so PostgREST can check it". Also
false: a photo typo compiles clean, because two casts erase the result type — and the one doing most
of the erasing, on the main branch serving the album grid, I had not even noticed.

**Habit to build:** when a commit message states a defect is FIXED, the mutation that proves it must
run before the message is written, not after. "I removed the cast that hid it" is not the same claim
as "the gap is closed", and I have now conflated those twice in one day. Count the two sets and diff
them; the number is cheap and the sentence is not.

The corrected version is enforced: dropping either package column from the select is now a compile
error, proven by mutation.

### 44. I SHIPPED DEAD CODE TWICE IN THE COMMIT WHOSE MESSAGE CRITICISED DEAD CODE

The clock commit's message made a point of two unreachable guards I had removed: "defensive code
that cannot run is worse than none, it reads as the thing holding the invariant." Then a review of
that same commit found two more pieces of code with no caller in it:

- `stalled()` -- an exported predicate used only by its own test. The `fired` flag existed solely to
  serve it. A mutation making it always return true survived.
- `createDeadline` -- exported production code with five tests behind it and ZERO call sites, while
  the message described it as "for the four retry loops that compute Date.now() + wait >= deadline
  by hand", which a reader takes as done. The four loops were untouched and still on the wall clock,
  including the one where a forward step over 120s fails a photo with the budget unspent.

Both are now fixed: `stalled()` deleted, `createDeadline` wired into both byte-transfer budgets.

Also in that review: no test sat strictly BETWEEN zero elapsed and the stall threshold, so a mutant
firing the watchdog after 200ms instead of 20s passed the whole suite -- the exact "aborts a healthy
upload" failure the commit claimed to eliminate. And AGENTS.md rule 22's claim that Date.now() moves
when a phone crosses a timezone is false (it is UTC epoch ms); I had repeated it in two files.

**Habit to build:** before the commit message names a function as the fix for something, grep for
its callers. Zero is a finding. And when a test suite is built from edge cases -- exactly zero,
exactly the threshold, well past it -- write the boring middle case too, because that is where
"wrong constant" mutants live.

### 45. I CALLED IT "A PREDICATE, NOT A CAST", AND THE MUTATION SHOWED IT WAS A CAST WITH BETTER MANNERS

Removing `.returns<>()` from two crons exposed that the casts had declared nullable columns non-null
because a runtime PostgREST filter guaranteed it. I replaced each with an inline type predicate --
`.filter((a): a is typeof a & { x: string } => a.x !== null)` -- and wrote a comment saying this
"establishes" the guarantee in code, unlike the cast.

Then the rule-16 run: I changed the predicate's BODY to `true`. tsc stayed green. A type predicate
narrows by its SIGNATURE; the compiler never checks that the body earns the claim. So the runtime
check and the type claim were held together by nothing, exactly like the cast -- the only real gain
was that the intent was now written down next to the query.

The fix that actually closes it is rule 14: the body moves into `lib/non-null.ts` where a test holds
it, and the signature is checked by tsc at every call site. Now a mutation to either half is caught
by something.

**Habit to build:** an `is` annotation is an assertion the compiler trusts, not one it verifies. When
I write one, the body needs a test of its own -- and the rule-16 mutation to run is on the BODY, not
the signature, because that is the half that can quietly stop matching.

### 46. THREE GUARDS THAT COULD NOT RUN, FOUND ONLY BECAUSE A MUTATION DELETED THEM

Extracting the upload path into lib, three separate "defensive" lines survived their mutation:
xhrPut's `settled` flag, the reachability probe's `if (probe === loop)` before clearing the slot,
and the probe loop's second deadline check. Each read as the thing holding an invariant. Each was
unreachable -- finish() disarms both possible callers; a new loop is only created after the old one
cleared the slot; the two deadline checks overlapped so completely that deleting either alone kept
every test green.

The lesson from MISTAKES 44 (createStallWatch) was already written down, and I still wrote the
three, because "add a settled flag" is a reflex that arrives faster than the question "who could
call this twice?".

**Habit to build:** a surviving mutation is not always a weak test. Before strengthening the test,
ask whether the code it failed to kill can execute at all. If not, delete the code and write WHY in
its place -- an unreachable guard is worse than none, because the next person edits around it
trusting it.

### 47. I WROTE A HISTORY INTO A COMMENT WITHOUT READING THE HISTORY

Moving `settleWithin` to lib/clock, I wrote that it "used to leave a twelve-second timer behind
every poster that arrived in two". The original, twenty lines up in the file I was moving it out
of, cleared its timer and said so in its own comment. Rule 0, in a comment: I described a past I
had not looked at because it made the paragraph read better.

Caught before commit only because I went back to check a different claim in the same block.

**Habit to build:** a comment that says "used to" or "was" is a factual claim about a specific
older version of the code. `git show` it or `sed -n` it before writing the sentence. If the point
of the comment is why the code is shaped this way, the ORIGINAL's own reasoning is usually the
honest thing to carry across, verbatim.

### 48. RULE 24, FOURTH TIME: A `\n` THROUGH BASH-THEN-PYTHON BECAME A NEWLINE INSIDE A STRING LITERAL

Appending mutation entries to a harness, I piped a Python heredoc through Bash. The `\n` I wrote
for the JS string literal arrived on disk as a real line break, splitting the literal across two
lines. `node --check` refused the file. I only ran that check because the Note on the edit looked
wrong; had I trusted the tool result, the harness would have "run" and reported nothing.

Two layers of escaping, each correct on its own, are still a guess about what the other layer does.

**Habit to build:** file CONTENT goes through Write or Edit, full stop -- including scratchpad
harnesses, which I had been treating as exempt because they are not shipped. And after any
generated file, `node --check` (or the language's equivalent) before believing it ran.

### 49. TWO TESTS THAT WERE WRONG ABOUT WHAT THEY MEASURED, WRITTEN MINUTES APART

`putWithRetry` "keeps trying for the full 120s budget": I asserted the attempt count would be at
least `PUT_DEADLINE_MS / 10_000 - 1`, re-deriving the loop's arithmetic in the test and getting it
wrong (backoff sleeps also spend the budget; the real count was 9). Rule 17, exactly.

"A cancel DURING the outage wait ends promptly": I measured `Date.now() - before` after advancing
the fake clock 100 seconds -- so I measured how far I had advanced the clock, not when the promise
settled. It failed for the wrong reason, and a version that passed for the wrong reason was one
sign flip away.

**Habit to build:** an assertion about TIME records the instant the thing under test settles
(inside its `.then`), never the instant the test finishes waiting. An assertion about COUNT states
the property ("more than the old fixed five, and the budget was spent"), not a number derived by
redoing the code's arithmetic.

### 50. THE TEST HELPER THAT ERASED THE EVIDENCE

Every retry test drove the loop with `outcome(p)`, which advances 500 seconds of fake time and then
reads the result. The mutation "per-attempt cleanup never runs" survived: the orphaned 20-second
timers it leaves behind had FIRED during those 500 seconds and were gone by the time I counted them.
The helper that made the tests convenient also destroyed the one artefact the leak test needed.

**Habit to build:** a test for "nothing is left behind" must count immediately after the thing
completes, with no fake time advanced in between. More generally: when a mutation that OBVIOUSLY
changes behaviour survives, suspect the harness around the assertion before the assertion.

### 51. "EVERY MUTATION KILLED" MEANT EVERY MUTATION I THOUGHT OF

The upload-lib extraction shipped with 63 mutations, all killed. Two reviewers then wrote ten of
their own and eight survived -- the relay POST opened as a PUT (no test read `calls.open`), a
5,000-second probe timeout (the test asserted `instanceof AbortSignal` and nothing about the
number), a listener never removed (the test's NAME said "drops its listener", its body counted
timers), no backoff on a PUT retry (the test asserted a call count, no timing). Each was a test
whose title promised a property its assertions could not observe.

The pattern in all eight: I wrote the mutation list from the code I had just written, so it
covered the branches I remembered adding and missed the ones a stranger would poke first.

**Habit to build:** before declaring a set complete, write three mutations from the TEST NAMES,
not from the code -- for each `it('...')`, what change to the code would make that sentence false
while leaving every other test green? If none of the listed mutations is that change, the test is
decoration and the set is short one entry.

### 52. A COMMIT THAT SAID "VERBATIM" AND WAS NOT

657309c's message listed four deliberate behaviour changes and called everything else a verbatim
move. A reviewer diffed the moved code against the original and found two more: a user-facing
string ("Incomplete" became "Unreadable" -- /admin groups incidents by exact message, so the change
would have split one incident into two rows) and `HttpError.name`. Neither was harmful; both were
unlisted, which made the list a lie by omission.

I also shipped a fourth equivalent guard (`if (deadline.expired()) break` beside a `wouldOverrun`
that already breaks first) in the same commit whose message explained why three such guards had
been removed. The reviewer's mutation found it the same way mine had found the other three.

**Habit to build:** when a commit claims equivalence, produce the evidence the reviewer will
produce: `git show <parent>:<file>` beside the new module, and diff the function bodies, not the
memory of writing them. And re-read the commit message's own standard against the code it ships.

### 53. THE RESTORE THAT CHANGED THE BYTES

A process exit left two reviewer mutations on disk. `git checkout --` restored them -- to CRLF,
under `core.autocrlf=true`, in a tree that is LF everywhere else. Git reported both files clean.
Every newline-keyed `from` string in every harness then silently missed: five shipped mutations and
all six of a reviewer's reported DID NOT APPLY against files whose only difference was the line
ending. My own runner had the same hole until the reviewer named it.

**Habit to build:** a mutation harness matches on normalised text and restores the original bytes;
that is in `scripts/mutations/run.mjs` now. And after any `git checkout` of a file on this machine,
`git ls-files --eol <file>` -- "clean" is not "identical".

### 54. A REPORT THAT NAMED ROWS THE NEXT TEN LINES DELETED

The deleting sweep skipped rows with an unknown backend and reported their ids so "the operator can
find the files". The album row is deleted ten lines later and the photo rows cascade with it. A
primary key of a row that no longer exists leads nowhere; the only thing that could have led to the
file -- the row's path columns -- was in the batch and thrown away. I wrote the rule-19 "say so"
half and made it say something useless.

**Habit to build:** when a report is the last record of something, ask what the reader will still
be able to look up when they read it. If the answer is "nothing", the report needs to carry the
thing itself, not a pointer to it.

### 55. I MOVED A CAP INTO ONE PLACE WITHOUT ASKING WHETHER THE CAP HAD EVER BEEN TRUE

MAX_BULK_DELETE was 500 in the route and 200 in the client. I made it 500 in one place -- rule 13
satisfied -- and the reviewer measured that 500 ids produce a 19.6 KB PostgREST URL that fails
under Node's 16 KB header cap. The route's 500 had never been sent; the client's 200 was the number
that worked. Deduplicating two copies of a fact is only right if the copy you keep is the true one.

**Habit to build:** before unifying two disagreeing constants, find out which one reality has been
running on. Then hold the survivor to a measurement in a test, not to the number someone typed.

### 56. A CODEMOD'S "OBVIOUSLY RIGHT" TEMPLATE CASE PRODUCED FOUR LITERAL STRINGS

The silent-500 codemod turned `console.error('[x] failed', album.id, ':', err.message)` into the
detail `` `album.id : err.message` `` -- a template literal with no `${}`, so the panel would have
received the words "album.id : err.message" forty times. tsc was green; the strings are valid.
Reading every hunk caught it; nothing else would have.

**Habit to build:** a codemod's output is reviewed line by line, every line, before tsc gets a
say -- tsc cannot tell a wrong string from a right one. And a codemod that handles a case by
string surgery on an expression is a case to hand-edit, not automate.

### 57. "IT IS 0" -- A COUNT OF FILES, WRITTEN INTO A COMMIT MESSAGE AS A COUNT OF SITES

The silent-500 commit said "ARCHITECTURE.md section 6 said 46 files; it is 0". The document was
not in the commit, and the zero came from a census that asked "does this FILE mention the
serializer anywhere?" -- so six files that reported at one site and stayed silent at nine others
counted as done. The reviewer read every `status: 500` and found them. The same census, run the
other way, then over-counted: the Polar webhook's bare responses all had a full report three lines
above them and needed no change at all.

**Habit to build:** a claim in a commit message is checked the way the reviewer will check it --
per site, with the exact grep in the message -- and a claim about a file the commit does not touch
is not made. Rule 23 applies to prose as much as to deploys.

### 58. "NO CHECK CONSTRAINT" -- FROM A GREP OF A DUMP FILE THAT MATCHED NOTHING

I wrote, in code and in a commit message, that `subscriptions.tier` has no CHECK constraint. My
evidence was `grep -rn "tier" supabase/schema.sql | grep -i check` returning empty. The reviewer
read `pg_constraint` from the live database: `subscriptions_tier_check CHECK (tier = ANY
(ARRAY['pro','studio']))`. An empty grep is not the absence of a thing; it is the absence of a
match for my pattern in one file. Rule 0, three hours after writing entry 55.

**Habit to build:** a claim about the database is checked against the database -- pg_constraint,
information_schema, or the generated types -- never against a text file that describes it. And a
negative claim ("there is no X") needs the query that would have found X, shown returning nothing.

### 59. `git checkout --` ON A FILE WITH THREE PEOPLE'S UNCOMMITTED WORK IN IT

To prove a new test caught a review's mutation, I applied the mutation to OwnerToolbar.tsx, ran the
test, and "restored" the file with `git checkout -- <file>`. That restores HEAD -- not the file I
had a minute earlier. It threw away my own uncommitted panel extraction, the badge edits I had just
made, and a one-line comment another session had written in the same file. The only reason nothing
was lost is that the line before the mutation was `cp <file> /tmp/ot.bak`, a habit I had not
thought about while typing it.

**Habit to build:** a file is restored from the copy taken immediately before the change, never
from git, whenever there is ANY uncommitted work in it -- mine or anyone's. `git checkout --` is
for files that are clean. And when another session shares the working tree, every write is
assumed to be on top of someone else's.

## 2026-09-07 — Circle: the bib search's indexing state

### 60. I FIXED A RULE-20 BUG IN A MODULE AND THE CALL SITE SURVIVED THE MUTATION

`searchPhase` had no idea whether the album's OCR had finished, so a search that COMPLETED against a
half-read album returned 'answered' and PhotoGrid printed "No photos with that number" underneath a
bar that was simultaneously reporting "Still reading photos (1,200 of 5,000)". I added an
`indexing` phase and `indexComplete()`, wrote 24 tests, and killed 9 of 9 mutations on the module.

Then I mutated the CALL SITE -- `indexComplete: true` in AlbumPageClient -- and **38 tests passed**.
One token reinstates the entire bug: the album always looks fully read, so the new phase can never
be returned. Entry 10 records this same shape four times and I did it again, in the commit whose
whole purpose was to close a two-surfaces-disagreeing bug.

`tests/album-page-search-wiring.test.ts` now pins the call site, and the same mutation fails it.

**Habit to build:** the mutation set for an extracted decision must name the CALLER's file too, or
the run proves the half that was never in doubt.

### 61. MY FIX RE-CREATED A REGRESSION THE FILE ITSELF SAID HAD ALREADY BEEN FIXED ONCE

A breaking agent found it before it shipped. `BibSearchBar` gated three things on
`answerIsFinal = mayStateAbsence(phase)`, which is false for 'indexing'. So on a half-read album the
new state hid the "Find me by face" escape hatch and pinned the label on "Searching…" -- and nothing
re-fetches after the answer lands, so it never resolved. A runner sat on a spinner with no way
forward, at a race, on the primary path.

Six lines above that gate is a comment explaining that this exact outcome was reached once before by
a different route (it used to require `!stillIndexing`) and why it must never happen again. I read
that file three times while making the change and did not connect it.

The cause: `mayStateAbsence` answers "may I claim nothing was found"; the bar was also using it for
"is the attempt over, so may I offer a way out". Those are two questions that happened to have one
answer while there were four phases. Adding a fifth split them, and reusing the old predicate for
both is what recreated the bug. `attemptIsOver` is now the second predicate, and a test asserts the
two disagree on exactly one phase -- so if they ever agree everywhere again, one of them is
redundant and that is a finding rather than a silence.

**Habit to build:** when adding a member to a union, list every predicate over that union and ask
what each one MEANS, not what it currently returns. A predicate that was correct for four cases is a
new claim about the fifth, made silently.

### 62. TWO SMALLER ONES FROM THE SAME CIRCLE

- **My new wiring test failed against correct code.** Its regex read a property value with
  `[^,\n]+`, which truncates `indexComplete(a, b)` at the argument comma. The instinct on a red test
  is to suspect the subject; the fixture was wrong. Entry 23's shape.
- **A mutation went AMBIGUOUS and the harness refused it.** `  return phase === 'answered'` stopped
  being unique the moment `attemptIsOver` was added below it, because its body starts with the same
  text. The runner declined to land it rather than mutating a line I had not looked at -- the guard
  written after entry 19/20 doing its job. Needles anchor on a signature, not on a shared return.

### 63. MY GATE TRUSTED A NUMBER THE FILE ITSELF CALLS "THE MOST REASSURING POSSIBLE WAY TO BE WRONG"

The indexing gate read `bibIndexedCount`/`totalImageCount`, which fall back to counting the LOADED
WINDOW when the server's figures have not arrived. Two lines above them sits a comment I moved
myself, in the same edit, saying those local counts "made the two numbers agree with each other
perfectly on a partly-loaded album -- '2,000 of 2,000 read' while 3,000 photos were still coming --
which is the most reassuring possible way to be wrong."

It was harmless while it only decorated a hint line. I promoted it to gating a rule-20 negative and
did not re-read the sentence I was moving. Worse, the bias runs the wrong way twice: albums default
to OLDEST-FIRST, so the loaded window is exactly the photos OCR finished first and reads as 100%
indexed -- and the stats request is issued only when the search box is EMPTY, then aborted by the
first keystroke, so absent stats are the common case during a search rather than a rare one.

The fix is two predicates instead of one, deliberately NOT complements: `indexKnownComplete` and
`indexKnownIncomplete`, both false when the server's stats are absent. A single boolean cannot
express "I do not know", so whichever way it defaults, one of the two surfaces states something it
cannot back -- either the grid claims absence or the bar claims "still reading". A test asserts the
two are never both true, and the wiring test now fails if anyone feeds the fallback counts back into
the gate.

**Habit to build:** when a number moves from decoration to enforcement, re-read every comment
already attached to it. The warning was three lines away and I was the one who carried it there.

**Also worth recording:** this is the second predicate-splitting fix in one circle (entry 61 was the
first). Both had the same cause -- one boolean answering two questions that only happened to share
an answer. When a union grows, every predicate over it is a new claim about the new member.

### 64. "UNMOUNT IS THE RESET" -- TRUE, AND IT ALSO UNMOUNTED THE ONE STATE THAT HAD TO SURVIVE

Moving the delete panel out of the toolbar, I put its flow state in the panel body so that closing
the accordion would disarm a half-confirmed red button. Correct, and I said so. What I did not
trace: the body also held "deleted, restorable for N days", and the request that produces that
state outlives a tap on the accordion header. Close during the request and the success landed on
nothing -- no undo shown, and a retry answering "Album not found". The old code had kept that one
value in the toolbar, which never unmounts, without a comment saying why; I moved it with the rest.

**Habit to build:** when a component's lifetime becomes the reset mechanism, list every piece of
state it holds and ask, for each, whether an in-flight request can finish after the unmount and
whether the owner needs to SEE its result. Anything that must be seen belongs in the thing that
stays mounted.

### 65. A REMOUNT KEY IS A RESET THAT ALSO FIRES ON YOUR OWN SAVE

`key={album.custom_slug}` was meant to reinitialise the panel when another device changed the slug.
It also fired when the owner's own save landed -- the prop changed -- so the section was discarded
in the same batch as `setSaved(true)`, and the "Saved" line never rendered. And it would have wiped
a half-typed draft on a remote change, which the old resync had deliberately refused to do. A key
cannot tell "someone else changed it" from "I just changed it"; a render-time reconcile that resets
only a pristine input can.

**Habit to build:** before keying a component on a prop, ask who ELSE changes that prop -- the
component itself, on success, almost always does.

### 66. RULE 24, THREE MORE TIMES IN ONE EVENING, ALL THROUGH PYTHON

`\b` inside a Python string became a backspace; `\n` inside a Python heredoc became a newline in
the JS file it wrote; `\.` warned and matched nothing. Each time the script aborted or wrote a file
that did not parse, and each time the fix was the same: the Edit tool. I kept reaching for python
because it handles multi-line replacement conveniently, and paid three times.

**Habit to build:** the Edit tool for any content containing a backslash, full stop. Python only for
content that is pure ASCII prose with no escapes -- and even then, `assert count == 1` before every
write, which is the only reason none of the three aborted scripts corrupted a file.

### 67. A GUARD THAT NEVER FIRED, THREE TIMES IN THE SAME ENGINE

The outreach draft generator had three decisions written as if they varied, and not one of them
ever varied.

`sponsor_names` and `races_per_year` were read by the approach selector and were absent from the
research JSON schema, which sets `additionalProperties: false` -- so the model could not have
returned them if it had wanted to. The sponsor count was permanently 0 and the cadence permanently
1, which made two of the four opening approaches unreachable and quoted every race on earth a
one-off package. `custom_price` was read by the assembler and was missing from the schema's
`required` list, so the model simply omitted it, `undefined` is falsy, and the one sentence in the
whole letter that offered any flexibility could never appear. And `recommendedTier` was derived
from a hardcoded string, so the filter that stops a Pro price sitting beside a Max-only promise had
never removed a single sentence.

None of the three threw. A missing field and a real zero are identical through `?? 0`, and a guard
that never fires looks exactly like a guard that works. The user found the third one by reading the
output and saying "i don't see flexibility here" -- which is the only detector that was working.

**Habit to build:** every field the code reads must be in the schema AND in its `required` list, and
a decision function's test must show every branch reached from a realistic input. `expect(f(x)).toBe(y)`
proves the function returns something; only a case per branch proves the branches exist.

### 68. MY OWN MUTATION PROVED NOTHING, THREE TIMES

Rule 16 says break the code and watch the test fail. Three of my mutations SURVIVED, and in every
case the mutation was the problem, not the test: `(x ?? 1) >= 3` is the same function as
`x !== null && x >= 3`; `hostname.toLowerCase()` cannot change an answer because the URL parser has
already lowercased the host; and a month-range check is dead code when the line below it reads the
month back off the parsed date. Each survivor was an equivalent mutation, and each one pointed at
real dead code rather than at a missing test -- two of the three lines were then deleted.

**Habit to build:** a survivor is not automatically a missing test. Ask first whether the mutant is
actually a different function. When it is not, the code it touched is dead and should go.

### 69. A TYPE-CHECK THAT IS ALWAYS RED REPORTS NOTHING

`npx tsc --noEmit` failed with nineteen errors in tests/search-answer.test.ts, all one missing
property on one object literal. Underneath them sat a real finding: that file's deliberate
exhaustiveness guard -- a conditional type that resolves to `never` when a phase is unlisted -- was
firing because `SearchPhase` had gained an `'excluded'` member that nothing in the file covered.
The phase is the one that stops a runner being told "No photos with that number" for a bib the
ORGANISER excluded, and it had no test at all. vitest does not type-check, so 1,643 green tests said
nothing about any of it.

**Habit to build:** a failing type-check is not background noise to route around. Clear it to zero,
because the errors it is hiding are the ones nobody chose to accept.

### 70. THE DEAD BRANCH, THIRD TIME: AN OUTPUT WITH NO CONSUMER

Entry 67 was about decisions whose INPUTS had no source. I fixed those, wrote the module, wrote
nineteen tests, killed the mutations, and reported it done. An adversarial review then found
`chooseApproach` returning a correct answer that reached nothing at all: it was not a parameter of
`assembleEmail`, so it could not shape the letter, and the word "approach" appeared ZERO times in
the writing prompt, so the model received `"the crowd nobody shoots"` as a bare JSON key with no
instruction attached. `has_photo_supplier` was not even in the facts sent to the model, which made
that branch unimplementable rather than merely un-instructed.

Four branches, six tests, one opening instruction that described the same approach for every race.
The tests certified a no-op, and they passed because they asserted what the function RETURNS rather
than what changes when it returns it.

**Habit to build:** for a decision function, the test that matters is not "does it return the right
string" but "does the output change the artefact". Grep the consumer for the value's name before
believing a decision is wired up.

### 71. A VALIDATOR THAT PASSED THE EXACT FAILURE IT WAS NAMED FOR, THREE TIMES

The numbers check exists because a draft said "the eight partners you list" when the research had
confirmed seven. Its docstring says so. Executed against real research, it returned `[]` for that
sentence.

Backing "eight" meant `JSON.stringify(research).includes('8')` -- one character, matched by a date,
a page count, a field size. It was also substring containment, so "202 sponsors" was backed by
"2026". The tests passed because I fed them hand-built corpora (`'{"n":7}'`) that contained no digit
8 and no long numbers -- rule 17's shape, where the test constructs an input the production path
never produces.

Then the repair failed the same way. I collected whole tokens and added array lengths so a
seven-entry sponsor list would back "seven" -- and `pages_read` is also an array, holding up to
eight pages, so 8 walked straight back into the backing set and the same sentence passed again. It
took a third attempt to get the distinction right: a claim about a COUNT has to be backed by a
count, never by a digit that happens to appear in prose or a URL.

**Habit to build:** test a validator against the real artefact its subject produces, not against a
minimal literal. And when a fix targets a specific failing input, re-run THAT input against the fix
before believing it -- twice, I did not.

### 72. RULE 24, BY ME, IN THE FILE THAT ENFORCES RULE 24

I typed literal U+00A0 and U+202F into two regex character classes in `src/lib/outreach/validate.ts`
-- the module whose entire job is to catch invisible and machine-looking characters, and whose own
comment explains that a check written as a literal can be defeated by the accident it exists to
catch. Four invisible characters, invisible in the diff, invisible in grep, found by a reviewer.
`tests/source-hygiene.test.ts` passed throughout, because it does not scan for those two code
points.

**Habit to build:** any character above ASCII goes into source as an escape, in the file that bans
them most of all. And when a hygiene test passes, check what it actually scans for before treating
it as cover.

### 73. A PIPE ATE THE EXIT CODE AND I REPORTED A PROOF THAT HAD NOT HAPPENED

I told the user "54 of 54 mutations killed". There were 65, not 54 -- I carried a stale count from
before I added more -- and one of them had gone stale when I reworded the sentence it targeted, so
it had never executed. A reviewer running the same sets found the same thing about their own run:
`node scripts/mutations/run.mjs ... | tail -25` returns TAIL's exit status, not the runner's, so a
failing run reads as a passing one.

The runner already prints DID NOT APPLY and exits 1 for exactly this. Both of us piped it and lost
the signal.

**Habit to build:** never pipe a command whose exit code is the result. Redirect to a file and echo
`$?`. And after editing a module, re-run its mutation set before citing an older number -- a
mutation set is only as current as the last edit to the file it targets.

### 74. I FIXED A RACE BY MAKING THE BASELINE IMMOVABLE, AND CREATED TWO NEW RACES INSIDE ONE ROUND TRIP

The media panel diffed its draft against an album it had already patched optimistically, so a
radius drag plus an autoplay flip inside the debounce dropped the radius. My fix: `confirmed` is
what the server said and nothing else moves it. Correct -- and two reviewers then broke it in
one round trip each, with a fetch mock that HOLDS requests open: flip ON then OFF before the ON
answers, and the OFF planned as "no change" (draft equalled confirmed), the ON landed and confirmed
`true`, and nothing ever re-planned: server ON, switch OFF, until some unrelated edit carried it.
And with two requests out, a failed first one reverted a field the second had carried and the
server had accepted, so the next edit quietly moved the server to a value the owner never chose.
The old code did not have these because it diffed against the optimistic album -- the bug I had
just removed was also what had been papering over them.

I had tested the immediate-answer case only. Every one of my 8 component cases resolved fetch
synchronously; not one made an edit while a request was out, which is the whole shape of a
state machine with a network in the middle.

**Habit to build:** a test rig for anything that talks to a server holds the request open by
default and releases it by hand. "Edit, then answer arrives" is the ordinary case, not the
exotic one -- a switch is clicked twice in under a second all the time. And when a fix makes a
value immovable, list every place that used to move it and ask what each of those was quietly
doing right.

### 75. TWO REVIEW AGENTS STALLED ON THE SAME THING: THE COMMAND WITH NO OUTPUT FOR TEN MINUTES

Both first-circle reviewers died to the 600-second watchdog. One had launched the full suite,
the other the mutation runner (13 jsdom runs, one file each, no output between them). I had
already run both and had the results; the agents re-derived them and never got to the review.
The relaunched agents were told the results, told not to run those two commands, and told to read
files by line range -- and both finished with real findings inside ten minutes.

**Habit to build:** a review agent gets the expensive results handed to it and a list of the
commands it must not run. Its budget is for thinking, not for reproducing what I already know.

### 76. A SURVIVING MUTANT WAS THE CODE BEING DEAD, AGAIN (SEE 68)

"An immediate save no longer cancels the pending debounce" survived the new component set. It
was equivalent: with one request in flight at a time, the timer that fires during a request finds
it out and does nothing, and the settle step sends whatever is left. The cancel had been the
mechanism that stopped two requests racing; serialisation replaced it and I had left both in,
with a comment still claiming the cancel was what prevented the race. The mutant was right; the
cancel and the comment went.

### 77. `git worktree remove --force` FOLLOWED THE JUNCTION AND DELETED THE REAL node_modules

The throwaway review worktrees get a directory junction to the main checkout's node_modules so
they need no install. Tearing one down, I ran `rmdir` on the junction first -- it printed "cannot
find the path" and I read that as "already gone" -- then `git worktree remove --force`, which
walks the tree and deletes everything it finds, including through the junction. The next reviewer
reported "node_modules contains only an empty .vite-temp" and could not run a single test; the
other session working in the same checkout lost its toolchain for the fifteen minutes `npm ci`
took. Nothing tracked was touched; the lockfile made it recoverable.

The mistake underneath: a "not found" from the cleanup step was treated as success (rule 23), and
a recursive delete was pointed at a directory containing a link into something I cared about.

**Habit to build:** before any recursive delete, list what is inside the target -- a junction or
symlink there means STOP. Remove links with a command that fails loudly if it did nothing, and
verify the link is gone before the recursive step. Or do not delete worktrees at all: `git
worktree add` to a fresh path is cheap, and an old one can be pruned once the junction is
confirmed gone.

### 78. I ADDED A TIMEOUT SO A SAVE COULD NOT BE SILENT, AND MADE TWO SAVES SILENT

The per-album wire gate held forever on a dead connection, so I bounded every media-settings
request with `AbortSignal.timeout`. A timeout is a REJECTION. The media saver's caller had a
try/catch; the desktop-columns and slideshow-motion savers, which I had just routed through the
same bounded POST in the same commit, were called with `.then((r) => { if (!r.ok) ... })` and no
catch. A timed-out desktop click: no toast, no revert, the buttons stuck on a value the server
never had, and one unhandled-rejection entry in the admin panel per click. The commit message said
"no toast and no error line" was the problem being fixed.

And the branch that turns a failure into words -- `e instanceof Error ? e.message :
t('common.networkError')` -- never reached the translated line for a timeout, because a
DOMException IS an Error. Armenian and Russian owners would have read the browser's own English.

**Habit to build:** when a change makes a function able to reject where it could not before, grep
every caller for a catch before committing, and write the test that rejects the promise -- the
one that took the reviewer ten minutes and me none. "instanceof Error" is not "an error the user
can read".

### 79. THE "BOUNDED" TEST WAS SATISFIED BY A SIGNAL THAT NEVER FIRES

My test for the timeout asserted `signal instanceof AbortSignal`. A reviewer replaced the timeout
with `new AbortController().signal` -- an abort that never comes, the exact failure the mutation
set names "unbounded" -- and the suite stayed green. The set's own "unbounded" mutant was killed
only because it DELETED the property. The test now spies on `AbortSignal.timeout`, asserts the
number it was called with, asserts the request carries that very signal, and asserts a queued
request does not start its clock until it leaves.

**Habit to build:** a test of a bound asserts the bound -- the number and the mechanism -- not the
type of the thing carrying it. And a mutation that deletes a line proves less than one that
replaces it with a plausible wrong line.

### 80. RULE 24 AGAIN, FROM PYTHON IN A BASH HEREDOC, WHILE WRITING THE FILE THAT SAYS NOT TO

Twice in one evening a `\n` inside a mutation-set string became a real newline on disk -- once
through a python script pasted into a quoted heredoc, once through a python `-` heredoc. The file
that broke (`scripts/mutations/*.mjs`) exists to hold escaped strings. The Write tool wrote it
correctly first time both times I gave up on the shell.

**Habit to build:** any file content with a backslash goes through the Write or Edit tool. No
exceptions for "it's just one line". MISTAKES 48, 66, 72 said this already.

### 81. I BUILT A COMMIT FROM "HEAD PLUS MY PATCH" AND HEAD HAD MOVED

To keep the other session's uncommitted hunks out of my commits, I stage AlbumPageClient as a
blob: take HEAD's copy, apply my patch to it, hash it, put it in the index. Between reading HEAD
and committing, the other session committed feab547 on the same file. My blob was built from the
older HEAD, so my commit silently REMOVED their three hunks -- the import, the memo, and the
`excludedByAlbum` argument that stops a runner being told "No photos with that number" about a
search that never ran. HEAD no longer type-checked; the deploy gate would have caught it, but a
reviewer caught it first, and a well-meaning "make the field optional" fix would have shipped
the bug back to production with a green build. Worse: their commit had swallowed my leave-intent
edits from the shared working tree, so my commit's diff showed my own work as context. Two
sessions, one file, no rebase.

**Habit to build:** the blob trick is only safe when HEAD is re-read in the SAME command that
hashes the blob, and the commit follows immediately. And after any commit on a shared file,
`git diff HEAD~1 HEAD --stat` must show only the files I meant to touch with only the lines I
meant to change -- a removed line I did not write is somebody else's work leaving.

### 82. A CALL-SITE PIN THAT ACCEPTS ANY IDENTIFIER PINS NOTHING

The lib was proven; the test that holds the component to calling it asserted the arguments were
"derived, not literals" -- a property read or a name, never `true`. A reviewer fed it eight wrong
call sites: the Response object instead of the parsed body, `isOwner` instead of
`effectiveIsOwner`, `null` for the pending ids, `photos` for the published list. All eight are
identifiers. All eight passed. Each is a defect on every album. When every wrong name is equally
"derived", the name IS the contract, and a pin that will not say it is decoration. The same night,
a COUNT of cancel sites let the one that mattered be deleted while another was doubled.

**Habit to build:** a wiring pin names the exact argument and the exact statement around it. It
is proven the way a test is: change the call site to something plausible and wrong, and watch it
fail. "Not a literal" is not a property worth asserting.

### 83. THE DEFAULT PATH IS THE PRODUCTION PATH, AND IT WAS THE ONE NOT TESTED

The supervisor took `rand` and `pollDelay` as injectable, and every test injected them. The
"always jitters with the real random source" test called the free function's default -- which the
supervisor never reaches, because it passes its own `rand` through. A reviewer replaced that
default with a constant: 16 of 16 green, and every phone in the room reconnecting on the same
tick, the herd the module was written to prevent. Rule 16's first example, one level up.

**Habit to build:** for every injectable, one test builds the thing with NOTHING injected and
asserts the production behaviour (two runs differ; the delay is the real cadence). An injected
value proves the parameter; only the default proves the product.

### 84. "HEAD PLUS MY PATCH" IS A RACE; THE WORKING TREE WAS THE TRUTH ALL ALONG

Entry 81 named the collision. The mechanism that caused it was my own defence: building the staged
blob from HEAD's copy to keep the other session's uncommitted hunks out of my commit. Their hunks
had been committed in between, so "HEAD's copy" was older than the working tree, and my blob
carried their hunks away. What actually held the correct union was the file on disk. The safe
rule is not a cleverer blob; it is: build from the working tree, then LIST what the diff removes
and name whose each removed line is before committing.

### 85. A COMMENT STRIPPER THAT COULD NOT READ COMMENTS, AND EVERY GUARD BELOW ONE LINE WENT BLIND

`stripJsComments` was two regexes: remove `/* ... */`, then remove `// ...`. UploadZone contains
the line comment `// accept="video/*" — avoids silently accepting .avi/.mkv`. The block-comment
pass runs FIRST, so that `/*` opened a block that ran to the next `*/` hundreds of lines away, and
everything between them was deleted before any guard could search it. I found it only because a
new call-site pin failed on a line I could see in the file with my own eyes.

Seven test files use this helper, including the guard that decides which lib modules count as
tested. Any pin below that line in UploadZone was asserting against text that had been erased --
green, and reading nothing. It is the same failure the helper itself was written to fix (its own
header lists three), one level down: the tool that scopes the grep was not scoped itself.

**Habit to build:** a stripper is a scanner, not a pipeline of regexes -- one pass that knows
whether it is inside a string, a template, a line comment or a block comment. And when a pin fails
on a line that is plainly there, suspect the reader before the file.

### 86. I FIXED THE STRIPPER AND LEFT THE SAME HOLE ONE DOOR ALONG

The scanner that replaced the two regexes (entry 85) did not track REGEX LITERALS, and its own
header said so with a false reassurance: "none in this codebase carries either". A reviewer
measured it: ten files carry a regex whose escaped slash truncated the line, and one -- the
support-chat route's `.replace(/[`\s]+$/, '')` -- has a BACKTICK inside a character class. The
scanner read it as the start of a template, and a template does not end at a newline, so 77 lines
were copied out with their comments intact. Sixteen real comments survived the strip in that file.
That is the exact "a comment answers the grep" failure the helper exists to prevent, live, in the
fix for the previous instance of it.

What closed it was not a third careful implementation. It was a WHOLE-REPO PROPERTY TEST: strip
every file in src, tests and scripts, and assert that no comment line survives and no plain
statement is lost. Neither of the two bugs was reachable by an example test, because neither shape
had been imagined -- and that is the point. Reverting to the old regex fails it in both directions.

**Habit to build:** when a helper's contract is a property ("no comment survives"), assert the
property over the real corpus, not examples. And a comment claiming "this case does not occur in
this codebase" is a claim about the codebase: grep for it, or do not write it (rule 18).

### 87. THE BACKUP THAT RESTORED NOTHING, AND THE ONLY WAY ANYONE WAS EVER GOING TO FIND OUT

The restore script had been written carefully: dry run by default, insert only, ON CONFLICT DO
NOTHING, parameterised values, and a header explaining that a backup nobody has restored is a
guess. Every one of those claims was true. It had still never been run, and the first time it was,
it died on its second table and wrote nothing: the 26 August dump carries `albums.media_hover`, a
column dropped since, and Postgres refuses an INSERT naming a column that does not exist. Not a
partial restore -- nothing. On the day it mattered, with the album gone, the recovery would have
been a stack trace.

Nothing in the code was wrong. The gap was that a schema moves and a backup does not, and no test
could see that because the script connected to production the moment it was imported, so there was
nowhere to run it. What found it was booting a real Postgres in-process, building the schema from a
read-only snapshot of the live one, and restoring an actual dump into it -- twenty minutes of work
that had been described as "half a day, blocked on nothing" for weeks.

**Habit to build:** a recovery path is not written, it is REHEARSED, and the rehearsal has to use
the real artefact against the real shape. "Insert-only and dry-run by default" is a description of
intent; "11,166 rows restored and 553 fields compared" is evidence. Anything that can only be run
against production has no test, and that is a reason to inject the client, not a reason to trust
the code.

## 2026-09-10 — Circle: the bib engine

### 88. I NEARLY TALKED THE OWNER OUT OF THE ONE THING THAT FIXED THE LIVE ALBUM

Asked what remained, I wrote that the exclusion panel "won't help that album either" -- and
corrected myself in the same paragraph, because exclusions are applied at SEARCH time and therefore
work on rows indexed long before any of this shipped. The first sentence was wrong and the second
was right, and the owner had already read the first.

The cause is that I had spent two days reasoning about the INDEX-time rule, where "we are not
re-indexing VMF" really does mean "nothing changes for VMF". I carried that conclusion across to a
search-time mechanism where it does not hold.

**Habit to build:** when a decision has been settled ("we are not re-indexing"), re-derive its
consequences for each new mechanism rather than reusing the summary. The summary is about the
mechanism it was formed on.

### 89. SIX ALTERNATIVES MEASURED, AND MY OWN HEADLINE EVIDENCE WAS THE WRONG DISTRIBUTION

I refused a reviewer's recommendation to ship a line-recurrence rule, and led the refusal with the
finding that on the 69-photo album the banner year and the real bib 00663 each appeared on exactly 4
photographs. The refusal was right. The evidence was not: both candidate rules apply AFTER the line
filter, and post-filter that collision does not exist -- the banner year is gone and the bib is not.
I was quoting the pre-filter distribution for a comparison that happens downstream of it.

The reviewer supplied the argument that actually holds: a real bib appears on 1-4 photographs
whatever the album size, while any album-relative threshold scales WITH the album, so a floor safe
on 4,566 photos sits below the entire real-bib population on 69.

I also stated, and repeated to the owner, that recurrence and number-frequency are "the same
signal". Measured post-filter they are not: recurrence catches the arch year and frequency does not.
Right conclusion, wrong mechanism, twice -- and a mechanism written into a comment is what the next
reader believes.

**Habit to build:** check WHERE in the pipeline a comparison happens before quoting a distribution
at it. And when a conclusion survives having its stated reason disproved, replace the reason rather
than keeping both.

### 90. THREE TIMES I SHIPPED A ROW WHOSE MEASURED SET WAS ITS OWN DEFINING SET

"range 100-3000 removes every 1-2 digit tag" -- every 1-2 digit number is below 100 by arithmetic.
Then twice more: "excluding the top 5 most-frequent numbers removes 100% of the noise", where the
label defined noise as the eyeballed four plus anything above a frequency floor, which IS those five
numbers. Each row looked like the strongest number in the table and measured nothing.

Both reviewers caught it independently, the second time noting it was becoming a habit rather than a
slip. It is: the shape is always a filter scored against a label built from the same property the
filter uses.

**Habit to build:** before a number goes in a table, name the measured set and the defining set out
loud and check they are different sets. A row that cannot fail is not a measurement.

### 91. MY OWN GUARD READ ITS FILE THROUGH THE BROKEN STRIPPER

tests/bib-filter.test.ts greps rekognition.ts to pin the call site, and carried its own inline copy
of the two comment-stripping regexes rather than importing the shared helper. The parallel session
had just replaced that pair with a real scanner, because a `/*` inside a line comment made the first
regex swallow everything to the next `*/` -- hundreds of lines. My guard was reading a fraction of
the file and passing for the wrong reason.

I only learned it because that session mentioned the change in passing. They then grepped and
confirmed mine was the last copy in the repository.

**Habit to build:** a guard that reads source must import the repo's stripper, never carry one. And
when a shared helper is fixed, grep for the shape of the thing it replaced -- the copies are exactly
where the fix cannot reach.

### 92. TWO SESSIONS BUILT THE SAME PHASE, AND NEITHER NOTICED FOR AN HOUR

Both of us added an `excluded` member to SearchPhase and its test coverage on the same afternoon, in
the same file. It converged only because the other session's edit landed first and mine failed to
apply -- I read the file, found a comment I had not written, and only then checked ListAgents and
found four peer sessions, one named "Bib search and Face Finder reenabling".

The cost was small this time and could have been a lost afternoon. What made it small was that a
`node -e` replace printed "no change" instead of silently succeeding.

**Habit to build:** on a shared tree, `ListAgents` BEFORE picking up a feature, not after something
looks strange. And every scripted edit asserts its own needle matched -- an edit that quietly does
nothing is indistinguishable from an edit someone else already made.

## 2026-09-10 — Circle: the video lane, the money file and the album gate

### 93. I WROTE AN INCIDENT THAT NEVER HAPPENED INTO FOUR PLACES AT ONCE

Moving the video-lane rule out of UploadZone into `lib/upload/video-lane.ts`, I described it as
fixing a shipped defect: a guest tapping cancel, or a video the product refused on purpose,
collapsing the upload lane to serial for the rest of the session. It made a good story. The
distinction had been made correctly inline since the lane first shipped (68178fe, 2026-08-03), and
was broadened to the shared refusal list on 2026-08-18 -- before the refusal I named in the story
even existed as a constant.

I did not invent it out of nothing; I inferred it from the fact that the classification was
untested. Untested is not the same as wrong, and I wrote the second when I only knew the first.

The cost is not the wasted sentence. It went into the commit message, the module header, four test
names and two mutation names, and in this repository those texts are read later as evidence: the
next person deciding whether a guard matters reads "this was a shipped defect" and stops checking.
A reviewer found it with one `git log -S` on the line I had just deleted.

**Habit to build:** before writing "this was a bug" about code you are MOVING, run `git log -S` on
the line being replaced and read what it said the day it shipped. If all you can demonstrate is
that nothing tested it, then that is the sentence -- "a rule that was believed rather than held" --
and it is a good enough reason on its own.

### 94. THREE PROTECTIONS, NONE OF WHICH ANY TEST COULD TELL FROM ITS ABSENCE

One mutation run over `album-entitlements.ts` -- the file that decides what a customer's money buys
-- turned up three defensive lines that were believed and not held:

- `registeringWouldHelp` opened with `if (input.ownerTier) return false`. Replacing it with
  `if (false)` left the whole suite green, because forcing `'free'` can never raise a registered
  album's ceiling: free is the lowest per-tier cap, and every grandfather promise a higher tier
  gets, free gets too. A guard that cannot fire, sitting two lines above a comment explaining why a
  *different* guard was deliberately not added for exactly that reason.
- `videoBudgetExceeded` clamps a negative or unreadable used-total to zero. Both existing tests
  passed an in-budget clip, where clamped and unclamped answer identically. The case that separates
  them is a clip longer than the WHOLE budget: unclamped, a stored `-2000000000` buys unlimited
  video. Nothing asked.
- `PACKAGE_ITEMS_BY_TIER` reads the package catalogue rather than retyping the numbers. Every
  behavioural test passes just as happily against `pro: 5000` written out by hand, because 5000 is
  what the catalogue says today. It stops passing the day the package is repriced, which is the day
  it matters and the day nobody is looking.

All three LOOK tested. Coverage is green through every one. What separates "protected" from
"believed" is asking what input would tell the two apart -- which is what a mutation is. The same
run over `album-password` found nine more, and over `album-owner-access` five.

**Habit to build:** for every defensive line, name the input that distinguishes it from its absence
BEFORE writing the test. If there is no such input, the line is either dead code or the test is
missing, and those need opposite responses: delete it, or write the case. Deciding out loud is the
point -- a survivor quietly deleted is how a real hole gets filed as noise.

### 95. A BEHAVIOUR-PRESERVING MOVE THAT QUIETLY FLIPPED A FAIL-SAFE

Extracting `videoOutcomeOf`, I wrote `if (error === null || error === undefined) return 'clean'` at
the top. It reads as obvious housekeeping: no error means it worked. The only caller is a `catch`
block, where "no error" cannot be true -- so the branch could only ever fire on a thrown null, and
it answered that a network which had just dropped a file was healthy enough to widen the lane. The
inline code I was replacing had always called that a failure.

The two directions are not equal, which is the whole of rule 19: a wrong `'failed'` makes uploads
serial, and a wrong `'clean'` puts more of them on a connection that is already losing them. I
turned the safe direction into the unsafe one while believing I was changing nothing.

**Habit to build:** in a refactor, list the inputs the OLD code could receive and check the new
answer for each, especially the ones that look impossible. And when adding a "nothing went wrong"
branch, find the caller first: if it is a catch block, that branch is not housekeeping, it is a
guess about a value that should never arrive.

### 96. TWO SESSIONS NUMBERED INTO THE SAME FILE AND MADE FIVE ENTRIES AMBIGUOUS

The bib circle was appended as entries 64 to 68 while entries 64 to 68 already existed 400 lines
above, so this file -- whose entire job is to be cited -- had five duplicate numbers, and two
comments in `scripts/mutations/` that say "MISTAKES 68" stopped naming one thing. Neither session
did anything careless; both counted from what they could see, and appended.

The later block was renumbered to 88-92 rather than the earlier one, because the earlier numbers
are the ones already cited from code.

**Habit to build:** on a shared tree, a numbered list is a shared counter. Read the LAST heading in
the file before writing a new one, not the last heading in the section you are adding to -- and when
citing an entry from code, cite the title as well as the number, so a renumbering cannot silently
redirect the reference.

### 97. I KILLED MY OWN MUTATION RUN, THEN BUILT A RECOVERY THAT INVENTED SURVIVORS

Two mistakes in one hour, and the second was caused by fixing the first.

I started a mutation run by accident -- passing a flag the runner did not know, which it filtered
out, so it ran every set instead of printing a list -- and stopped it from the task manager. The
runner restores in a `finally` and on SIGINT; a task-manager stop is neither. It left
`src/lib/media-settings-diff.ts` holding `const carried = {}` in `revertMediaSave`, which throws
away a guest's in-flight settings on a failed save. It type-checks. It reads as ordinary code. The
only reason it was found is that `git status` was read within the minute; the next commit would
have shipped it, and the mutation set that proves that line matters would have gone on passing,
because a mutation set proves the TEST notices, not that the code is right.

So I added a note on disk, written before the file is touched, that the next run reads and repairs
from. And it made things worse, because two sessions share this checkout. With one fixed filename,
my run started while the other session was mid-set, read ITS note, restored the file it was in the
middle of testing, and deleted the note. The mutation vanished from under a running vitest, the
tests passed, and two mutations that had been killed an hour earlier were reported SURVIVED. I very
nearly went looking for the missing test.

A recovery that invents survivors is worse than no recovery at all. A survivor is a finding, and a
finding costs an afternoon -- rule 12b says exactly this about review agents and it is just as true
of tooling.

A third thing was assumed rather than measured, and it is the reason the note on disk is not
belt-and-braces but the whole mechanism. I added handlers for SIGTERM, SIGHUP and SIGBREAK on the
theory that the first mistake was only about SIGINT. Later the same evening I had to stop another
run and did it with `process.kill(pid, 'SIGTERM')` -- and the file was left mutated again. On
Windows that call maps to TerminateProcess, which is not catchable; the handler never ran. The
recovery note is what brought the file back, in a real incident, ten minutes after being written.

**Habit to build:** anything that writes to a shared working tree names its file after its own
process, and checks whether the owner of a foreign file is still alive before touching it. A flag a
tool does not recognise is an error, not something to filter out and carry on: "unknown argument"
would have cost nothing, and silently running the whole suite cost a mutant on disk. And a cleanup
path that depends on a signal handler is a hope, not a guarantee -- write down what you are about to
do before you do it, so the next run can finish the job.

---

## 2026-09-11 — I fixed the screenshot, and left three of the same bug behind it

The owner photographed one symptom: an excluded number reduced to a struck-through digit string,
blank thumbnail, no count, sunk to the bottom. I found the cause quickly and correctly -- the panel
built its rows from the CANDIDATE list, and an excluded number is correctly not a candidate.

What I did not do was ask what else that mistake implied. All four findings a review agent returned
were the same error wearing different clothes: **two things comparing the same number by TEXT when
the rest of the feature compares by VALUE.**

- The route's `addsSomething` gate used `current.includes(n)`. With any non-canonical spelling in
  the column, a pure REMOVAL reads as an addition and the tier gate refuses it -- the exact failure
  the comment three lines above it says must never happen, sitting three lines above it.
- The tally RPC groups by the literal OCR string, so `2026` and `02026` arrive as two tallies and
  became two rows for one number. That is the *same symptom the owner had already photographed*, one
  layer down. I had just written the comment saying one row per number and did not check the input.

I wrote `numericKey` and `isExcludedNumber` for precisely this, used them in the component, and then
did not grep for the remaining text comparisons in the same feature. Extracting the rule is half the
work; **the other half is finding every place that was doing it by hand**, which is rule 15 stated
about decisions and is just as true of comparisons.

**The two mutations I would never have written.** The agent found that the collapse/reveal had ZERO
coverage -- no test built more than two rows, so deleting the `+N` button hid every row past the
sixth, exclusions included, with the suite green. And `albumPhotoCount` was never passed by any
test, so the bar's real branch never ran. Both are the shape of rule 16's own examples: the test
exercises the path that is easy to set up, and production takes the other one. My own mutation sets
covered every line I had thought hard about and none of the ones I had not.

**Three of my own mutations were bad, in three different ways**, and each cost a cycle:
`0 || new Set(...)` is a no-op; a fixture whose "duplicates" were identical strings collapsed in a
`Set` before reaching the code under test; and one anchor still named a line I had edited, which the
runner correctly reported as DID NOT APPLY rather than pretending. A mutation that cannot change
behaviour is not evidence, and a SURVIVED line means *either* a weak test or a weak mutation -- I
assumed the first both times and it was the second.

**Rule 24 caught me twice in one session**, both through a Python heredoc: `\n` inside a mutation
string became a real newline and broke the module, and `\'` inside a test name vanished and broke
the parse. Both were invisible in the diff. The fix both times was to stop needing the escape --
anchor on a single line, and write a title that has no apostrophe in it.

**What I got right and want to keep:** I did not add a compatibility alias for the renamed response
field. I measured first -- 2 albums have bib search on, 1 has exclusions, out of 168 -- and a
transitional field that two owners would benefit from for one deploy cycle is permanent debt bought
with rule 13. But the investigation was still worth it: it found that ANY malformed 200 (a captive
portal, a truncated body) crashed the owner's whole album page, because `ErrorBoundary.tsx` exists
in this repo and is imported nowhere. That one is unbounded, it had nothing to do with my change,
and I would not have looked without chasing the bounded one.

**Habit to build:** when a bug turns out to be "these two things disagree about what X is", the fix
is not done until I have grepped for every other comparison of X in the feature and either imported
the shared rule or written down why it cannot. And before believing my own mutation set, check the
easy-to-set-up path is not the only one any test takes -- count the fixtures, not the assertions.

### 98. THE RECOVERY WORKED, AND THEN MET THE ONE STATE IT COULD NOT ACT ON

The note-on-disk mechanism from 97 did its job twice in a day. The third time it met its own gap: a
run killed part-way through writing the note left a file that was zero bytes of valid JSON, sitting
beside a perfectly good backup. The recovery refused -- correctly, because it cannot know which file
a backup belongs to without the note -- and printed "check git status, then delete it".

That is the safe direction and it is still a failure, because the safe direction here means a human
compares byte counts by hand to work out which of two candidate files is holding a mutant. I did
exactly that: the backup was 5,165 bytes, `throughput.ts` on disk was 5,156, and the nine missing
bytes were `/ 1000` -- a mutation that makes every reported upload speed a thousand times too small.
It would have been committed inside the hour.

The fix is one line and I should have written it first: the note goes to a temp name and is put in
place with a rename. A rename on one filesystem cannot be observed half-done, so the note is either
absent or whole, and the state that needed a human cannot exist.

**Habit to build:** when you write a marker so that a later process can clean up after a crash, ask
what happens if the crash lands DURING the marker's own write. Two writes where one must imply the
other is a rename, not two writes. And a recovery path that ends in "a human will work it out" is
not finished -- it is the failure mode with better manners.

### 99. I TESTED WHAT THE GATE DECIDED AND NOT WHAT IT SAID

Three test files for the three album gates, twenty-plus cases each, every refusal checked for its
KIND and its REASON. Not one of them read the sentence. So rewording the reveal refusal to "Enter
the album password before adding photos" passed the entire suite — a guest at a sealed album sent
looking for a password that does not exist (rule 20), and nothing red.

It is worse than a bad sentence. That exact wording is a prefix in upload-policy's
EXPECTED_REFUSAL_PREFIXES, which is how the product knows a refusal was deliberate. Reword it and
the refusal stops being recognised: it files as an ERROR in the admin panel, and it reads as a
network failure to the video lane, which collapses that guest's uploads to serial for the rest of
the session. One string, three consequences, and I had already written the comment explaining that
coupling in album-entitlements the same week — where VIDEO_ALBUM_FULL_PREFIX is imported rather
than retyped precisely so this cannot happen.

I knew the mechanism and did not look for it one file away.

**Habit to build:** when a function returns a MESSAGE as well as a verdict, the message is part of
the contract, not decoration — assert it. And when any string is matched on by prefix somewhere
else, its test asserts the match too, in the same breath: `expect(isExpectedRefusal(res.error))`
costs one line and is the only thing that connects the two files.

## 2026-09-12 — The panel's 23 errors, read properly this time

### 100. I RECLASSIFIED WHAT I SHOULD HAVE FIXED, AND NAMED CAUSES WITHOUT READING THE ROWS

The user asked why the panel held 23 errors. I read the grouped counts, saw "Fetch is aborted" and
"Album upload rate limit reached", and within minutes had a story for each: guests closing a tab,
and our own limiter saying slow down. Both stories led to the same fix, filing them as warnings, and
I built it, tested it, mutation-tested it (every mutant killed), and told the user "four of the 23
were cancels".

Neither story survived the raw rows. The "cancels" carried a path suffix that fetchWithRetry only
ever adds when the caller did NOT cancel, and one had waited 31 seconds: the 30-second budget every
Chrome "Timed out" row shows. They were our own timeout, which that iPhone reported as a bare abort,
and the misreading meant the loop never waited for the connection and never parked the photo. The
rate limit fired on two albums that had filed album-full refusals minutes earlier: presign was
handing slots to full albums, the bytes went to R2 with no row to reference them, and the budget
eventually refused the rest with the wrong words. Filing either as a warning would have hidden a
real defect behind a quieter label. That is rule 9, verbatim.

What made it worse is that everything I ran was green. The mutation run proved my classifier did
what I said; it could not prove that what I said was true.

**Habit to build:** before naming the cause of a panel row, read the whole row (context,
waitedSeconds, UA, album) and the rows beside it in time. A grouped count is a headline, not
evidence. And when a fix makes an error quieter rather than making it not happen, stop: that is the
shape rule 9 forbids, and it needs evidence that nothing failed, not an absence of evidence that
something did.

### 101. MY OWN ERROR REPORTER SENT AN OWNER'S KEY TO THE DATABASE

Rule 25 rests on one fact: an owner token lives in the URL fragment, and browsers never send a
fragment to a server. The error reporter sent it anyway. A window error's `filename` is the whole
page URL, fragment included, and it was stored in error_events verbatim. Found by accident while
reading an unrelated row: a live `#owner=` token, readable by anyone with the admin panel.

No test looked at what leaves the browser. Every reporter test asked whether a report was sent and
at what level; none asked what was in it. The rule and the reporter were each written knowing
nothing of the other.

**Habit to build:** anything that sends browser state to a server (telemetry, analytics, error
context) is an exfiltration path, and gets a test that reads the actual request body for secrets.
Strip at the server as well: a tab running last week's bundle keeps sending what that bundle sent.

### 102. A COMMENT OF MINE GAVE A REASON THAT WAS NOT TRUE

In the URL-stripping fix I wrote that stripping before the clamp meant "a cut can never leave half a
fragment behind for the strip to miss". Writing its test, I found that false: the strip removes
everything from the `#` onward, so a clamped half-fragment goes just the same, and either order is
safe. The real reason is smaller (the room the fragment took goes to whatever follows it), and that
is what the test now proves.

A wrong reason in a comment is worse than none. It is the sentence the next person trusts instead of
checking, and it would have defended the code's order for a reason that does not exist.

**Habit to build:** a comment that says WHY is a claim, and gets the treatment code gets: write the
test that would fail if it were false. If no such test can be written, the comment should say less.

### 103. A TEST THAT MUTATED A FILE ANOTHER TEST WAS READING

tests/mutation-runner.test.ts proves the runner puts back a file that a killed run left mutated. To
do that it mutated a real one — scripts/mutations/run.mjs — appending a comment and restoring it a
moment later. tests/helpers/source-text.test.ts walks every file in src, tests and scripts asserting
that no comment survives its stripper. On 2026-09-12 the two ran in parallel workers, the scan read
run.mjs inside that window, and the suite failed pointing at a file nobody had touched.

The next run was green, and that is the expensive part. A suite that fails at random teaches
everybody to run it again, and the day a real failure lands, it gets re-run too. I nearly did
exactly that: my first thought was that the multi-line JSX comment I had just written was somehow
unstrippable, which would have been a fix aimed at the wrong file.

The victim is now a fixture under tests/.tmp — a directory that walker skips, because it ignores
names beginning with a dot, and one that is not inside scripts/mutations, so it cannot be mistaken
for a mutation set either.

**Habit to build:** a test that writes to a path inside the repository shares that path with every
other test in the suite. Write to a fixture nothing else reads, and when something must be proven
about a real file, prove it against a copy.

### 104. I PICKED A STATUS OUR OWN CLIENT RETRIES, AND THIS CODEBASE HAD ALREADY DECIDED IT TWICE

The new full-album refusal at presign returned 429, because photos/create returned 429 and I matched
it without asking whether that number was right. `lib/upload-policy` treats a 429 as retryable, so
every photo added to a full album ran the whole route four times behind a backoff: four per-IP
limiter slots on a venue that shares one IP, four album reads, four tier lookups, four `count(*)`
scans — four times the fuel that produced the wrong "Album upload rate limit reached" I was fixing.

The answer was already in the repository, written twice. `video-upload-authorization` refuses the
same class with **403** and the comment says exactly why: *"429, NOT 403. lib/upload-policy treats
429 as retryable and runs the whole route four more times behind a backoff — for a refusal that is
permanent until somebody deletes something."* The stream route repeats it. I grepped for the
refusal's WORDS (rule 13) and never grepped for its STATUS, so I copied the one door that had it
wrong and left three doors disagreeing.

Two reviewers found it independently, which is the part worth remembering: it was not subtle.

**Habit to build:** a status code is part of the contract, not decoration. Before choosing one for a
refusal, grep for the same refusal elsewhere and match the door that wrote down its reasoning — and
ask what OUR OWN client does with that number, because for anything the uploader calls, we are the
other side of the contract too.

### 105. I WROTE A COMMENT CLAIMING A GUARD WAS AUTHORITATIVE, IN THE SAME CIRCLE AS MISTAKES 102

The cap check read `if (tierRes.tier !== null && ...)` and my comment said it therefore only ran on a
KNOWN tier — that a failed tier lookup could not call a Max album full at the free allowance. It
could. `getUserTierById` returns `'free'` when the subscriptions query ERRORS (it logs, refuses to
cache, and answers the default); it throws only when the client itself throws. So during one
database blip a Max album holding 600 of its 10,000 photos would be refused as full at 500, with an
"Upgrade your plan for more space" nudge shown to somebody already on the top plan.

`lib/subscriptions` even exports `getUserTierResolved`, whose docblock names this exact class — *"any
gate whose refusal is silent must use this and treat `authoritative: false` as a failure to answer
rather than as a no"* — and nothing in the codebase used it. The existing test for the case drove a
`throw` that the function never performs, so the hole was covered by a test that could not see it.

I checked that the lookup COULD throw and stopped there. I never read what it does when the query
merely fails. And I wrote the false comment in the same circle in which I recorded 102, about a
comment giving a reason that was not true.

**Habit to build:** when a comment claims a branch cannot happen, read the function it rests on to
the end of its failure path. "Degrades to a default" and "throws" are different failures and only
one of them is visible at the call site — and if a module exports a resolved/authoritative variant,
that is the author telling you the default one lies about certainty.

### 106. I GATED ON WHETHER THE ANSWER WAS TRUSTWORTHY, NOT ON WHETHER IT WAS USED

Fixing 105, I made the cap enforceable only on an `authoritative` tier. Correct question, wrong
scope. `albumCap` returns on an override **before it ever reads `ownerTier`**, and an anonymous
album is sized by `ANON_ALBUM_MEDIA` whatever any lookup says. For those two shapes the tier is not
an input at all — so refusing to enforce the cap "because the lookup was not authoritative" is
refusing on the strength of an answer that was never consulted.

The consequence was the defect the whole commit existed to close, reopened by its own fix: on an
override album during a degraded lookup, presign ALLOWED and photos/create still refused. Bytes in
R2, no row, nothing that can ever find them.

The knowledge was one file away, in the code I was copying. photos/create wraps its lookup in
`if (!hasOverride && album.user_id)` — it skips the tier entirely for exactly these shapes. I read
that block closely enough to mirror its `tierKnown` flag and not closely enough to ask why its
condition was there.

**Habit to build:** when you copy a guard from a sibling, copy its CONDITION and find out what the
condition is protecting — an unconditional version of a conditional guard is a different rule
wearing the same name. And keep the two questions apart: "can I trust this value?" is not "does
this value decide anything here?", and only the second one licenses skipping enforcement.

### 107. I ADDED A SECOND DOOR INTO A STATE, AND NOT AN EXIT FROM IT

The upload wall was only ever raised where rows had been queued, and finishing those rows took it
down — one producer, one terminator, and they were the same code path. I added a second producer
(a full album refused at presign, which queues nothing) and never asked what would take it down.
Nothing could: the only reset lives inside `retryBlockedRows`, behind an empty-queue early return,
behind a button that is not rendered when the queue is empty. The owner frees space, the guest
re-adds the photos, they upload and save — and "This album has no room left" sits above the green
tiles until the page is closed. Rule 20, written by me, in the same week I quoted it.

What hid it: `wallCopy` is pure and exhaustively tested, and every one of those tests passes. The
lifecycle — when the reason is set, when it is cleared — lived in the component, where nothing tests
anything. A reviewer found it in the one place rule 14 says to look.

**Habit to build:** adding a producer of a state means finding its terminator in the same change.
Ask literally "what takes this down, and can that thing run from here?" — if the answer is a control
this new path does not render, the state has no exit. And a pure function tested to exhaustion says
nothing about the machine that calls it.

### 108. I COMMITTED A MUTANT, BECAUSE MY GUARD ASKED THE WRONG QUESTION

Three mutation sets were running in the background. Before committing I checked the log for
`SURVIVED`, found none, and committed. The log said:

```
== upload-policy: ... (47 mutations)
ALL MUTATIONS KILLED
[exit 0 for upload-policy]
== image-upload-authorization: ... (37 mutations)
```

No failure line — because that set had not finished. It had not even reached its first verdict. My
guard could not tell "nothing failed" from "nothing has happened yet", and those two look identical
in a log that only prints on failure. `git add` then staged `image-upload-authorization.ts` with
mutation 12 live on disk, and the commit carried it:

```
-  const gate = await gateAllowsContribution(album, ...)
+  const gate = await gateAllowsContribution({ ...album, id: 'other' }, ...)
```

That is the password/reveal gate for contributing, evaluated against an album that does not exist,
inside a commit whose message is about file types. It was caught before the push, so nothing reached
a customer.

What hid it, and this is the part worth remembering: the runner restored the file a few seconds
later. So the working tree was CORRECT and HEAD was WRONG — the inverse of every other mistake in
this file. `git status` was clean for that path, a `git diff` showed nothing to worry about, and the
only copy of the mutant left anywhere was inside the commit. The evidence deletes itself.

A second mutant from the same run cost time in the other direction: `tsc` reported
`Property 'retryAfterSeconds' does not exist on type 'RateLimitResult'`, and I was one step from
investigating a type error that did not exist. While a set is running, EVERY tool that reads source
is reading fiction — the compiler included.

**Habit to build:** a guard on a background job must test for COMPLETION, never for the absence of
failure. For the mutation runner that is two concrete checks, both cheap: `scripts/mutations/.in-flight.*`
must not exist, and the log must carry one `[exit N for <set>]` line for every set requested. Until
both hold, there is no staging, no committing, no full suite, and no believing tsc.

### 109. A FLAG THAT IS ONLY EVER SET IS NOT A FLAG ABOUT NOW

I added a guard that reads `lastWasNetwork` as "the last thing that happened was the network":

    if (lastServerRes && !lastWasNetwork) return lastServerRes

and wrote a comment above it saying the retained answer is good "ONLY WHILE IT IS STILL THE LATEST
THING WE KNOW". But `lastWasNetwork` is initialised once and assigned in exactly ONE place -- inside
the `catch`. The branch that receives a response never touches it. So it does not mean what I read
it as; it means "at some point in this call, an attempt died at the network". Sticky, for the rest
of the call.

The case I was thinking about (5xx, then the network dies) works. The mirror does not: the
connection drops, the reachability probe confirms the origin is back, the retry returns a 503 that
is retained, the budget runs out -- and my guard throws that fresh 503 away and reports
`unreachable: true`. The guest is told "Couldn't reach the server after several tries. Switch
networks, or turn off any VPN" milliseconds after the origin answered them, the file is parked, and
the auto-resume then spends a whole second upload against an origin that is already failing.

I had written the correct rule in English directly above code that implemented a weaker one. The two
coincide in the ordering I had in mind and part company in the other, which is why reading it back
felt fine.

A review agent found it. I confirmed it in one grep before believing it -- five lines of output,
every mention of the variable -- which is the right amount of work to spend on an agent's diagnosis:
enough to be sure, not so much that I re-derive it and re-attach to my own version.

**Habit to build:** when a new condition leans on an existing variable, find EVERY assignment to it
before trusting its name -- `grep -n <name> <file>` is the whole cost. And when a comment states the
rule ("only while it is still the latest"), check that the code implements THAT rule rather than one
that merely agrees with it in the example you had in your head.

### 110. I READ A ROUNDED FIELD AS A RAW ONE, AND STARTED BUILDING ON IT

Investigating error_events 1226 -- "Missing or invalid fields", a message this product had never
emitted before -- I saw `sizeMB: 0` in the context and read it as "the file was zero bytes". It fit
so well: a decode failure seconds earlier on the same device, presign refusing `fileSize <= 0`, six
photos saved with no dimensions. I had a chain, and I said so out loud before checking the field.

`sizeMB` is `Math.round(entry.file.size / 1024 / 1024)` (UploadZone.tsx:1390). It is the ORIGINAL
file the guest picked, not the processed blob presign is told about, and it is rounded to whole
megabytes. `sizeMB: 0` means "under half a megabyte". It does not mean empty, and it says nothing
whatever about the number presign actually rejected.

Two things saved this. First, I traced the field to where it is computed instead of continuing --
one grep. Second, the fix I had already designed did not depend on the guess: the guard covers every
condition presign refuses on (size, name, type), so it is correct whichever of them fired. That is
luck standing in for method, and the commit message says so rather than claiming the diagnosis is
proven.

This is MISTAKES 100 in a smaller costume. There I read a grouped COUNT as a cause; here I read a
ROUNDED, DERIVED field as a measurement. Both times the number was real, the arithmetic behind it
was invisible, and the story it seemed to tell was the one I was already looking for.

**Habit to build:** a telemetry field becomes evidence only after you have found the line that
COMPUTES it. Rounded, derived and renamed values answer a different question than the one being
asked of them -- and the more neatly a number fits the theory, the more it is worth the one grep it
takes to learn what it measures.

### 111. I WROTE THE COMMENT FOR THE CODE I MEANT TO WRITE -- TWICE, THE SECOND TIME INSIDE THE FIX

A new module, lib/upload/presign-fields, opened with: the rules live here "once... both sides can
import" them. A review checked, and they did not. All three upload doors still carried hand-written
copies of the same four conditions, nothing imported the module but the uploader, and no test
asserted they agreed. The reviewer's reproduction was one line: change MAX_FILE_NAME_LEN to 280 and
every test stays green while the client waves through names all three doors refuse.

That is entry 109 again -- a comment stating a stronger rule than the code implements -- one circle
later.

Then I did it a second time in the patch that fixed it. I adopted the predicates in the three routes
and wrote, in the same breath: "tests/presign-fields.test.ts reads the three route sources and fails
if one grows its own copy again". I had not written that test. I caught it re-reading my own patch
before running it, which is luck rather than method -- the comment would have shipped as another
claim with nothing behind it.

WHY IT KEEPS HAPPENING. I write the comment while thinking about the finished shape, and the comment
is finished before the code is. It then reads as true to me forever after, because it describes what
I meant. The only reader it misleads is the next one -- including me, later.

The test I eventually wrote found a FOURTH copy on its first run: presign's paired-thumbnail check
retypes the same size rule and adds a ceiling of its own. That is what a claim is worth once
something can check it, and what it is worth before then.

A smaller lesson from the same hour: my anchor checker (scratchpad/check-anchors-guard.mjs) validates
every mutation's `from:` and nothing else. A rename left one mutation with a `from:` on the new
identifier and a `to:` still on the old one -- so it applied cleanly, produced code referencing a
name that does not exist, and would have been reported KILLED for a compile error rather than for
the reordering it claims to prove. A mutation that dies for the wrong reason is worse than none,
because the log says the test is strong.

**Habit to build:** a comment that asserts something is ENFORCED must name the thing enforcing it,
and that thing must exist and have been watched to fail before the sentence is allowed to stand. If
the enforcement is not written yet, the comment says what is true today -- or it is not written yet
either. And check both halves of a mutation after any rename, not just the anchor.

### 112. I BLAMED ANOTHER COMMIT FOR MY OWN CHANGE ALREADY BEING THERE

A patch script aborted on a missing anchor: the import line it wanted to edit was not in
`upload-policy.ts`. I said the cause was almost certainly that a commit made outside my context had
edited that line, and went off to re-read the file and rebuild the anchor.

Wrong. My own script had already run four minutes earlier and applied the whole change. The anchor
was missing because it had been consumed -- by me. `git diff` showed all seven files carrying my own
comment text, and every mtime identical to the second.

What made the wrong answer feel like the careful one: the session had restarted, three commits HAD
landed outside my context, and `git status` HAD reported a clean tree a few minutes before. Every
one of those was true, and not one of them was evidence for the conclusion I drew from them. It also
wore the costume of good practice -- "re-read rather than adjust by guess" is the right instinct, and
I used it to justify skipping the one command that would have answered the question.

A missing anchor has exactly two causes: someone else moved it, or you already applied it. The second
is the one you can confirm instantly, from your own working tree, and it is the one to check first.

**Habit to build:** when a patch anchor does not match, run `git diff` BEFORE forming any theory about
why. Not `git status` -- the diff, because it shows whether the new text is already sitting there in
your own words. And note what saved this from becoming real damage: the script defers every write
until all anchors match, so the failed second run wrote nothing at all. Without that, the re-run would
have appended a second copy of the constant to a file the first run had already finished editing.

### 113. THE COMMENT SAID THE STEP RAN FIRST. IT RAN FIFTH, FOR SEVENTEEN DAYS

`.github/workflows/backup.yml` carried this, in capitals, directly above the step it describes:

    # CHECKED BEFORE THE DUMP, not after it.
    # ...Failing on the FIRST step names the actual problem in the first ten seconds of the log
    # instead of at the last line, and it does not waste a database dump to tell you.

The step was appended AFTER the dump. GitHub runs steps in file order, so every nightly run made a
full database dump and only then discovered whether the R2 secrets it needed even existed. Written
on 2026-08-26 by the commit whose subject is "Make a failed backup visible, because two nights of
them were not" -- the fix for that incident, describing itself correctly and doing the opposite.

The catastrophic outcome was never reachable: backup-upload.mjs carries its own two guards and the
upload step still runs last, so no dump could reach the public bucket. What was lost was the fast,
honest signal -- exactly the thing the commit had been written to buy.

Third instance of entry 111's shape, and it adds something that one did not. This comment was not
merely wrong, it was REASSURING. It read like a verification that had already been performed, in
capitals, with a rationale attached. Anyone opening the file -- me, three times, while working on
other things -- read the claim and stopped looking. A confident comment about the file it sits in is
read as evidence, and it is not evidence.

I found it by accident, seventeen days later, while reading the file for an unrelated reason.

**Habit to build:** a comment that asserts an ORDER, a precedence, or any invariant about the file it
lives in is a test waiting to be written -- and in this repo, every other guard already is one.
`tests/ci-workflows.test.ts` now holds four: the secrets check precedes the dump, the recovery-file
check runs last, the dump is never published as an artifact, and deploy.yml's deliberate asymmetry
(database.ts drift is fatal, schema.sql drift is not) stays deliberate in both directions.
