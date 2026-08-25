'use client'

import { useRef, useState } from 'react'
import { CircleUserRound, Loader2 } from 'lucide-react'
import { showAppToast } from '@/components/AppToast'
import { snapshotFileRobust } from '@/lib/file-read'
import { clearAvatarCache } from '@/lib/use-account-avatar'

// Your picture, on your own account.
//
// SEEN ONLY BY YOU, which was a deliberate choice rather than a limitation. The alternative — a
// picture that also appears to every guest opening an album you own — is a nicer feature and a worse
// default: a photo somebody uploads for their own dashboard suddenly being published to everyone
// they sent a link to is exactly the kind of surprise people are right to be angry about. If that is
// wanted it should be its own explicit switch, not a consequence of this one.
//
// Resized in the browser before it goes anywhere. A phone camera produces 3-8MB for something that
// is displayed at 96 pixels, and uploading that would be slow for the person doing it and pointless
// for everyone.
const DISPLAY_PX = 512
const MAX_SOURCE_BYTES = 12 * 1024 * 1024

// Decoding a picked file is not reliable the first time, and this codebase already knew that.
//
// A File from an <input> is a REFERENCE to something on disk, and on Windows and on phones that
// reference can go stale between the pick and the read — the same NotReadableError that
// snapshotFileRobust was written for on the upload path. It shows up as "the source image could not
// be decoded" and it goes away when you try again, which is exactly what happened here.
//
// So: take a stable in-memory copy first, then decode. And decode twice before giving up, because
// the copy removes one cause of failure and not every cause.
async function decodeSquare(file: File): Promise<ImageBitmap> {
  const stable = (await snapshotFileRobust(file)) ?? file
  try {
    return await createImageBitmap(stable)
  } catch {
    return await createImageBitmap(stable)
  }
}

async function squareThumbnail(file: File): Promise<Blob> {
  const bitmap = await decodeSquare(file)
  try {
    // Centre crop to a square first, so a portrait photo becomes a face rather than a letterboxed
    // strip with two grey bars.
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = DISPLAY_PX
    canvas.height = DISPLAY_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas context')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, DISPLAY_PX, DISPLAY_PX)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88))
    if (!blob) throw new Error('encode failed')
    return blob
  } finally {
    // Frees the decoded image immediately rather than at the next collection — this runs on phones.
    bitmap.close()
  }
}

export default function AvatarPicker({
  initialUrl,
  email,
}: {
  initialUrl: string | null
  email: string
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function choose(file: File) {
    if (!file.type.startsWith('image/')) {
      showAppToast('That file is not an image.', 'error')
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      showAppToast('That image is very large — try a smaller one.', 'error')
      return
    }
    setBusy(true)
    try {
      const blob = await squareThumbnail(file)
      const presign = await fetch('/api/account/avatar/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'image/jpeg', fileName: 'avatar.jpg', fileSize: blob.size }),
      })
      if (!presign.ok) throw new Error((await presign.json().catch(() => ({}))).error ?? 'Upload failed')
      const { presignedUrl, publicUrl } = await presign.json() as { presignedUrl: string; publicUrl: string }

      const put = await fetch(presignedUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
      if (!put.ok) throw new Error('Upload failed')

      // Saved only after the bytes are actually in place, so the account never points at an object
      // that does not exist.
      const save = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: publicUrl }),
      })
      if (!save.ok) throw new Error((await save.json().catch(() => ({}))).error ?? 'Could not save')

      setUrl(publicUrl)
      clearAvatarCache()
      showAppToast('Picture updated.', 'success')
    } catch (e) {
      // A browser's own decode message ("The source image could not be decoded") is not a sentence
      // to show a person. Our own API messages are written for people and are passed through; a
      // DOMException is translated into something that says what to do about it.
      const raw = e instanceof Error ? e.message : ''
      const isDecode = e instanceof DOMException || /decode|source image|not be read/i.test(raw)
      showAppToast(
        isDecode
          ? 'That picture could not be opened. Try another one, or a screenshot of it.'
          : raw || 'Could not update your picture.',
        'error',
      )
    } finally {
      setBusy(false)
      // Cleared so choosing the SAME file again still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: null }),
      })
      if (!res.ok) throw new Error('Could not remove')
      setUrl(null)
      clearAvatarCache()
      showAppToast('Picture removed.', 'success')
    } catch {
      showAppToast('Could not remove your picture.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div
        style={{
          width: 72, height: 72, borderRadius: '50%', flex: 'none',
          background: '#F5F0E8', border: '1px solid #DDD5C5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', color: '#A89880',
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" width={72} height={72} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <CircleUserRound style={{ width: 32, height: 32 }} aria-hidden="true" />
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, color: '#2A211C', fontWeight: 600, marginBottom: 2 }}>Your picture</p>
        <p style={{ fontSize: 11.5, color: '#8B6F4E', marginBottom: 8 }}>
          Only you see this — it is not shown to album guests.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="font-semibold rounded-lg px-3 py-1.5 text-xs transition hover:opacity-90 disabled:opacity-60"
            style={{ background: '#630826', color: '#FDFAF5' }}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : url ? 'Change' : 'Add a picture'}
          </button>
          {url && !busy && (
            <button
              type="button"
              onClick={remove}
              className="rounded-lg px-3 py-1.5 text-xs transition hover:opacity-80"
              style={{ color: '#8B6F4E', border: '1px solid #DDD5C5' }}
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          aria-label={`Choose a picture for ${email}`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f) }}
        />
      </div>
    </div>
  )
}
