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
