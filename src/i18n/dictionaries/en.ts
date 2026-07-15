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

  // "your albums on this device" recovery block
  'myAlbums.title': 'Your albums on this device',
  'myAlbums.subtitle': 'Albums you created here. Tap to manage — these links are private to you.',
  'myAlbums.saved': '{n} saved',
  'myAlbums.manage': 'Manage',
  'myAlbums.remove': 'Remove',
} as const

export type Dict = typeof en
export type DictKey = keyof Dict
