// Mutation set for how src/app/not-found.tsx draws the pile of photos -- run with:
//   node scripts/mutations/run.mjs not-found-page
//
// Each mutation leaves the page rendering but changes the pile a visitor sees: windows with no photo
// and no sand, prints that lose their mount and tilt, prints that stack flat or spill over the
// heading, an <img> that shows a broken-image icon when a load fails, or a pile of two.
export default {
  file: 'src/app/not-found.tsx',
  test: 'tests/not-found-frames.test.ts',
  mutations: [
    { name: 'THE WINDOWS LOSE THEIR STYLE -- no photo, no sand, nothing drawn',
      from: 'style={windowStyle(frame.photo)}', to: 'style={{}}' },
    { name: 'the prints lose their mount, size and tilt',
      from: 'style={frameStyle(frame)}', to: 'style={{}}' },
    { name: 'an <img> comes back inside the window -- a broken-image icon whenever a load fails',
      from: '<span style={windowStyle(frame.photo)} />',
      to: '<span style={windowStyle(frame.photo)}><img src={frame.photo} alt="" /></span>' },
    { name: 'only two frames are drawn',
      from: '{FRAMES.map((frame) => (', to: '{FRAMES.slice(0, 2).map((frame) => (' },
    { name: 'THE PRINTS STACK -- no tilt, no spread, one straight print dead centre',
      from: ' className="hush-404-frame"', to: '' },
    { name: 'no resting position -- the prints sit flat at the centre during their delay, and for good with reduced motion',
      from: '  transform: translate(var(--x), var(--y)) rotate(var(--r));', to: '' },
    { name: 'the style no longer matches the class -- the prints stack',
      from: '.hush-404-frame {', to: '.hush-404-frames {' },
    { name: 'the drift names keyframes that do not exist -- the prints never move',
      from: 'animation: hush-404-drift ', to: 'animation: hush-404-float ' },
    { name: 'the pile has no height -- the prints spill over the logo and heading',
      from: 'height: 150,', to: 'height: 0,' },
    { name: 'the pile stops positioning the prints -- they leave it and land over the heading',
      from: "position: 'relative', ", to: '' },
  ],
}
