const VERIFIED_FROM = 'Hushare <noreply@hushare.space>'
const FALLBACK_FROM = 'Hushare <onboarding@resend.dev>'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SITE_URL = 'https://hushare.space'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Strip newlines to prevent email header injection in Subject lines
function safeSubjectField(str: string): string {
  return str.replace(/[\r\n]/g, ' ')
}

function requireSafeUrl(url: string, field: string): void {
  if (!url.startsWith('https://')) {
    throw new Error(`[email] unsafe URL in ${field}: scheme must be https`)
  }
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  // Trimmed before validating: a value set with `echo x | wrangler secret put` carries a trailing
  // newline, and JS `$` does not match before one — so a perfectly good address failed the test.
  to = to.trim()
  if (!EMAIL_RE.test(to)) {
    // Throws rather than returning. Silently dropping a send meant the caller reported success, so
    // a misconfigured address looked identical to a delivered email — which cost an hour of
    // tracing an alert that had never been attempted. A caller that wants to tolerate this can
    // catch it; none should want to hide it.
    throw new Error(`[email] invalid recipient address: ${to.slice(0, 64)}`)
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('[email] RESEND_API_KEY not configured')
  }
  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === 'true'
  const from = domainVerified ? VERIFIED_FROM : FALLBACK_FROM

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[email] Resend error:', res.status, body)
      throw new Error(`Email send failed: ${res.status}`)
    }
    // Log the provider's id on success too. Without it, "Resend accepted it" and "nothing was ever
    // sent" produce identical (empty) logs, and the only way to tell them apart is to go and look
    // in an inbox — which is not a debugging tool.
    const ok = await res.json().catch(() => null) as { id?: string } | null
    console.log('[email] sent:', subject.slice(0, 60), '->', to, 'id=', ok?.id ?? 'unknown')
  } catch (err) {
    console.error('[email] fetch failed:', err instanceof Error ? err.message : String(err))
    throw err
  }
}

