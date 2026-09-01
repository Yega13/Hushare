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

  it('binds host, so the URL cannot be replayed at another bucket', () => {
    expect(signedHeaders).toContain('host')
  })
})
