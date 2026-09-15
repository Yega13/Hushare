import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reportThroughSite } from '@/lib/server/media-backup'

// THE BACKUP QUEUE'S DOOR INTO THE ERROR PANEL. worker.ts's queue handler runs outside Next.js and posts its
// "giving up" sentence here (lib/server/media-backup: reportThroughSite). The panel's reporter is mocked at
// the module boundary; the route's checks, and the lib's side of the post, are real.

const SECRET = 'test-cron-secret'
type Report = { source: string; message: string; opts?: { context?: Record<string, unknown> } }
const reports: Report[] = []

vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts?: Report['opts']) => { reports.push({ source, message, opts }) },
}))

const { POST } = await import('@/app/api/cron/backup-queue-report/route')

const post = (body: string, secret = SECRET) => new Request('https://hushare.space/api/cron/backup-queue-report', {
  method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body,
})
const context = { key: 'albums/a1/p.jpg', action: 'PutObject', attempts: 6, reason: 'R2 put failed' }

beforeEach(() => {
  process.env.ALBUM_RETIREMENT_SECRET = SECRET
  reports.length = 0
})

describe('the backup queue report route', () => {
  it('refuses a caller without the secret, and puts nothing in the panel', async () => {
    const res = await POST(post(JSON.stringify({ message: 'Backup queue is giving up on an object', context }), 'wrong'))
    expect(res.status).toBe(403)
    expect(reports).toEqual([])
  })

  it('WITH NO SECRET SET, a caller with no secret is still refused, and puts nothing in the panel', async () => {
    // timingSafeEqual('', '') is true, so with the secret unset only `!secret` keeps this route closed.
    const body = JSON.stringify({ message: 'Backup queue is giving up on an object', context })
    for (const unset of [() => { delete process.env.ALBUM_RETIREMENT_SECRET }, () => { process.env.ALBUM_RETIREMENT_SECRET = '' }]) {
      unset()
      const requests = [
        new Request('https://hushare.space/api/cron/backup-queue-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        post(body, ''),
      ]
      for (const req of requests) expect((await POST(req)).status).toBe(403)
    }
    expect(reports).toEqual([])
  })

  it('puts the queue sentence in the panel under queue/media-backup, with its context', async () => {
    const res = await POST(post(JSON.stringify({ message: 'Backup queue is giving up on an object', context })))
    expect(res.status).toBe(200)
    expect(reports).toEqual([{ source: 'queue/media-backup', message: 'Backup queue is giving up on an object', opts: { context } }])
  })

  it('A BODY THAT IS NOT ONE SENTENCE WITH FLAT CONTEXT is refused, not stored', async () => {
    const bodies = [
      JSON.stringify({ message: 42, context }),
      JSON.stringify({ message: 'x', context: [1] }),
      JSON.stringify({ message: 'x', context: { a: {} } }),
      JSON.stringify({ message: 'x' }),
      'not json',
    ]
    for (const body of bodies) {
      const res = await POST(post(body))
      expect(res.status, body).toBe(400)
    }
    expect(reports).toEqual([])
  })

  it('WHAT THE QUEUE POSTS IS WHAT THIS ROUTE ACCEPTS -- the lib and the route agree on the body', async () => {
    const report = reportThroughSite((url, init) => POST(new Request(url, init)), 'https://hushare.space', SECRET)
    await report('Backup queue is giving up on an object', context)
    expect(reports).toEqual([{ source: 'queue/media-backup', message: 'Backup queue is giving up on an object', opts: { context } }])
  })
})
