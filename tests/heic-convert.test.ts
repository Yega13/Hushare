import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHeicWorkerClient, convertHeicWith, type HeicReply, type HeicWorker } from '@/lib/upload/heic-convert'

// THE HEIC WORKER'S BOOKKEEPING, WHICH NO TEST RAN WHILE IT LIVED IN UploadZone.
//
// Every failure here is silent. A reply routed to the wrong photo gives one guest another guest's
// picture. A timer left running after a reply is a leak. A crash that fails nobody leaves tiles on
// "preparing" for two minutes each. The worker is faked; the timers are Vitest's, so two minutes
// cost nothing. Numbers are written as numbers (rule 17).

type Fake = HeicWorker & {
  posts: Array<{ message: { id: number; buffer: ArrayBuffer }; transfer: Transferable[] }>
  reply: (r: HeicReply) => void
  crash: () => void
}

function fakeWorker(): Fake {
  const w: Fake = {
    posts: [],
    onmessage: null,
    onerror: null,
    postMessage(message, transfer) { w.posts.push({ message, transfer }) },
    reply: (r) => w.onmessage?.({ data: r } as MessageEvent<HeicReply>),
    crash: () => w.onerror?.({} as ErrorEvent),
  }
  return w
}

function rig(readBytes: (b: Blob) => Promise<ArrayBuffer> = async () => new ArrayBuffer(3)) {
  const workers: Fake[] = []
  const client = createHeicWorkerClient({
    createWorker: () => { const w = fakeWorker(); workers.push(w); return w },
    readBytes,
  })
  return { client, workers }
}

