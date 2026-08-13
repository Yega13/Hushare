export type SettingsSection = 'media' | 'slideshow' | 'guests' | 'files' | 'danger' | 'customUrl' | 'password' | 'collection' | 'reveal'

export type CollectionSummary = {
  id: string
  name: string
  slug: string
  album_count: number
  contains_album: boolean
}
