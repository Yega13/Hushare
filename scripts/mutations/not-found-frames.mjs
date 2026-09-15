// Mutation set for src/lib/not-found-frames.ts, the pile of photos on the 404 page -- run with:
//   node scripts/mutations/run.mjs not-found-frames
//
// Each mutation changes what a visitor sees in the frames: a missing or repeated photo, a photo drawn
// at the wrong scale or over the print's white lip, no sand behind it, or frames larger than the files
// were made for.
export default {
  file: 'src/lib/not-found-frames.ts',
  test: 'tests/not-found-frames.test.ts',
  mutations: [
    { name: 'A TYPO IN A PHOTO PATH -- the left frame shows only sand',
      from: "pexels-6942800.webp'", to: "pexels-6942801.webp'" },
    { name: 'two frames show the same photo',
      from: "photo: '/not-found/pexels-21939389.webp'", to: "photo: '/not-found/pexels-6942800.webp'" },
    { name: 'the photo is drawn at its file size, not fitted to the window -- a zoomed-in patch from its middle shows',
      from: "backgroundSize: 'cover',", to: '' },
    { name: 'no sand behind the photo -- a white tile while it loads, or if it fails',
      from: "backgroundColor: '#EFE3CE',", to: '' },
    { name: 'NO PHOTOS AT ALL -- three empty sand tiles',
      from: 'backgroundImage: `url("${photo}")`,', to: '' },
    { name: 'the photo covers the white lip at the bottom of the print',
      from: 'bottom: FRAME.bottom,', to: 'bottom: FRAME.top,' },
    { name: 'bigger frames stretch the photos past the size they were made for',
      from: 'width: 108,', to: 'width: 150,' },
  ],
}
