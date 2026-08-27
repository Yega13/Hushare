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