const heic = (name = 'IMG.HEIC') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/heic' })
const JPEG = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
/** Let pending reads and replies run, without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('the HEIC worker client', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('sends the photo to the worker by TRANSFERRING its bytes, and returns the JPEG that comes back', async () => {
    const buf = new ArrayBuffer(3)
    const { client, workers } = rig(async () => buf)
    const out = client.convert(heic())
    await settle()
    expect(workers).toHaveLength(1)
    expect(workers[0].posts).toHaveLength(1)
    expect(workers[0].posts[0].message.id).toBe(1)
    expect(workers[0].posts[0].message.buffer).toBe(buf)
    // Transferred, not copied: a 10 MB HEIC would otherwise exist twice at once on a phone.
    expect(workers[0].posts[0].transfer).toHaveLength(1)
    expect(workers[0].posts[0].transfer[0]).toBe(buf)
    workers[0].reply({ id: 1, jpeg: JPEG })
    await expect(out).resolves.toBe(JPEG)
  })

  it('one worker serves every photo, and each reply reaches only the photo it belongs to', async () => {
    const { client, workers } = rig()
    const a = client.convert(heic('A.HEIC'))
    const b = client.convert(heic('B.HEIC'))
    await settle()
    expect(workers).toHaveLength(1)
    expect(workers[0].posts.map((p) => p.message.id)).toEqual([1, 2])

    let aSettled = false
    void a.then(() => { aSettled = true }, () => { aSettled = true })
    const J2 = new Blob([new Uint8Array([2])])
    workers[0].reply({ id: 2, jpeg: J2 })
    await expect(b).resolves.toBe(J2)
    await settle()
    expect(aSettled, "B's reply must not settle A").toBe(false)

    const J1 = new Blob([new Uint8Array([1])])
    workers[0].reply({ id: 1, jpeg: J1 })
    await expect(a).resolves.toBe(J1)
  })

  it("a worker's error reply fails that photo in the worker's own words", async () => {
    const { client, workers } = rig()
    const out = client.convert(heic())
    await settle()
    workers[0].reply({ id: 1, error: 'Could not parse HEIF file' })
    await expect(out).rejects.toThrow(new Error('Could not parse HEIF file'))
  })

  it('a reply with neither bytes nor words still fails the photo', async () => {
    const { client, workers } = rig()
    const out = client.convert(heic())
    await settle()
    workers[0].reply({ id: 1 })
    await expect(out).rejects.toThrow(new Error('HEIC conversion failed'))
  })

  it('a reply for a photo nobody is waiting for is ignored, and the real one still arrives', async () => {
    const { client, workers } = rig()
    const out = client.convert(heic())
    await settle()
    expect(() => workers[0].reply({ id: 99, jpeg: JPEG })).not.toThrow()
    workers[0].reply({ id: 1, jpeg: JPEG })
    await expect(out).resolves.toBe(JPEG)
  })

  it('a finished photo leaves no timer behind', async () => {
    const { client, workers } = rig()
    const out = client.convert(heic())
    await settle()
    expect(vi.getTimerCount()).toBe(1)
    workers[0].reply({ id: 1, jpeg: JPEG })
    await out
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives a photo two minutes, then fails it so the main-thread converter can try', async () => {
    const { client, workers } = rig()
    const out = client.convert(heic()).catch((e: Error) => e.message)
    await settle()
    let done = false
    void out.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(done, 'not before two minutes').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await out).toBe('HEIC conversion timed out')
    // A reply that arrives after the photo was given up on changes nothing and throws nothing.
    expect(() => workers[0].reply({ id: 1, jpeg: JPEG })).not.toThrow()
  })

  it('a crash fails EVERY waiting photo at once and clears their timers; the next photo gets a fresh worker', async () => {
    const { client, workers } = rig()
    const a = client.convert(heic('A.HEIC')).catch((e: Error) => e.message)
    const b = client.convert(heic('B.HEIC')).catch((e: Error) => e.message)
    await settle()
    expect(vi.getTimerCount()).toBe(2)
    workers[0].crash()
    expect(await a).toBe('HEIC worker crashed')
    expect(await b).toBe('HEIC worker crashed')
    expect(vi.getTimerCount()).toBe(0)

    const c = client.convert(heic('C.HEIC'))
    await settle()
    expect(workers).toHaveLength(2)
    expect(workers[1].posts.map((p) => p.message.id)).toEqual([3])
    workers[1].reply({ id: 3, jpeg: JPEG })
    await expect(c).resolves.toBe(JPEG)
  })

  it('a photo still being READ when the worker crashes goes to the fresh worker, not the crashed one', async () => {
    // The one behaviour that changed in the move. Posted to the crashed worker, this photo had no way
    // to fail early: the crash had already cleared the list it registers in.
    let release!: (b: ArrayBuffer) => void
    let calls = 0
    const { client, workers } = rig(() => {
      calls++
      return calls === 1 ? Promise.resolve(new ArrayBuffer(3)) : new Promise<ArrayBuffer>((r) => { release = r })
    })
    const a = client.convert(heic('A.HEIC')).catch((e: Error) => e.message)
    await settle()
    const b = client.convert(heic('B.HEIC'))
    await settle()
    workers[0].crash()
    expect(await a).toBe('HEIC worker crashed')

    release(new ArrayBuffer(3))
    await settle()
    expect(workers[0].posts, 'nothing more is sent to the crashed worker').toHaveLength(1)
    expect(workers).toHaveLength(2)
    expect(workers[1].posts.map((p) => p.message.id)).toEqual([2])
    workers[1].reply({ id: 2, jpeg: JPEG })
    await expect(b).resolves.toBe(JPEG)
  })

  it('a photo whose bytes cannot be read fails with that reason, starts no worker, and leaves nothing waiting', async () => {
    const { client, workers } = rig(async () => { throw new Error('NotReadableError') })
    await expect(client.convert(heic())).rejects.toThrow(new Error('NotReadableError'))
    expect(workers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the main-thread converter', () => {
  it('asks heic2any for a JPEG at quality 0.9 and returns it', async () => {
    const convert = vi.fn(async () => JPEG)
    const f = heic()
    await expect(convertHeicWith(async () => ({ default: convert }), f)).resolves.toBe(JPEG)
    expect(convert).toHaveBeenCalledWith({ blob: f, toType: 'image/jpeg', quality: 0.9 })
  })

  it('takes the first image when heic2any returns several (a HEIC can hold a burst)', async () => {
    const first = new Blob([new Uint8Array([1])])
    const second = new Blob([new Uint8Array([2])])
    await expect(convertHeicWith(async () => ({ default: async () => [first, second] }), heic())).resolves.toBe(first)
  })

  it('a converter that did not load says so, rather than "is not a function"', async () => {
    await expect(convertHeicWith(async () => ({ default: undefined }), heic())).rejects.toThrow(new Error('heic2any failed to load'))
  })
})
