// Mutation set for the font preloads in src/app/layout.tsx -- run with:
//   node scripts/mutations/run.mjs font-preload
//
// Every font a root layout declares is preloaded on every page unless it says otherwise, so each of
// these is one line away from putting a download back in front of every visitor's first paint.
export default {
  file: 'src/app/layout.tsx',
  test: 'tests/font-preload.test.ts',
  mutations: [
    { name: 'the Armenian HEADING face is preloaded for every visitor again',
      from: '  variable: "--font-serif-am",\n  subsets: ["armenian"],\n  preload: false,\n',
      to: '  variable: "--font-serif-am",\n  subsets: ["armenian"],\n' },
    { name: 'the Armenian BODY face is preloaded for every visitor again',
      from: '  variable: "--font-sans-am",\n  subsets: ["armenian"],\n  preload: false,\n',
      to: '  variable: "--font-sans-am",\n  subsets: ["armenian"],\n' },
    { name: 'Cyrillic Playfair is preloaded for every visitor again',
      from: '  subsets: ["latin"],\n  style: ["normal", "italic"],',
      to: '  subsets: ["latin", "cyrillic"],\n  style: ["normal", "italic"],' },
    { name: 'the monospace face is preloaded for a few numeric labels',
      from: '  variable: "--font-geist-mono",\n  subsets: ["latin"],\n  preload: false,\n',
      to: '  variable: "--font-geist-mono",\n  subsets: ["latin"],\n' },
    { name: 'Cyrillic body text is preloaded for every visitor',
      from: '  variable: "--font-geist-sans",\n  subsets: ["latin"],\n',
      to: '  variable: "--font-geist-sans",\n  subsets: ["latin", "cyrillic"],\n' },
    { name: 'the BODY face is no longer preloaded, so first paint swaps fonts under the reader',
      from: '  variable: "--font-geist-sans",\n  subsets: ["latin"],\n',
      to: '  variable: "--font-geist-sans",\n  subsets: ["latin"],\n  preload: false,\n' },
    { name: 'an Armenian face stops being applied, so Armenian pages lose it entirely',
      from: '${notoSansArmenian.variable} ', to: '' },
  ],
}
