<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

We are making Hushare app and there are a few rules you SHOULD know, and ALWAYS keep them (when you want/need to pivot from the rules, IT IS IMPORTANT to ask me.)
1. review your code changes after each change - every single change can affect other part of the code without you even knowing it, you should be responsible for it, and try to make less errors/logical bugs.
2. ALWAYS ask a questions if even the smallest detail is unclear - you can ask even 200 questions, I would be more than happy to answer them.
even if you're working and have a question mid work - STOP THE WORK AND ASK IT!
3. we are building a website where.
speed
security
architecture
optimization
UI/UX simpleness

is THE MOST IMPORTANT THINGS.
and they sould be world class level, the BEST.
4. when I ask you to rate {smth}, you should always rate is as BRUTALLY as you can, I don't need you to be kind to me, if it's bad then tell me it's awful.
WE NEED STRICT JUDGEMENT.
5. do NOT do things because i said so - if you know better way, then FIGHT for it, prove it!
6. if i ask ANY question about code, architecture, security, speed, optimization e.t.c. you should NEVER lie to me, NEVER. you should realistically view the question and answer it with the brutalest way possible, we're here not to lie to each other. we need work to be done.
7. ALWAYS keep in mind that when you're working on some feature, you should NOT break another one without even noticing. after new feature, code update, change. ALWAYS review what could possible gone wrong? and check it.
8. IMPORTANT - when you're explaining / describing smth - explain it with easy words, like you're explaining it to 5 years old! i don't need childish examples, i need eas words.
9. When i send you an error, or we're just fixing something - YOU SHOULD fix it, NOT reclassify it. When we have an error - we NEED to think of permanent solution.
You CAN spend as much time as you need, check as many times as you need, ask as many questions as you need - just remember - we NEED a PERMANENT fix to that issue.
IF that's NOT possible then notify me and we'll think of something else.

10. USE AGENTS TO REVIEW YOUR OWN WORK. When you have changed something and it is not behaving as
expected — especially after ONE failed fix — stop iterating alone and launch a subagent to review it
with fresh eyes. You are the worst possible reviewer of your own reasoning: once you have a theory
you will keep finding evidence for it and keep shipping fixes to the wrong thing.

11. if you fixed some error or warning in the website that is in admin page's panel, you should clean it, so you can notice if something's new is off.

12. A NEW ERROR OR WARNING IN THE ADMIN PANEL IS YOUR JOB, NOT A QUESTION FOR ME. If one appears,
investigate it and fix it without asking permission. Do not report that it exists and wait — read
it, find the cause, fix the cause, and tell me what it was afterwards. Asking "want me to look at
this?" makes me do the remembering, which is the part I delegated.

The same applies to anything you notice while working: an error, a wrong number on a page, a
promise the code does not keep. Fix it, then tell me. Ask only when the answer would change what
you build, or when the action is destructive or outward-facing.

If the cause turns out NOT to be ours — a browser bug, an injected extension script — say so
plainly and filter it so it stops filling the panel, rather than leaving it there to be re-read
every time.

The rule of thumb: **one failed fix is a mistake, two is a signal to get another pair of eyes.** Do
not spend a third attempt on your own hypothesis.

This applies to bugs, but also to anything shipped that a customer touches — an upload path, a
payment path, a deletion path. An adversarial review of a change costs minutes; a defect found by a
paying customer costs their trust, and you may never learn it happened.

---

# Architecture rules, learned the hard way

Every rule below exists because it was broken here and it cost something real. They are written as
rules rather than advice because the failures they describe are all SILENT: nothing throws, no error
appears in the panel, and the first person to find out is a customer.

## 13. One fact, one place. If it is written twice, they WILL disagree.

Not a style preference. Every worst bug in this codebase has been this exact shape:

- **Which plan a feature needs** was written 5 times in 4 mechanisms. Result: the server refused to
  remove Hushare branding while the client showed an ordinary switch, so a free owner flipped it and
  learned it was paid from the error that came back. The album logo and sponsor marks were the same.
  Now `lib/plan-gates.ts`, with every enforcement site held to it by `tests/plan-gates.test.ts`.
- **Which files an album owns** was written twice and BOTH copies were wrong, in opposite
  directions: deletion never removed logos, headers or sponsor marks (leaked into R2 forever, with
  the album row gone so nothing could ever find them), while the storage audit reported every live
  background, header and avatar as an orphan — in a tool built to decide what to delete. Now
  `albumAssetKeys()`.
- **The free video cap** was typed into three translations. English was corrected 50 MB → 200 MB;
  Russian and Armenian kept 50. Those visitors read a limit a quarter of the truth, below an
  ordinary phone clip, on the page where someone decides whether to bother at all.
- **Which URLs the app owns** was hand-maintained and missed six real pages. A paid custom URL could
  be set, save successfully, and resolve to a marketing page instead of the album.

**The rule:** before writing a constant, a limit, a tier, a list of allowed things, or a user-facing
number — grep for it first. If it exists, import it. If it genuinely cannot be imported (a Worker
cannot read the filesystem; a translation cannot import a module), write a TEST that asserts the
copies agree, and make that test read the real source rather than a copy of it.

## 14. A decision inside a big component is a decision nobody can test.

Measured 2026-08-30: `src/lib` was 6,616 lines behind 139 tests; `src/components` was 18,914 lines
behind 7. Every defect two adversarial reviews found that week sat in a component or a route
handler. Not one was in `lib`. That is not luck — it is the untested surface.

**The rule:** when a component decides something from several pieces of state, the decision goes to
`src/lib` as a pure function and the component calls it. The I/O stays where it is; the judgement
moves. `tests/architecture.test.ts` enforces both halves: the largest files may not grow, and a new
module in `src/lib` arrives with a test.

