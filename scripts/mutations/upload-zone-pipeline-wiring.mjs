// Mutation set for the dependencies UploadZone.tsx hands lib/upload/image-pipeline -- run with:
//   node scripts/mutations/run.mjs upload-zone-pipeline-wiring
//
// The first five are the swaps the review of ccb9b1d made by hand, every one of which passed the
// whole suite before tests/upload-zone-pipeline-wiring.test.ts existed. Each type-checks. Each costs
// a guest something without an error anywhere.
export default {
  file: 'src/components/UploadZone.tsx',
  test: 'tests/upload-zone-pipeline-wiring.test.ts',
  mutations: [
    { name: 'decode slots unbounded -- a phone decodes every 48 MP photo of a batch at once',
      from: '  acquireDecode: () => decodeSem.acquire(),', to: '  acquireDecode: async () => () => {},' },
    { name: 'the retrying read replaced by a bare arrayBuffer -- stale iPhone file references fail',
      from: '  readBytes: (blob) => readFileRobust(blob),', to: '  readBytes: (blob) => blob.arrayBuffer(),' },
    { name: 'the resample runs at low quality -- every shrunk photo is softer',
      from: "resizeQuality: 'high' })", to: "resizeQuality: 'low' })" },
    { name: 'the platform HEIC decoder is dropped -- Android Chrome guests are told no',
      from: '  decodeImageSource,', to: '  decodeImageSource: decodeBitmapSafe,' },
    { name: 'object URLs are never revoked -- every unreadable photo leaks its whole file',
      from: '  revokeObjectURL: (url) => URL.revokeObjectURL(url),', to: '  revokeObjectURL: () => {},' },
    { name: 'the worker is swapped for the main-thread converter -- the page freezes on every HEIC',
      from: '  convertHeicViaWorker,', to: '  convertHeicViaWorker: convertHeicMainThread,' },
    { name: 'the <img> loader never rejects -- an undisplayable file holds its decode slot forever',
      from: "    img.onerror = () => reject(new Error('img element load failed'))", to: '' },
    { name: 'the decode bound is raised far past what a phone can hold',
      from: '? 2 : 4,', to: '? 64 : 64,' },
    { name: 'the HEIC worker is given a bare arrayBuffer read -- a stale iPhone file reference fails it',
      from: '  readBytes: (file) => readFileRobust(file),', to: '  readBytes: (file) => file.arrayBuffer(),' },
    { name: 'the HEIC worker is started as a classic script, which cannot run the ES module it is',
      from: "{ type: 'module' })", to: "{ type: 'classic' })" },
    { name: 'the main-thread converter loads nothing',
      from: "return convertHeicWith(() => import('heic2any'), file)", to: 'return convertHeicWith(async () => ({ default: undefined }), file)' },
    { name: 'the old worker singleton grows back beside the module',
      from: 'function convertHeicMainThread(file: File): Promise<Blob> {', to: 'let _heicWorker: Worker | null = null\nfunction convertHeicMainThread(file: File): Promise<Blob> {' },
  ],
}
