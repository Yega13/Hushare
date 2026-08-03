-- Public announcements / statements archive (hushare.space/statement).
-- Anyone can READ published statements; only the server (admin, via service_role) can write.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.

create table if not exists public.statements (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  summary      text,
  body_html    text not null,
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists statements_published_idx on public.statements (published_at desc);

alter table public.statements enable row level security;
-- Public read (these are announcements meant to be seen); writes are server-only.
-- drop-then-create so the migration is idempotent (safe to re-run / apply after a manual run).
drop policy if exists statements_public_read on public.statements;
create policy statements_public_read on public.statements for select using (true);

-- Seed the launch announcement (idempotent).
insert into public.statements (slug, title, summary, body_html, published_at)
values (
  'hushare-product-update-august-2026',
  'A more capable Hushare — live walls, moderation & clearer plans',
  'Live Photo Wall, guest-photo moderation, three languages, tougher uploads, and clearer plans.',
  $html$
<p>At Hushare, our goal has always been a simple one: make it effortless for everyone at an event to share the moments they capture — one link, no app to download, no friction. Whether it's a wedding, a birthday, a conference, or a quiet family gathering, the best photos are usually in someone else's pocket. Hushare brings them all together in a single shared album that anyone can add to in seconds.</p>
<p>Over the past several weeks we've shipped a series of meaningful improvements that make those shared albums livelier to experience, safer to host, and easier to manage — and we've refreshed our plans so we can keep Hushare fast, generous, and sustainable as it continues to grow. Here is what changed, and exactly how it works.</p>

<h2>What's new</h2>

<h3>Live Photo Wall</h3>
<p>The Live Photo Wall turns any screen at your venue — a projector on the wall, a television in the corner, a laptop propped on the gift table — into a gallery that fills itself. As guests take and share photos, they appear on the wall within seconds, newest first, so the room is always looking at the moment that just happened.</p>
<p>Getting people to actually contribute is usually the hard part, and the wall is built to solve exactly that. A QR code sits right on the screen: anyone can point their phone's camera at it and land straight in the album — nothing to install, no account to create, no password to remember. One tap adds a photo, and it is on the wall in front of everyone a moment later. Seeing their own shot go up on the big screen is what pulls in the next person, and the one after that.</p>
<p>Because it runs entirely in a browser, there is nothing to set up beyond opening a link. It works on whatever screen you already have, scales from a phone to a cinema projector, and always keeps the freshest photos in view alongside a running count of everything shared so far. You open it in a single click from your album's owner tools, and it looks after itself for the rest of the night.</p>

<h3>Guest-photo moderation</h3>
<p>Most of the time you want every photo to go straight into the album — that openness is the whole point. But some events call for a lighter touch of control: a wedding where the couple wants to see what becomes public, a company event with a brand to protect, a celebration where not every candid belongs on the shared wall. For those, you can now review before you publish.</p>
<p>Switch on "Require approval" in your album settings and guest photos wait for your nod before anyone else can see them. Pending shots are marked clearly in your view, and only yours; the guest simply sees their upload succeed as usual. When you approve a photo it goes live for everyone instantly. Nothing is lost, no one is left guessing, and the experience for your guests stays exactly as simple as it was before.</p>
<p>It is designed to stay out of the way. Leave it off and Hushare behaves as it always has, every photo public the instant it lands. Turn it on only for the events that need it, and you get a fully curated album without asking a single guest to do anything differently.</p>

<h3>Now in three languages</h3>
<p>Hushare now speaks English, Русский and Հայերեն across the entire experience — the guest upload screen, the album itself, and every owner tool. This is not a machine translation bolted on at the end; each language has been written to read naturally, with the correct typography and fonts for its script.</p>
<p>This matters most for the people who matter most at an event: the guests. When someone opens your album and it greets them in their own language, they do not hesitate — they upload. At a gathering where relatives speak Armenian, friends speak Russian and colleagues speak English, everyone gets the same effortless experience instead of puzzling over an unfamiliar interface. Anyone can switch languages at any time from the footer of any page, and Hushare remembers the choice.</p>

<h3>Faster, tougher uploads</h3>
<p>Uploading is the one thing Hushare has to get right every single time, so we rebuilt that path to hold up under the conditions events actually create: dozens of people sharing at once, over a single strained venue Wi-Fi, from every make and model of phone.</p>
<p>Large videos now resume instead of starting over, so a signal that drops halfway through no longer costs you the whole file. Photos upload several at a time and arrive the right way up, with their orientation corrected automatically — no more sideways portraits. When a connection stumbles, Hushare quietly retries in the background rather than throwing an error in your face, and on the rare occasion something genuinely needs your attention, the message tells you plainly what to do. We also closed the specific gaps where certain Android phones could fail to read a photo before sending it.</p>
<p>The aim behind all of it is unglamorous and exactly the point: every photo a guest chooses to share should make it into the album, even when the network is working against them. A shared album lives or dies on that reliability, and it is where most of this release's quiet effort went.</p>

<h2>Plans at a glance</h2>
<table>
<thead><tr><th>Plan</th><th>Albums</th><th>Photos &amp; videos / album</th></tr></thead>
<tbody>
<tr><td><strong>Guest</strong> — no account needed</td><td>2</td><td>150</td></tr>
<tr><td><strong>Free</strong> — with a free account</td><td>3</td><td>250</td></tr>
<tr><td><strong>Pro</strong></td><td>15</td><td>2,500</td></tr>
<tr><td><strong>Max</strong></td><td>50</td><td>10,000</td></tr>
</tbody>
</table>

<div class="hush-callout">
<p><strong>Already have a large album?</strong> Every album created before this update keeps working, with room for up to 1,000 photos and videos. Nothing is ever deleted — you will simply see a friendly reminder to register for more space as an album fills up.</p>
</div>

<h2>Our commitment to you</h2>
<p>Hushare will always be free to start. You can still create an album and collect photos from everyone in seconds, without an account. The refreshed plans simply give us a fair, sustainable way to keep the service fast and reliable for everyone, and give hosts who need more room a clear path to it. As ever, your memories are yours: we never sell your data, and we never delete what you have created.</p>
<p>Thank you for trusting Hushare with some of your most meaningful moments. This is only the beginning, and we cannot wait to show you what comes next.</p>

<div class="hush-sign">
<p style="font-style:italic;margin:0 0 .6rem;">With warm regards,</p>
<div class="name">Suren Yeganyan</div>
<div class="role">Founder &amp; Chief Executive Officer, Hushare</div>
</div>
  $html$,
  '2026-08-03T12:00:00Z'
)
on conflict (slug) do nothing;
