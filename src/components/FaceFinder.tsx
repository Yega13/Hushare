'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Camera, Upload, Search, ChevronLeft } from 'lucide-react'
import type { Photo } from '@/types'

type Props = {
  albumSlug: string
  photos: Photo[]
  onClose: () => void
}

type Step = 'indexing' | 'selfie' | 'searching' | 'results' | 'error'

type Match = { photoId: string; similarity: number }

// Downscale + re-encode the selfie before upload. Phone cameras produce 3-8 MB JPEGs, and the
// face-search Worker has to fetch, base64-encode and re-sign that whole payload for AWS. Large
// payloads hit Cloudflare's CPU limits; Rekognition only needs ~1024px (faces of ~50px match).
// Best-effort — fall back to the original file on any failure.
const SELFIE_MAX_DIM = 1024
const SELFIE_QUALITY = 0.85
async function downscaleSelfie(file: File): Promise<File> {
  if (file.size < 400 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const longest = Math.max(bitmap.width, bitmap.height)
      if (longest <= SELFIE_MAX_DIM) return file
      const scale = SELFIE_MAX_DIM / longest
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, w, h)
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', SELFIE_QUALITY),
      )
      if (!blob) return file
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'selfie'
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}

export default function FaceFinder({ albumSlug, photos, onClose }: Props) {
  const [step, setStep] = useState<Step>('indexing')
  const [indexed, setIndexed] = useState(0)
  const [total, setTotal] = useState(0)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  // Two separate inputs so "Upload from files" doesn't permanently strip the capture attribute
  // off the shared element (removeAttribute('capture') is irreversible for that DOM node).
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const indexingDone = useRef(false)
  const indexingAbort = useRef<AbortController | null>(null)
  const errorOrigin = useRef<'indexing' | 'search'>('indexing')

  // Only images are indexable
  const imagePhotos = photos.filter((p) => p.media_type !== 'video')

  const runIndexing = useCallback(async () => {
    if (indexingDone.current) return

    // Fast path: if every image we know about is already indexed, skip straight to selfie.
    if (imagePhotos.length > 0 && imagePhotos.every((p) => p.face_ids != null)) {
      setTotal(imagePhotos.length)
      setIndexed(imagePhotos.length)
      indexingDone.current = true
      setStep('selfie')
      return
    }

    const abort = new AbortController()
    indexingAbort.current = abort
    const { signal } = abort

    let ids: string[] = []
    let dbTotal = imagePhotos.length
    try {
      const res = await fetch(`/api/album/face-index?slug=${encodeURIComponent(albumSlug)}`, { signal })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string }
        errorOrigin.current = 'indexing'
        setStep('error')
        setErrorMsg(errBody.error ?? 'Failed to start indexing. Please try again.')
        return
      }
      const data = (await res.json()) as { ids: string[]; total: number }
      ids = data.ids
      dbTotal = data.total || imagePhotos.length
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      errorOrigin.current = 'indexing'
      setStep('error')
      setErrorMsg('Network error during indexing. Please try again.')
      return
    }

    const alreadyIndexed = Math.max(0, dbTotal - ids.length)
    setTotal(dbTotal)
    setIndexed(alreadyIndexed)

    if (ids.length === 0) {
      indexingDone.current = true
      setStep('selfie')
      return
    }

    // Concurrent workers, each assigned every Nth photo (interleaved). Higher = faster
    // indexing; well within Rekognition's per-account TPS limits for typical album sizes.
    const CONCURRENT = 8
    let done = 0

    async function indexWorker(startIdx: number) {
      for (let i = startIdx; i < ids.length; i += CONCURRENT) {
        if (signal.aborted) return
        try {
          await fetch('/api/album/face-index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ slug: albumSlug, photoId: ids[i] }),
            signal,
          })
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') return
          // network error on a single photo — continue with the rest
        }
        done++
        setIndexed(alreadyIndexed + done)
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT }, (_, i) => indexWorker(i)))

    if (signal.aborted) return
    indexingDone.current = true
    setStep('selfie')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumSlug, imagePhotos.length])

  useEffect(() => {
    runIndexing()
  }, [runIndexing])

  // Cancel in-flight indexing if the modal closes mid-index.
  useEffect(() => {
    return () => { indexingAbort.current?.abort() }
  }, [])

  // Lock background scroll while the modal is open. Plain `overflow: hidden` does NOT stop
  // touch scrolling on mobile, so pin the body with position:fixed and restore the scroll
  // position on close — the reliable cross-mobile scroll lock.
  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Revoke the current selfie object URL on unmount (tracked via ref for latest value).
  const selfiePreviewRef = useRef<string | null>(null)
  useEffect(() => { selfiePreviewRef.current = selfiePreview }, [selfiePreview])
  useEffect(() => {
    return () => {
      if (selfiePreviewRef.current) URL.revokeObjectURL(selfiePreviewRef.current)
    }
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelfieFile(file)
    setErrorMsg('')
    setSelfiePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  async function handleSearch() {
    if (!selfieFile) return
    setStep('searching')

    try {
      const compactSelfie = await downscaleSelfie(selfieFile)
      const form = new FormData()
      form.append('slug', albumSlug)
      form.append('selfie', compactSelfie)

      const res = await fetch('/api/album/face-search', { method: 'POST', body: form })
      const bodyText = await res.text()
      let json: { matches?: Match[]; error?: string }
      try {
        json = JSON.parse(bodyText) as { matches?: Match[]; error?: string }
      } catch {
        errorOrigin.current = 'search'
        setStep('error')
        setErrorMsg(`Server error (${res.status}): ${bodyText.slice(0, 300) || '(empty response)'}`)
        return
      }

      if (!res.ok) {
        // 422 = user-recoverable (no face / not indexed yet) → back to selfie with an inline note.
        if (res.status === 422) {
          setErrorMsg(json.error ?? 'Could not find a face in this photo.')
          setStep('selfie')
          return
        }
        errorOrigin.current = 'search'
        setStep('error')
        setErrorMsg(json.error ?? `Search failed (${res.status})`)
        return
      }

      setMatches(json.matches ?? [])
      setStep('results')
    } catch {
      errorOrigin.current = 'search'
      setStep('error')
      setErrorMsg('Network error. Please try again.')
    }
  }

  function reset() {
    if (selfiePreview) URL.revokeObjectURL(selfiePreview)
    setSelfieFile(null)
    setSelfiePreview(null)
    setMatches([])
    setErrorMsg('')
    setStep('selfie')
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const matchedPhotos = matches
    .map((m) => ({ ...m, photo: photos.find((p) => p.id === m.photoId) }))
    .filter((m): m is { photoId: string; similarity: number; photo: Photo } => !!m.photo)

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(10,20,10,0.82)', backdropFilter: 'blur(8px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
          style={{ background: '#2B0A15', maxHeight: '92dvh' }}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
            <div className="flex items-center gap-2">
              {step === 'results' && (
                <button onClick={reset} className="hush-press p-1 rounded-full hover:opacity-70 transition" style={{ color: '#C77690' }}>
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-serif)', color: '#FDFAF5' }}>
                Face Finder
              </h2>
            </div>
            <button onClick={onClose} className="hush-press p-1.5 rounded-full hover:opacity-70 transition" style={{ color: '#C77690' }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 pb-6">

            {step === 'indexing' && (
              <div className="flex flex-col items-center gap-6 py-8 text-center">
                <div className="relative w-16 h-16">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(199,118,144,0.2)" strokeWidth="6" />
                    <circle
                      cx="32" cy="32" r="28" fill="none" stroke="#C77690" strokeWidth="6"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - (total > 0 ? indexed / total : 0))}`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: '#FDFAF5' }}>
                    {total > 0 ? Math.round((indexed / total) * 100) : 0}%
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-base mb-1" style={{ color: '#FDFAF5' }}>
                    Scanning album photos
                  </p>
                  <p className="text-sm" style={{ color: '#B0808F' }}>
                    {indexed} of {total} photos ready
                  </p>
                </div>
                <p className="text-xs max-w-xs leading-relaxed" style={{ color: '#8A5A6A' }}>
                  This runs once. Future searches are instant.
                </p>
              </div>
            )}

            {step === 'selfie' && (
              <div className="flex flex-col gap-5 py-4">
                {errorMsg && (
                  <div
                    className="rounded-xl px-4 py-3 text-sm text-center"
                    style={{ background: 'rgba(192,57,43,0.15)', color: '#F4A89B', border: '1px solid rgba(192,57,43,0.35)' }}
                  >
                    {errorMsg}
                  </div>
                )}
                <p className="text-sm text-center" style={{ color: '#E8C4D0' }}>
                  Take or upload a photo of yourself — we&apos;ll find every photo you appear in.
                </p>

                {selfiePreview ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selfiePreview}
                        alt="Your selfie"
                        className="w-40 h-40 rounded-2xl object-cover mx-auto"
                        style={{ border: '2px solid rgba(199,118,144,0.4)' }}
                      />
                    </div>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        onClick={reset}
                        className="hush-press flex-1 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-80"
                        style={{ background: 'rgba(255,255,255,0.06)', color: '#E8C4D0', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        Retake
                      </button>
                      <button
                        onClick={handleSearch}
                        className="hush-press flex-1 py-2.5 rounded-xl text-sm font-bold transition hover:opacity-90 flex items-center justify-center gap-2"
                        style={{ background: '#630826', color: '#FDFAF5' }}
                      >
                        <Search className="w-4 h-4" />
                        Search
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="hush-press w-full py-10 rounded-2xl flex flex-col items-center gap-3 transition hover:opacity-80"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '2px dashed rgba(199,118,144,0.3)' }}
                    >
                      <Camera className="w-8 h-8" style={{ color: '#C77690' }} />
                      <span className="text-sm font-semibold" style={{ color: '#E8C4D0' }}>Take a photo or choose from library</span>
                      <span className="text-xs" style={{ color: '#8A5A6A' }}>JPG, PNG — max 5MB</span>
                    </button>
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFileChange} />
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="hush-press w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition hover:opacity-80"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#C77690' }}
                    >
                      <Upload className="w-4 h-4" />
                      Upload from files
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 'searching' && (
              <div className="flex flex-col items-center gap-5 py-10 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#C77690', borderTopColor: 'transparent' }} />
                <p className="font-semibold" style={{ color: '#FDFAF5' }}>Searching for your face…</p>
              </div>
            )}

            {step === 'results' && (
              <div className="flex flex-col gap-4 py-2">
                {matchedPhotos.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="font-semibold mb-2" style={{ color: '#FDFAF5' }}>No matches found</p>
                    <p className="text-sm mb-5" style={{ color: '#B0808F' }}>
                      Try a clearer selfie facing the camera in good lighting.
                    </p>
                    <button
                      onClick={reset}
                      className="hush-press px-5 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-90"
                      style={{ background: '#630826', color: '#FDFAF5' }}
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm" style={{ color: '#E8C4D0' }}>
                      Found you in <strong style={{ color: '#FDFAF5' }}>{matchedPhotos.length}</strong> photo{matchedPhotos.length !== 1 ? 's' : ''}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {matchedPhotos.map(({ photo, similarity }) => (
                        <button
                          key={photo.id}
                          onClick={() => setLightbox(photo)}
                          className="relative aspect-square rounded-xl overflow-hidden hover:opacity-90 transition"
                          style={{ border: '1px solid rgba(199,118,144,0.2)' }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.thumb_url ?? photo.url ?? ''}
                            alt={photo.caption ?? 'Photo'}
                            className="w-full h-full object-cover"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] font-semibold text-right"
                            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', color: '#FDFAF5' }}
                          >
                            {Math.round(similarity)}%
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <p className="font-semibold" style={{ color: '#FDFAF5' }}>Something went wrong</p>
                <p className="text-sm max-w-xs" style={{ color: '#B0808F' }}>{errorMsg}</p>
                <button
                  onClick={() => {
                    setErrorMsg('')
                    if (errorOrigin.current === 'search') {
                      setStep('selfie')
                    } else {
                      indexingAbort.current?.abort()
                      indexingAbort.current = null
                      indexingDone.current = false
                      setStep('indexing')
                      runIndexing()
                    }
                  }}
                  className="hush-press px-5 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-90"
                  style={{ background: '#630826', color: '#FDFAF5' }}
                >
                  Try again
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url ?? lightbox.thumb_url ?? ''}
            alt={lightbox.caption ?? 'Photo'}
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-full hover:opacity-70 transition"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  )
}