## 15. Extract the decision AND its enforcement, or you have tested nothing.

The settings debounce decided "wait 1,400ms" inside a tested module, while the `clearTimeout` that
made it ONE fetch instead of one per broadcast stayed behind in the component. Deleting that single
line restored the original glitch and passed all ten tests.

**The rule:** if a rule needs a timer, a cancellation, or a cache to hold, that machinery belongs in
the module with it. A test that cannot observe the enforcement is decoration.

## 16. Break every test on purpose before believing it.

This has caught a weak test EVERY time it has been run, including on tests written minutes earlier:

- A test named "ALWAYS adds jitter — this is the thundering-herd guard" passed fake random values in
  explicitly, proving the parameter worked and nothing about the real path. Replacing the default
  with "always return zero" left the suite green — every phone in a room retrying in lockstep, the
  exact failure the test was named after.
- `tests/index-budget.test.ts` re-implemented the cron's arithmetic in order to check it, and
  re-implemented it BETTER than the code. 8/8 green against a cron that skipped face indexing on
  every single tick.
- A guard that reads as obviously sensible (`if (!windowPhotos.length) return prev`) passed all nine
  photo-window tests, because not one of them ever passed an empty window.

**The rule:** after writing a test, change the code it covers so it is wrong, and watch it fail. If
it still passes, the test is worse than useless, because it is believed. **Assert that the mutation
actually applied** — a string replacement that silently matched nothing makes the whole exercise
meaningless, and has twice produced a "proof" that proved nothing.

## 17. A test that re-implements its subject tests the re-implementation.

If a test needs the same arithmetic as the code, the code must export it and the test must import
and run it. Copying the logic into the test yields a suite that stays green while the product is
broken. See rule 16's second example — that is exactly how it happened.

## 18. Verify against reality, not against names.

- `thumb_path` is NULL on all 13,764 photo rows; thumbnails are found through `thumb_url`. A
  deletion built on the column name would have orphaned every thumbnail in the bucket.
- "No subscription row" is not "no plan" — admin accounts resolve to Max inside `computeUserTier`.
  Reading the table, seeing no row, and reporting "your account has no Max plan" was simply wrong.
- `sponsor_logos` is jsonb, so its `url` field can hold a number. `startsWith` on it throws — in the
  middle of deleting an album.

**The rule:** check the live database and the actual literals. Never infer a value from a variable
name, a comment, or the pricing page.

## 19. Fail safe, and say which way it errs.

`r2KeyFromUrl` returns null rather than guessing when it cannot parse a URL. Orphaning a file costs
$0.015 per GB per month. Deleting the wrong one is somebody's wedding, and there is no backup.

**The rule:** when a decision could destroy customer data, the uncertain branch does nothing. State
in the code which direction it errs in and what each direction costs.

## 20. Never state a negative you cannot back up.

"No photos found" while a search is still in flight is the worst string this product can print — a
runner reads it and stops looking. It shipped on the primary path of a 5,000-photo race album,
because every pure function involved was correct and nothing could render a component.

**The rule:** a UI may assert absence only when it holds a final answer. "Still looking", "could not
search", and "nothing found" are three different states and must look different.

## 21. Deploying is customer-visible. Never during an event.

A deploy invalidates the chunks that open tabs are still loading. It self-heals through a one-shot
reload, but during an event that reload lands on someone mid-search or mid-upload. Seven deploys in
one day produced measurable chunk-404s in the error panel.

## 22. Wall-clock time goes backwards.

`Date.now()` moves when a phone takes an NTP correction or crosses a timezone. A debounce computed
from it deferred a refresh by (quiet window + the size of the jump): an hour-long jump deferred an
hour, and every later event re-deferred it, so changes made on another device never arrived again
for the rest of that session.

**The rule:** clamp anything derived from the difference of two wall-clock readings.

## 23. Check what actually ran before saying it shipped.

`git push` is not "deployed" — `.github/workflows/deploy.yml` runs only on `main`/`master` and takes
about 100 seconds. And a command chained after `grep -c` does not run when the count is zero,
because `grep` exits non-zero: a commit was silently skipped that way and nearly reported as shipped.

**The rule:** verify state after acting — `git status`, `gh run list`, and a real request against
production. Never infer success from the absence of an error message.

## 24. Escapes do not survive the trip to disk.

A `\b` written through a shell heredoc became a literal backspace inside a regex: it compiled,
type-checked, matched nothing, and was invisible in a diff, in grep output, and in review. It has
happened three times, most recently breaking an entire test file on its first run.

**The rule:** prefer code that needs no escape at all (`String.fromCharCode(10)` over a newline
escape). `tests/source-hygiene.test.ts` scans every source file for invisible characters by numeric
code point. Note also that apostrophes in a shell heredoc break the command — write file content
with the editing tools, not with `cat`.

## 25. The owner's own account is not a special case in the code.

An owner token lives in the URL fragment, which browsers never send to a server — so the server
always renders the guest view, and the owner sees a password prompt on their own album. The first
attempt to fix that waited for the owner check with no timeout, and took gated albums offline
entirely, for everyone.

**The rule:** any wait that hides a gate must be bounded, and the bound must be tested.

## 26. Do not act on the owner's behalf outside what was asked.

Comping a plan, flipping a feature switch, locking branding — these look like helpfulness and are
not. Twice in one day I changed live state on an assumption (that an album belonged to a customer
rather than to the owner) and had to undo it.

**The rule:** fixing a bug you found is expected (rule 12). Changing entitlements, billing, or an
owner's settings is not a bug fix — ask, even when the intent seems obvious from context.
