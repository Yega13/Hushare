// English is the SOURCE dictionary — it holds every key. ru/hy provide overrides; anything
// missing falls back to the English string here. Flat dot-namespaced keys keep merge + lookup
// trivial. Add keys here first, then translate in ru.ts / hy.ts.
export const en = {
  // language switcher
  'lang.label': 'Language',
  'account.language.title': 'Language',
  'account.language.hint': 'Choose the language for the Hushare website.',

  // home hero
  'home.eyebrow': 'No account · No friction',
  'home.title.line1': 'Every moment,',
  'home.title.line2': 'beautifully kept',
  'home.subtitle': 'Create a shared album and let anyone add photos with just a link — no sign-up, no app download.',
  'home.nameLabel': 'Name your album',
  'home.namePlaceholder': "e.g. Anna & David's Wedding",
  'home.createBtn': 'Create Album',
  'home.creating': 'Creating your album…',
  'home.privateLinkNote': "You'll receive a private link to manage your album",
  'home.errorName': 'Please give your album a name',
  'common.errorGeneric': 'Something went wrong. Please try again.',

  // upload zone (guest upload UI)
  'upload.add': 'Add photos & videos',
  'upload.drop': 'Drop to upload',
  'upload.dragdrop': 'Drag & drop or',
  'upload.browse': 'click to browse',
  'upload.uploaded': '{n} uploaded',
  'upload.failed': '{n} failed',
  'upload.retry': 'Retry',
  'upload.clear': 'Clear',

  // album header
  'album.photos': '{n} photos',
  'album.created': 'Created {date}',
  'album.ownerView': 'Owner view',
  'album.rename': 'Rename album',
  'album.saveTitle': 'Save album title',
  'album.cancelRename': 'Cancel rename',
  'album.dblclickRename': 'Double-click to rename',
  'album.titleRequired': 'Album title is required.',
  'album.renameFailed': 'Rename failed.',
  'album.renamed': 'Album renamed.',
  'common.networkError': 'Network error',

  // guest actions bar (view/share/download an album)
  'guest.slideshow': 'Slideshow',
  'guest.faceFinder': 'Face Finder',
  'guest.downloadAll': 'Download all',
  'guest.zipping': 'Zipping…',
  'guest.share': 'Share',
  'guest.shareAlbum': 'Share album',
  'guest.shareVia': 'Send via messages, apps or copy',
  'guest.copyLink': 'Copy link',
  'guest.qr': 'QR code',
  'guest.qrScan': 'Scan to open this album.',
  'guest.close': 'Close',
  'guest.linkCopied': 'Link copied.',
  'guest.copyFail': 'Could not copy — please copy the link manually.',
  'guest.noPhotos': 'No photos to show yet.',

  // "your albums on this device" recovery block
  'myAlbums.title': 'Your albums on this device',
  'myAlbums.subtitle': 'Albums you created here. Tap to manage — these links are private to you.',
  'myAlbums.saved': '{n} saved',
  'myAlbums.manage': 'Manage',
  'myAlbums.remove': 'Remove',
} as const

export type Dict = typeof en
export type DictKey = keyof Dict
