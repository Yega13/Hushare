import type { DictKey } from './en'

// Armenian overrides. Any key omitted here falls back to English automatically.
export const hy: Partial<Record<DictKey, string>> = {
  'lang.label': 'Լեզու',

  'home.eyebrow': 'Առանց հաշվի · Առանց ավելորդ քայլերի',
  'home.title.line1': 'Յուրաքանչյուր պահ՝',
  'home.title.line2': 'գեղեցիկ պահված',
  'home.subtitle': 'Ստեղծեք ընդհանուր ալբոմ, և ցանկացած մեկը կարող է լուսանկարներ ավելացնել ընդամենը հղումով՝ առանց գրանցման և հավելված ներբեռնելու։',
  'home.nameLabel': 'Անվանեք ձեր ալբոմը',
  'home.namePlaceholder': 'օր. Աննայի և Դավիթի հարսանիք',
  'home.createBtn': 'Ստեղծել ալբոմ',
  'home.creating': 'Ստեղծում ենք ալբոմը…',
  'home.privateLinkNote': 'Դուք կստանաք անձնական հղում՝ ալբոմը կառավարելու համար',
  'home.errorName': 'Խնդրում ենք անվանել ձեր ալբոմը',
  'common.errorGeneric': 'Ինչ-որ բան սխալ գնաց։ Խնդրում ենք նորից փորձել։',

  'myAlbums.title': 'Ձեր ալբոմները այս սարքում',
  'myAlbums.subtitle': 'Ալբոմներ, որ ստեղծել եք այստեղ։ Սեղմեք՝ կառավարելու համար. այս հղումները միայն ձերն են։',
  'myAlbums.saved': '{n} պահված',
  'myAlbums.manage': 'Կառավարել',
  'myAlbums.remove': 'Հեռացնել',
}
