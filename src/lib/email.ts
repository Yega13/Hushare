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
export async function sendErrorSpikeEmail(
  to: string,
  info: { count: number; windowMinutes: number; deviceCount: number; top: [string, number][] },
) {
  const { count, windowMinutes, deviceCount, top } = info
  const subject = `Hushare: ${count} errors in ${windowMinutes} min`
  const rows = top
    .map(([msg, n]) => `<li style="margin:0 0 6px;"><strong>${n}×</strong> ${escapeHtml(msg.slice(0, 140))}</li>`)
    .join('')
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#630826;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 8px;font-size:18px;">${count} errors in the last ${windowMinutes} minutes</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Across ${deviceCount} device${deviceCount === 1 ? '' : 's'}. Warnings are excluded, so these are
    real failures — something is not working for someone right now.
  </p>
  <ul style="margin:0 0 20px;padding-left:18px;color:#5C4A3C;font-size:14px;">${rows}</ul>
  <a href="${SITE_URL}/admin#errors"
     style="display:inline-block;background:#630826;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    Open the admin dashboard
  </a>
  <p style="margin:20px 0 0;color:#B0A090;font-size:12px;">
    One alert per hour at most, however long this lasts.
  </p>
</div>`
  const text = `${count} errors in the last ${windowMinutes} minutes, across ${deviceCount} device(s).\n\n`
    + top.map(([m, n]) => `${n}x ${m}`).join('\n')
    + `\n\n${SITE_URL}/admin#errors\n\nOne alert per hour at most.`
  await sendEmail(to, subject, html, text)
}
