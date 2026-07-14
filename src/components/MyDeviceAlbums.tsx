'use client'

import { useEffect, useState } from 'react'
import { getMyAlbums, forgetAlbum, type MyAlbum } from '@/lib/my-albums'

// "Your albums on this device" — recovery for anonymous creators. Reads localStorage (client-only),
// so it renders nothing on the server and nothing until we've checked. Each entry links back to the
// album's owner (#owner=) management view, so a creator who closed the tab never loses their album.
export default function MyDeviceAlbums() {
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null)

  useEffect(() => {
    setAlbums(getMyAlbums())
  }, [])

  if (!albums || albums.length === 0) return null

  return (
    <section className="hush-container pb-10" aria-label="Your albums on this device">
      <div
        className="rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
        style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', boxShadow: '0 4px 20px rgba(99,8,38,0.05)' }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm sm:text-base" style={{ fontWeight: 700, color: '#630826', fontFamily: 'var(--font-serif)' }}>
            Your albums on this device
          </h2>
          <span className="text-xs" style={{ color: '#8A7A66' }}>{albums.length} saved</span>
        </div>
        <p className="text-xs mb-3" style={{ color: '#8A7A66' }}>
          Albums you created here. Tap to manage — these links are private to you.
        </p>
        <ul className="flex flex-col divide-y" style={{ borderColor: '#EFE7D8' }}>
          {albums.map((a) => (
            <li key={a.slug} className="flex items-center justify-between gap-3 py-2">
              <a
                href={`/${a.slug}#owner=${a.token}`}
                className="flex-1 min-w-0 truncate text-sm hover:underline"
                style={{ color: '#2A211C', fontWeight: 600 }}
              >
                {a.title}
              </a>
              <div className="flex items-center gap-3 shrink-0">
                <a href={`/${a.slug}#owner=${a.token}`} className="text-xs" style={{ color: '#630826', fontWeight: 600 }}>
                  Manage
                </a>
                <button
                  type="button"
                  onClick={() => { forgetAlbum(a.slug); setAlbums(getMyAlbums()) }}
                  className="text-xs"
                  style={{ color: '#8A7A66' }}
                  aria-label={`Remove ${a.title} from this device`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
