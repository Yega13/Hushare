import React, { useState, useEffect } from 'react'
import type { Album, Photo } from '@/types'
import { type MediaDisplayFilter, type PhotoFilterChoice } from '@/lib/media-display'
import { showAppToast } from '@/components/AppToast'

type Options = {
  album: Pick<Album, 'media_radius' | 'media_filter'>
  slug: string
  forceGlobalRadius: boolean
  currentId: string | undefined
  lightboxRadiusMax: number | null
  tileRadiusMaxById: Record<string, number>
  onPhotoUpdated: (id: string, patch: Partial<Photo>) => void
}

export type PhotoSettings = {
  settingsPhoto: Photo | null
  settingsRadius: number
  settingsFilter: PhotoFilterChoice
  settingsCaption: string
  settingsAuthor: string
  settingsSaving: boolean
  settingsError: string
  setSettingsPhoto: React.Dispatch<React.SetStateAction<Photo | null>>
  setSettingsRadius: React.Dispatch<React.SetStateAction<number>>
  setSettingsFilter: React.Dispatch<React.SetStateAction<PhotoFilterChoice>>
  setSettingsCaption: React.Dispatch<React.SetStateAction<string>>
  setSettingsAuthor: React.Dispatch<React.SetStateAction<string>>
  openSettings: (photo: Photo) => void
  previewRadiusFor: (photo: Photo) => number
  previewFilterFor: (photo: Photo) => MediaDisplayFilter
  radiusMaxFor: (photo: Photo) => number
  applySettingsRadius: (value: number) => void
  savePhotoSettings: () => Promise<void>
  closeSettings: () => void
}

function radiusFor(
  photo: Photo,
  album: Pick<Album, 'media_radius'>,
  forceGlobalRadius: boolean,
): number {
  return forceGlobalRadius
    ? album.media_radius
    : photo.display_radius ?? album.media_radius
}

function filterFor(
  photo: Photo,
  album: Pick<Album, 'media_filter'>,
): MediaDisplayFilter {
  return (photo.display_filter ?? album.media_filter) as MediaDisplayFilter
}

export function usePhotoSettings({
  album,
  slug,
  forceGlobalRadius,
  currentId,
  lightboxRadiusMax,
  tileRadiusMaxById,
  onPhotoUpdated,
}: Options): PhotoSettings {
  const [settingsPhoto, setSettingsPhoto] = useState<Photo | null>(null)
  const [settingsRadius, setSettingsRadius] = useState(album.media_radius)
  const [settingsFilter, setSettingsFilter] = useState<PhotoFilterChoice>('global')
  const [settingsCaption, setSettingsCaption] = useState('')
  const [settingsAuthor, setSettingsAuthor] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  function radiusMaxFor(photo: Photo): number {
    if (currentId === photo.id && lightboxRadiusMax != null) {
      return lightboxRadiusMax
    }
    return Math.max(1, Math.round(tileRadiusMaxById[photo.id] ?? 144))
  }

  function openSettings(photo: Photo) {
    setSettingsPhoto(photo)
    setSettingsRadius(radiusFor(photo, album, forceGlobalRadius))
    setSettingsFilter(photo.display_filter ?? 'global')
    setSettingsCaption(photo.caption ?? '')
    setSettingsAuthor(photo.author_name ?? '')
    setSettingsError('')
  }

  function previewRadiusFor(photo: Photo): number {
    if (settingsPhoto?.id === photo.id) return settingsRadius
    return radiusFor(photo, album, forceGlobalRadius)
  }

  function previewFilterFor(photo: Photo): MediaDisplayFilter {
    if (settingsPhoto?.id === photo.id) {
      return (settingsFilter === 'global' ? album.media_filter : settingsFilter) as MediaDisplayFilter
    }
    return filterFor(photo, album)
  }

  function applySettingsRadius(value: number) {
    if (!settingsPhoto) return
    const max = radiusMaxFor(settingsPhoto)
    setSettingsRadius(Math.max(0, Math.min(max, Math.round(value))))
  }

  async function savePhotoSettings() {
    if (!settingsPhoto) return
    setSettingsSaving(true)
    setSettingsError('')
    try {
      const res = await fetch('/api/album/photo/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          photo_id: settingsPhoto.id,
          display_radius: settingsRadius === album.media_radius ? null : settingsRadius,
          display_filter: settingsFilter === 'global' ? null : settingsFilter,
          caption: settingsCaption.trim() || null,
          author_name: settingsAuthor.trim() || null,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        display_radius?: number | null
        display_filter?: MediaDisplayFilter | null
        caption?: string | null
        author_name?: string | null
      }
      if (!res.ok) {
        setSettingsError(body.error ?? `Save failed (${res.status})`)
        showAppToast(body.error ?? `Save failed (${res.status})`, 'error')
        return
      }
      onPhotoUpdated(settingsPhoto.id, {
        display_radius: body.display_radius ?? null,
        display_filter: body.display_filter ?? null,
        caption: body.caption ?? null,
        author_name: body.author_name ?? null,
      })
      showAppToast('Media settings saved.')
      setSettingsPhoto(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setSettingsError(message)
      showAppToast(message, 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  // Close the modal immediately and save in the background. Used by the ✕ button so
  // the user can adjust freely and only see one toast when they're done.
  function closeSettings() {
    const photo = settingsPhoto
    const radius = settingsRadius
    const filter = settingsFilter
    const caption = settingsCaption
    const author = settingsAuthor
    setSettingsPhoto(null)
    if (!photo) return
    void fetch('/api/album/photo/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        photo_id: photo.id,
        display_radius: radius === album.media_radius ? null : radius,
        display_filter: filter === 'global' ? null : filter,
        caption: caption.trim() || null,
        author_name: author.trim() || null,
      }),
    }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        display_radius?: number | null
        display_filter?: MediaDisplayFilter | null
        caption?: string | null
        author_name?: string | null
      }
      if (!res.ok) {
        showAppToast(body.error ?? `Save failed (${res.status})`, 'error')
        return
      }
      onPhotoUpdated(photo.id, {
        display_radius: body.display_radius ?? null,
        display_filter: body.display_filter ?? null,
        caption: body.caption ?? null,
        author_name: body.author_name ?? null,
      })
      showAppToast('Media settings saved.')
    }).catch(() => {
      showAppToast('Network error', 'error')
    })
  }

  // Clamp settingsRadius when the available maximum shrinks (e.g. lightbox opens).
  useEffect(() => {
    if (!settingsPhoto) return
    const max = currentId === settingsPhoto.id && lightboxRadiusMax != null
      ? lightboxRadiusMax
      : Math.max(1, Math.round(tileRadiusMaxById[settingsPhoto.id] ?? 144))
    if (settingsRadius > max) setSettingsRadius(max)
  }, [currentId, lightboxRadiusMax, settingsPhoto, settingsRadius, tileRadiusMaxById])

  return {
    settingsPhoto,
    settingsRadius,
    settingsFilter,
    settingsCaption,
    settingsAuthor,
    settingsSaving,
    settingsError,
    setSettingsPhoto,
    setSettingsRadius,
    setSettingsFilter,
    setSettingsCaption,
    setSettingsAuthor,
    openSettings,
    previewRadiusFor,
    previewFilterFor,
    radiusMaxFor,
    applySettingsRadius,
    savePhotoSettings,
    closeSettings,
  }
}
