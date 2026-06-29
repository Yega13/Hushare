'use client'

import dynamic from 'next/dynamic'
import type { GlobeMarker } from './3d-globe'

// Lazy-load the three.js globe with ssr:false so the ~558 KB three.js bundle:
//   1. never enters the SSR/worker bundle (smaller worker, faster cold start), and
//   2. is code-split into its own client chunk that loads only after the about page
//      mounts — it no longer blocks first paint.
// `ssr:false` dynamic imports are only allowed inside client components, hence this
// thin wrapper (the about page is a server component).
const Globe3D = dynamic(() => import('./3d-globe').then((m) => m.Globe3D), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', aspectRatio: '1 / 1' }} aria-hidden />
  ),
})

interface GlobeConfig {
  atmosphereColor?: string
  atmosphereIntensity?: number
  bumpScale?: number
  autoRotateSpeed?: number
}

export function Globe3DLazy(props: { markers?: GlobeMarker[]; config?: GlobeConfig }) {
  return <Globe3D {...props} />
}
