import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'

export const runtime = 'nodejs'

// Landing page for every emailed auth link (magic link, signup, recovery, invite, email change).
//
// This page deliberately does NOT consume the token. It renders a button, and only the resulting
// POST /api/auth/confirm exchanges the token for a session. That indirection exists because a bare
// one-time link in an email is not safe from the mail infrastructure itself:
//
//   1. Corporate and ISP mail scanners (t-online/Deutsche Telekom among them) fetch every link in
//      an incoming message to check it for malware. That GET burned the one-time token before the
//      human ever saw the mail — the account showed as "email confirmed" seconds after signup, and
//      the real click then failed. Every email sign-in this product had ever seen died this way.
//      Scanners issue GETs, never form POSTs, so requiring a POST puts the token out of their reach.
//
//   2. Supabase's own /auth/v1/verify redirect hands back a PKCE `code`, and exchanging it requires
//      the code_verifier held by the browser that STARTED the sign-in. Open the mail on your phone
//      after requesting the link on your laptop and there is no verifier, so it fails. Verifying the
//      token_hash server-side (see the POST route) needs no verifier and works from any device.
//
// Both failure modes are invisible in logs — the user just never arrives. Do not "simplify" this
// back into a direct link.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>
}) {
  const { token_hash = '', type = '', next = '' } = await searchParams
  const t = getDictionary(await getServerLocale())

  const valid = token_hash.length > 0 && type.length > 0

  return (
    <main
      style={{
        minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px 20px',
      }}
    >
      <div
        style={{
          maxWidth: 420, width: '100%', textAlign: 'center',
          background: '#FFFFFF', border: '1px solid #DDD5C5', borderRadius: 18,
          padding: 'clamp(24px, 5vw, 36px)',
        }}
      >
        <h1
          style={{
            margin: '0 0 10px', fontSize: 22, fontWeight: 700, color: '#630826',
            fontFamily: 'var(--font-serif)',
          }}
        >
          {valid ? t['authConfirm.title'] : t['authConfirm.invalidTitle']}
        </h1>
        <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.55, color: '#5C4A3C' }}>
          {valid ? t['authConfirm.body'] : t['authConfirm.invalidBody']}
        </p>

        {valid ? (
          <form method="POST" action="/api/auth/confirm">
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              style={{
                width: '100%', padding: '13px 22px', fontSize: 16, fontWeight: 700,
                color: '#FDFAF5', background: '#630826', border: 'none', borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              {t['authConfirm.cta']}
            </button>
          </form>
        ) : (
          <a
            href="/login"
            style={{
              display: 'inline-block', padding: '13px 22px', fontSize: 16, fontWeight: 700,
              color: '#FDFAF5', background: '#630826', borderRadius: 12, textDecoration: 'none',
            }}
          >
            {t['authConfirm.backToLogin']}
          </a>
        )}
      </div>
    </main>
  )
}
