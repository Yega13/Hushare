-- Public announcements / statements archive (hushare.space/statement).
-- Anyone can READ published statements; only the server (admin, via service_role) can write.
-- Run in the Supabase SQL editor.

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
<p>Over the past several weeks we've shipped a series of meaningful improvements that make those shared albums livelier to experience, safer to host, and easier to manage — and we've refreshed our plans so we can keep Hushare fast, generous, and sustainable as it continues to grow. We believe in being completely transparent about how the product works, so below you'll find everything that's new, along with exactly how the plans now operate. There are no hidden limits and no surprises.</p>

<h2>What's new</h2>
<h3>Live Photo Wall</h3>
<p>Turn any screen or projector at your venue into a living gallery. Guest photos appear on-screen in real time as they are taken, and an on-screen QR code invites everyone to add their own in a single tap — no app, no account. It's a beautiful centrepiece for a reception, and it quietly encourages more people to contribute.</p>
<h3>Guest-photo moderation</h3>
<p>For hosts who want a curated album, you can now review guest photos before they go public. Switch on "Require approval" in your album settings; pending photos are clearly marked in your own view and go live the moment you approve them — full control, without slowing anyone down.</p>
<h3>Now in three languages</h3>
<p>Hushare is now fully available in English, Русский, and Հայերեն, so guests and hosts alike can use it in the language they are most comfortable with. You can switch at any time from the footer of any page.</p>
<h3>Faster, tougher uploads</h3>
<p>We've hardened the upload experience from end to end. Photos and videos now upload more reliably — even over the crowded Wi-Fi of a busy venue — with smarter automatic retries and clearer, friendlier messages whenever something needs another try.</p>

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
<p><strong>Already have a large album?</strong> Every album created before this update keeps working, with room for up to 1,000 photos and videos. Nothing is ever deleted — you'll simply see a friendly reminder to register for more space as an album fills up.</p>
</div>

<h2>Our commitment to you</h2>
<p>Hushare will always be free to start. You can still create an album and collect photos from everyone in seconds, without an account. The refreshed plans simply give us a fair, sustainable way to keep the service fast and reliable for everyone — and give hosts who need more room a clear path to it. As ever, your memories are yours: we never sell your data, and we never delete what you've created.</p>
<p>Thank you for trusting Hushare with some of your most meaningful moments. This is only the beginning, and we can't wait to show you what comes next.</p>

<div class="hush-sign">
<p style="font-style:italic;margin:0 0 .6rem;">With warm regards,</p>
<div class="name">Suren Yeganyan</div>
<div class="role">Founder &amp; Chief Executive Officer, Hushare</div>
</div>
  $html$,
  '2026-08-03T12:00:00Z'
)
on conflict (slug) do nothing;
