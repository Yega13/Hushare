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
<p>When we started Hushare, the problem we cared about was small and specific: at the end of an event, the best photos are scattered across twenty different phones, and you end up never seeing most of them. A group chat papers over it for a day, then everything scrolls away. A shared drive needs accounts nobody wants to make. So Hushare does one job — one link, and anyone who was there can drop their photos and videos into the same album in a few seconds, with no app and no sign-up.</p>
<p>We've spent the last few weeks adding to that and tuning the plans as we go. Below is the full rundown of what shipped and how each piece actually works, so nothing catches you off guard.</p>

<h2>What's new</h2>

<h3>Live Photo Wall</h3>
<p>Put a link on any screen at the venue — a projector, a spare TV, a laptop by the door — and it turns into a gallery that updates itself. A photo a guest takes shows up on the wall a few seconds later, newest at the top.</p>
<p>What makes it work is the QR code sitting on the screen. A guest points their camera at it, lands straight in the album, and adds a photo in one tap: no download, no account. And the moment one person watches their own shot appear up there, other people start doing it too. The wall does the convincing for you.</p>
<p>There is nothing to install. It is just a web page, so it runs on whatever screen is already in the room, from a phone to a cinema projector, and it keeps a live count of everything shared so far. You open it from your album's owner tools and leave it running for the night.</p>

<h3>Guest-photo moderation</h3>
<p>By default, every photo a guest adds is public straight away, and for most events that is exactly what you want. But not for all of them. A couple might want to see what goes up at their wedding before the room does; a company might have a brand to keep tidy. So reviewing photos first is now an option, not the rule.</p>
<p>Turn on "Require approval" in the album settings and new guest photos wait in a queue that only you can see. The guest's side does not change at all — their upload works just like before — the photos simply stay private until you say otherwise. Approve one and it is live for everyone instantly. Nothing gets deleted, and nothing gets stuck in limbo.</p>
<p>It stays off unless you switch it on, so if you like the open free-for-all, keep it exactly as it is. Flip it on for the one event that needs a careful eye, and you get a tidy, curated album without asking your guests to do anything differently.</p>

<h3>Now in three languages</h3>
<p>The whole product now works in English, Русский and Հայերեն — and not just the marketing pages, but the parts guests actually touch: the upload screen, the album, the owner tools. We wrote each language ourselves instead of running it through a translator, right down to using the correct fonts for each script.</p>
<p>The point of this is the guest. Open an album in a language you cannot read and you hesitate; open it in your own and you just upload. At a table where the grandparents speak Armenian, half the friends speak Russian, and everyone else defaults to English, nobody gets left standing on the outside. You can switch languages from the footer whenever you want, and it remembers.</p>

<h3>Faster, tougher uploads</h3>
<p>This is the part that simply has to work, so it got the most attention. An event is a hard case for any uploader: a lot of people all hitting send at the same second, sharing one tired venue router, on every make of phone ever sold.</p>
<p>Big videos now pick up where they left off instead of restarting, so a signal that drops halfway through no longer means losing the whole file. Photos go up several at a time and come out the right way round rather than sideways. If the connection stumbles for a moment, Hushare retries on its own without putting an error in front of you, and on the rare occasion it genuinely cannot, it tells you what actually went wrong. We also chased down a stubborn case where certain Android phones failed to read a photo before sending it.</p>
<p>None of this is flashy. But a shared album is only as good as its worst upload, and making sure every single photo lands — even when the Wi-Fi is against you — was more than worth the effort.</p>

<h2>Plans at a glance</h2>
<p>A quick word on how the plans work, because a table on its own does not explain the thinking behind them. Hushare is free to begin with and stays genuinely useful for free — you can run an entire event on the free tier without paying, or even registering. The paid tiers are there for two situations: events big enough to outgrow the free room, and hosts who want the extras like passwords, custom links, HD video, and collections that group several albums under one link. You only move up when you actually hit a wall, never because we fenced off the basics.</p>
<table>
<thead><tr><th>Plan</th><th>Albums</th><th>Photos &amp; videos / album</th></tr></thead>
<tbody>
<tr><td><strong>Guest</strong> — no account needed</td><td>2</td><td>150</td></tr>
<tr><td><strong>Free</strong> — with a free account</td><td>3</td><td>250</td></tr>
<tr><td><strong>Pro</strong></td><td>15</td><td>2,500</td></tr>
<tr><td><strong>Max</strong></td><td>50</td><td>10,000</td></tr>
</tbody>
</table>
<p>As a rough guide: a single birthday or a dinner with friends fits the free tier without any trouble; a wedding with a long guest list usually wants Pro; and photographers or event planners juggling lots of separate events tend to live on Max. If you are not sure where you land, just start free — you can move up at any point, and nothing you have already made changes when you do.</p>

<div class="hush-callout">
<p><strong>Already have a big album?</strong> Anything you created before this update keeps working, with headroom for up to 1,000 photos and videos. We never delete a thing — you will just see a gentle nudge to register for more space as it fills up.</p>
</div>

<h2>Our commitment to you</h2>
<p>Two promises worth putting in writing. First, the free tier is not bait: you can still create an album and gather everyone's photos in seconds without an account, and that is not going anywhere. Second, your photos are yours — we do not sell your data, and we do not delete what you have made. The changes to the plans are about keeping Hushare fast and paying its bills as it grows, and nothing more than that.</p>
<p>Thank you for trusting us with the days that matter to you. We are nowhere near finished.</p>

<div class="hush-sign">
<p style="font-style:italic;margin:0 0 .6rem;">With warm regards,</p>
<div class="name">Suren Yeganyan</div>
<div class="role">Founder &amp; Chief Executive Officer, Hushare</div>
</div>
  $html$,
  '2026-08-03T12:00:00Z'
)
on conflict (slug) do nothing;
