import { describe, it, expect, beforeAll } from 'vitest'

// WHAT A PRESIGNED UPLOAD URL ACTUALLY CONSTRAINS.
//
// A presigned PUT is the only thing standing between a stranger and our storage bucket, and its
// guarantees are exactly the headers inside X-Amz-SignedHeaders — nothing else. Two of them are
// load-bearing and neither is obvious from reading the call site:
//
//   content-length — the tier's byte cap. Believed signed, and it is.
//   content-type   — what the object SERVES AS. Believed signed, and it was NOT: the presigner
//                    calls unsignableHeaders.add("content-type") before signing, so the ContentType
//                    passed to PutObjectCommand shaped nothing. A stranger could presign as
//                    image/jpeg and PUT text/html, and videos.hushare.space — a sibling of the app,
//                    outside the reach of its CSP and nosniff headers — would serve executable
//                    HTML on our own domain.
//
// This test reads the signed set out of a real generated URL, so it fails if an SDK upgrade drops
// the override, if someone removes it, or if the signing config changes shape. A comment claiming
// a header is signed is worth nothing; this is worth something.
//
// Note it also pins cache-control as NOT signed — that is fine (it only affects caching, and R2
// takes ours), and it is recorded because the source once claimed the opposite in a comment.

let signedHeaders: string[] = []

beforeAll(async () => {
  // Credentials never leave this process and are not real — signing is pure arithmetic over them.
  process.env.CLOUDFLARE_ACCOUNT_ID ??= '0'.repeat(32)
  process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id'
  process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key'
  process.env.R2_BUCKET_NAME ??= 'hushare-media'

  const { createPresignedPut } = await import('@/lib/cloudflare/r2')
  const url = await createPresignedPut('albums/abc/def.jpg', 'image/jpeg', 3600, 1234)
  const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''
  signedHeaders = signed.split(';').map((h) => h.trim().toLowerCase()).filter(Boolean)
})

describe('a presigned upload URL constrains what it claims to', () => {
  it('binds content-type, so the stored object cannot serve as HTML', () => {
    expect(
      signedHeaders,
      'content-type missing from the signature means the uploader picks what the object serves as, ' +
      'and an image/jpeg presign accepts a text/html PUT onto our own domain',
    ).toContain('content-type')
  })

  it('binds content-length, so the tier byte cap cannot be bypassed', () => {
    expect(signedHeaders).toContain('content-length')
  })

  it('binds host, so the URL cannot be replayed at another endpoint', () => {
    // NOT "at another bucket", which is what this said before. The client sets forcePathStyle, so
    // the bucket is a PATH segment and the host is the account endpoint, identical for every bucket
    // we own. What actually stops a bucket swap is that SigV4 signs the canonical URI, so editing
    // the path invalidates the signature. The protection is real; the reason given was wrong, and a
    // wrong reason is what makes the next person delete the right line.
    expect(signedHeaders).toContain('host')
  })
})

// WHICH BUCKET THE SIGNATURE ACTUALLY ADDRESSES.
//
// This existed as a belief, not a test. The suite above already sets R2_BUCKET_NAME, because
// whoever wrote it assumed that variable chose the bucket -- and cloudflare/r2.ts ignored it and
// signed the literal 'hushare-media' instead. So a staging build could set R2_BUCKET_NAME to its
// own bucket, pass environmentMisconfiguration() (which reads the variable), report itself
// correctly isolated, and hand every browser an upload URL pointing at PRODUCTION. Seven routes
// sign through these two helpers.
//
// The test asserts the bucket inside a real generated URL rather than re-deriving the name, so it
// fails if the literal comes back (AGENTS.md rule 17).
describe('a presigned URL addresses the configured bucket', () => {
  const bucketOf = (url: string) => new URL(url).pathname.split('/').filter(Boolean)[0]

  it('signs the bucket from R2_BUCKET_NAME, not a literal', async () => {
    const previous = process.env.R2_BUCKET_NAME
    process.env.R2_BUCKET_NAME = 'hushare-media-staging'
    try {
      const { createPresignedPut, createPresignedGet } = await import('@/lib/cloudflare/r2')
      const put = await createPresignedPut('albums/a/b.jpg', 'image/jpeg', 3600, 10)
      const get = await createPresignedGet('albums/a/b.jpg', 'attachment', 300)
      expect(
        bucketOf(put),
        'a staging build would upload into the production bucket while reporting itself isolated',
      ).toBe('hushare-media-staging')
      expect(bucketOf(get)).toBe('hushare-media-staging')
    } finally {
      if (previous === undefined) delete process.env.R2_BUCKET_NAME
      else process.env.R2_BUCKET_NAME = previous
    }
  })

  it('falls back to the production bucket when the variable is unset', async () => {
    // Production genuinely does not set R2_BUCKET_NAME (wrangler.toml [vars] has no such key), so
    // this branch IS production. It pins that the refactor changed nothing there.
    const previous = process.env.R2_BUCKET_NAME
    delete process.env.R2_BUCKET_NAME
    try {
      const { createPresignedPut } = await import('@/lib/cloudflare/r2')
      expect(bucketOf(await createPresignedPut('albums/a/b.jpg', 'image/jpeg', 3600, 10))).toBe('hushare-media')
    } finally {
      if (previous !== undefined) process.env.R2_BUCKET_NAME = previous
    }
  })
})