export async function sendPhotoNotificationEmail(
  ownerEmail: string,
  albumTitle: string,
  albumUrl: string,
  photoCount: number,
) {
  requireSafeUrl(albumUrl, 'albumUrl')
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const noun = photoCount === 1 ? 'photo' : 'photos'
  const subject = `${photoCount} new ${noun} added to "${safeSubjectField(albumTitle)}"`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(String(photoCount))} new ${noun} added</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Someone just added <strong>${escapeHtml(String(photoCount))} ${noun}</strong> to your album
    <strong>${escapeHtml(albumTitle)}</strong>.
  </p>
  <a href="${escapeHtml(albumUrl)}"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    View album
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    You received this because you own an album on
    <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>.
    To stop receiving these emails, reply with "unsubscribe" or email
    <a href="mailto:${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}" style="color:#B0A090;">${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Someone added ${photoCount} ${noun} to your album. View it here:`,
    albumUrl,
    '',
    'You received this because you own an album on Hushare.',
    `To unsubscribe, reply to this email or contact ${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}.`,
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

// Re-send an album's private owner/management link to its owner (admin support action). The link
// carries the #owner= token, so it grants management access — only ever sent to the owner's own email.
export async function sendOwnerLinkEmail(ownerEmail: string, albumTitle: string, ownerUrl: string) {
  requireSafeUrl(ownerUrl, 'ownerUrl')
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const subject = `Your management link for "${safeSubjectField(albumTitle)}"`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Your album management link</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Here is your private link to manage <strong>${escapeHtml(albumTitle)}</strong>. Keep it safe —
    anyone with this link can manage the album.
  </p>
  <a href="${escapeHtml(ownerUrl)}"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    Manage album
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    Sent from <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a> at your request. If you
    didn't ask for this, you can ignore it — contact
    <a href="mailto:${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}" style="color:#B0A090;">${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Here is your private link to manage "${albumTitle}". Keep it safe — anyone with it can manage the album.`,
    ownerUrl,
    '',
    `Sent at your request. Questions? ${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}.`,
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

export async function sendBillingReminderEmail(
  ownerEmail: string,
  tier: string,
  renewalDate: string,
  accountUrl: string,
) {
  requireSafeUrl(accountUrl, 'accountUrl')
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const tierLabel = safeSubjectField(tier === 'studio' ? 'Max' : 'Pro')
  const subject = `Your Hushare ${tierLabel} plan renews tomorrow`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Subscription renewing soon</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Your <strong>Hushare ${escapeHtml(tierLabel)} plan</strong> is scheduled to renew on
    <strong>${escapeHtml(renewalDate)}</strong>.
  </p>
  <p style="margin:0 0 20px;color:#5C4A3C;">
    No action needed — your subscription will continue automatically.
    If you'd like to make changes, visit your account.
  </p>
  <a href="${escapeHtml(accountUrl)}"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    Manage subscription
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    You received this because you have an active subscription on
    <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>.
    To stop receiving these emails, reply with "unsubscribe" or email
    <a href="mailto:${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}" style="color:#B0A090;">${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Your Hushare ${tierLabel} plan is scheduled to renew on ${renewalDate}.`,
    '',
    'No action needed — your subscription will continue automatically.',
    "If you'd like to make changes, visit your account:",
    accountUrl,
    '',
    'You received this because you have an active subscription on Hushare.',
    `To unsubscribe, reply to this email or contact ${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}.`,
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

// The package renewal reminder. Renewals are one-time payments from the link in THIS email —
// there is no stored card and nothing renews itself, so this is the renewal mechanism, not a
// courtesy. Sent at 30 days and again at 7 (lib/package-renewal decides), never after lapse.
export async function sendPackageRenewalEmail(
  ownerEmail: string,
  albumTitle: string,
  albumSlug: string,
  daysLeft: number,
  priceLabel: string,   // "$9" / "$19" — formatted by the caller from the catalogue
) {
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const subject = `Keep "${safeSubjectField(albumTitle)}" online — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`

  // THE ACCOUNT PAGE, NOT THE ALBUM. This link is opened two years after the event, on whatever
  // device reads the mail. The album can be behind a password or a reveal date — and weddings, the
  // albums most worth keeping, are exactly the ones with passwords — so pointing at it dead-ended
  // the only person who could pay. The account page needs nothing but the sign-in that checkout
  // requires anyway, and it lists every album of theirs that is running out.
  const renewUrl = `${SITE_URL}/account?renew=${encodeURIComponent(albumSlug)}`
  requireSafeUrl(renewUrl, 'renewUrl')
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Your album's package is running out</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    The package on <strong>${escapeHtml(albumTitle)}</strong> ends in
    <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>. Renewing costs
    <strong>${escapeHtml(priceLabel)} for a year</strong> and keeps every photo and video exactly
    where it is.
  </p>
  <p style="margin:0 0 20px;color:#5C4A3C;">
    Nothing is deleted without further warning — but the paid features stop when the package does.
  </p>
  <a href="${escapeHtml(renewUrl)}"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    Renew for ${escapeHtml(priceLabel)}/year
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    You are receiving this because your album on <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>
    has a package that is about to end. To stop receiving these emails, reply with "unsubscribe" or email
    ${escapeHtml(process.env.SUPPORT_EMAIL ?? 'support@hushare.space')}. ${escapeHtml(MAILING_ADDRESS)}.
  </p>
</div>`
  const text = `The package on "${albumTitle}" ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. `
    + `Renewing costs ${priceLabel} for a year and keeps everything where it is: ${renewUrl}`
  await sendEmail(ownerEmail, subject, html, text)
}

export async function sendExpiryWarningEmail(
  ownerEmail: string,
  albumTitle: string,
  albumUrl: string,
  daysLeft: number,
) {
  requireSafeUrl(albumUrl, 'albumUrl')
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const subject = `Your Hushare album "${safeSubjectField(albumTitle)}" will be deleted in ${daysLeft} days`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Your album is about to expire</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Your Hushare album <strong>${escapeHtml(albumTitle)}</strong> hasn't had any activity
    in a while and will be <strong>automatically deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.
  </p>
  <p style="margin:0 0 20px;color:#5C4A3C;">
    To keep it, just visit the album — any upload or view resets the timer.
  </p>
  <a href="${escapeHtml(albumUrl)}"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    View album
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    Free albums on <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>
    are kept for 12 months after last activity.
    <a href="${escapeHtml(SITE_URL)}/pricing" style="color:#B0A090;">Upgrade to a paid plan</a>
    to keep your albums forever.
    To stop receiving these emails, reply with "unsubscribe" or email
    <a href="mailto:${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}" style="color:#B0A090;">${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Your album hasn't had any activity in a while and will be automatically deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    '',
    'To keep it, just visit the album — any activity resets the timer:',
    albumUrl,
    '',
    'Free albums on Hushare are kept for 12 months after last activity.',
    `Upgrade to a paid plan to keep your albums forever: ${SITE_URL}/pricing`,
    '',
    `To unsubscribe, reply to this email or contact ${process.env.SUPPORT_EMAIL ?? 'support@hushare.space'}.`,
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

// Operational alert to the operator, not to a user. Plain and scannable on a phone lock screen,
// because the whole point is being read while standing in a field rather than at a desk.
//
// `test` matters more than it looks. The first version sent test messages through the real template,
// so the email announced "these are real failures — something is not working right now" and then
// listed "this is a test, nothing is wrong". Contradicting itself in the first two lines is a good
// way to teach someone to ignore the alert entirely.
export async function sendErrorSpikeEmail(
  to: string,
  info: {
    count: number; windowMinutes: number; deviceCount: number; top: [string, number][]
    /**
     * Which albums it is happening in, worst first, with a way to reach the owner.
     *
     * `owner` is a LABEL, not an address: a real email, '(no account)' for a guest-created album,
     * or '(unknown user)' when the lookup did not resolve. Three states, produced by
     * lib/server/error-attribution and rendered as-is — the field was `ownerEmail: string | null`
     * and collapsed the last two into "cannot be contacted", which told the operator a paying
     * customer was unreachable whenever a lookup merely blipped.
     */
    albums?: { slug: string; title: string; count: number; owner: string }[]
    moreAlbums?: number
    /** True when NO album could be resolved at all — say so rather than implying none was involved. */
    lookupFailed?: boolean
    test?: boolean
  },
) {
  const { count, windowMinutes, deviceCount, top, albums = [], moreAlbums = 0, lookupFailed = false, test } = info
  const subject = test
    ? 'Hushare: test alert (nothing is wrong)'
    : `Hushare: ${count} uploads or pages failed for guests in ${windowMinutes} min`
  const heading = test
    ? 'This is a test. Nothing is wrong.'
    : `${count} things failed for guests in the last ${windowMinutes} minutes`
  const explain = test
    ? `You asked for this from the admin dashboard, to check the alert reaches you. A real alert looks like this one, but names what broke and how many people it hit. If this arrived, alerting works — nothing to do.`
    : `That means ${count} times, on ${deviceCount} device${deviceCount === 1 ? '' : 's'}, someone using Hushare had something fail: a photo that would not upload, or a page that crashed. It is not a warning about limits — those are excluded. Something is broken for real people right now.`
  const rows = top
    .map(([msg, n]) => `<li style="margin:0 0 6px;"><strong>${n}×</strong> ${escapeHtml(msg.slice(0, 140))}</li>`)
    .join('')
  // WHERE it is happening, with a link straight to the album and the owner's address.
  //
  // Every one of these alerts used to end at a number, so acting on it meant opening /admin and
  // working out by hand which album was on fire and whether anyone could be told. The owner line is
  // deliberately explicit when there is nobody to write to: two thirds of albums have no account,
  // and that is the thing worth knowing while it is still happening.
  // An address gets a mailto; a label like '(no account)' or '(unknown user)' is printed as the
  // plain fact it is. Deciding on '@' rather than on a separate flag keeps this template unable to
  // turn a label into a broken mailto: link, whatever a future caller passes.
  const albumRows = albums.map((a) => {
    const url = `${SITE_URL}/${a.slug}`
    const owner = a.owner.includes('@')
      ? `<a href="mailto:${escapeHtml(a.owner)}" style="color:#630826;">${escapeHtml(a.owner)}</a>`
      : `<span style="color:#B0A090;">${escapeHtml(a.owner)}</span>`
    return `<li style="margin:0 0 8px;"><strong>${a.count}×</strong> `
      + `<a href="${escapeHtml(url)}" style="color:#630826;font-weight:600;">${escapeHtml(a.title.slice(0, 60))}</a>`
      + `<br><span style="font-size:13px;color:#8B6F4E;">${escapeHtml(url)} · ${owner}</span></li>`
  }).join('')
  // "We could not look them up" and "none was involved" are different facts and must not render
  // identically. An empty block used to mean both (rule 20).
  const albumBlock = lookupFailed
    ? `<p style="margin:0 0 20px;color:#8B6F4E;font-size:14px;">Which albums: could not be looked up — open the dashboard.</p>`
    : albums.length === 0 ? '' : `
  <p style="margin:0 0 6px;color:#5C4A3C;font-weight:600;font-size:14px;">Which albums:</p>
  <ul style="margin:0 0 20px;padding-left:18px;color:#5C4A3C;font-size:14px;">${albumRows}</ul>
  ${moreAlbums > 0 ? `<p style="margin:-12px 0 20px;color:#8B6F4E;font-size:13px;">and ${moreAlbums} more album${moreAlbums === 1 ? '' : 's'}</p>` : ''}`
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 10px;font-size:18px;">${escapeHtml(heading)}</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;line-height:1.5;">${escapeHtml(explain)}</p>
  <p style="margin:0 0 6px;color:#5C4A3C;font-weight:600;font-size:14px;">${test ? 'Sample' : 'What is failing'}:</p>
  <ul style="margin:0 0 20px;padding-left:18px;color:#5C4A3C;font-size:14px;">${rows}</ul>
  ${albumBlock}
  <a href="${SITE_URL}/admin#errors"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    Open the admin dashboard
  </a>
  <p style="margin:20px 0 0;color:#B0A090;font-size:12px;">
    ${test ? 'Test messages ignore the hourly limit.' : 'You will not get another about THIS failure for an hour. A different failure still reaches you.'}
  </p>
</div>`
  // Assembled as lines rather than one escaped template string: the plain-text part is what a
  // lock-screen preview shows, so its line breaks matter.
  const text = [
    heading,
    '',
    explain,
    '',
    ...top.map(([m, n]) => `${n}x ${m}`),
    // The plain-text part is what a lock-screen preview shows, so it must agree with the HTML
    // rather than diverging. It previously emitted "and N more albums" unconditionally, so when the
    // HTML omitted the whole block the text still carried that line, pointing at nothing.
    ...(lookupFailed ? ['', 'Which albums: could not be looked up — open the dashboard.'] : []),
    ...(!lookupFailed && albums.length ? ['', 'Which albums:'] : []),
    ...(lookupFailed ? [] : albums.map(a => `${a.count}x ${a.title} — ${SITE_URL}/${a.slug} — ${a.owner}`)),
    ...(!lookupFailed && albums.length && moreAlbums > 0
      ? [`and ${moreAlbums} more album${moreAlbums === 1 ? '' : 's'}`] : []),
    '',
    `${SITE_URL}/admin#errors`,
  ].join(`\n`)
  await sendEmail(to, subject, html, text)
}
