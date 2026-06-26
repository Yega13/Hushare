import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/types'

// In the new system all videos are Cloudflare Stream — there is no R2 mirror URL
// and no direct downloadable video file, so downloading video is not supported.
// Images: navigate to the download route which redirects to a presigned R2 URL
// with Content-Disposition: attachment so the browser triggers a save dialog.
export function downloadPhoto(photo: Photo): void {
  if (photo.media_type === 'video') {
    showAppToast('Video download is not available.', 'error')
    return
  }
  const a = document.createElement('a')
  a.href = `/api/download/photo?id=${encodeURIComponent(photo.id)}`
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
