// Mutation set for src/lib/exif.ts -- run with:
//   node scripts/mutations/run.mjs exif
//
// The code that keeps a guest's location out of every photo. Each mutation below still produces a
// valid-looking file -- and each one either stores a GPS position, stores a photo sideways, flattens a
// wide-gamut photo's colours, or corrupts the file on its way through.
export default {
  file: 'src/lib/exif.ts',
  test: 'tests/exif.test.ts',
  mutations: [
    // ── orientation ─────────────────────────────────────────────────────────────────────────────
    { name: 'the orientation is looked for in the wrong segment, so every rotated photo reads as upright',
      from: 'if (marker === 0xe1 && segLen >= 16) {', to: 'if (marker === 0xe2 && segLen >= 16) {' },
    { name: 'an out-of-range orientation is trusted',
      from: 'return v >= 1 && v <= 8 ? v : 1', to: 'return v' },
    { name: 'big-endian EXIF is read as little-endian, so those cameras read as upright',
      from: 'const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49', to: 'const little = true' },
    { name: 'the orientation scan runs on into the image data',
      from: '    if (marker === 0xda) break // SOS — EXIF never appears after scan data starts\n', to: '' },

    // ── the JPEG strip ──────────────────────────────────────────────────────────────────────────
    { name: 'THE EXIF BLOCK IS KEPT -- every JPEG goes up with its GPS position',
      from: 'const isAppMetadata = (marker >= 0xe1 && marker <= 0xef) && marker !== 0xe2', to: 'const isAppMetadata = (marker >= 0xe3 && marker <= 0xef) && marker !== 0xe2' },
    { name: 'the ICC colour profile is stripped, so wide-gamut iPhone photos lose their colours',
      from: ' && marker !== 0xe2', to: '' },
    { name: 'comments are kept',
      from: 'const isComment = marker === 0xfe', to: 'const isComment = false' },
    { name: 'no JFIF header is added, so a stripped HEIC conversion cannot be decoded again',
      from: '  if (!hasApp0) keep.push(JFIF_APP0)\n', to: '' },
    { name: 'a JPEG over 50 MB is walked anyway',
      from: '  if (bytes.length > 50 * 1024 * 1024) return bytes\n', to: '' },

    // ── PNG ─────────────────────────────────────────────────────────────────────────────────────
    { name: 'THE PNG eXIf CHUNK IS KEPT -- the explicit location carrier',
      from: "const PNG_STRIP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])", to: "const PNG_STRIP = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME'])" },
    { name: 'a PNG with nothing to strip is copied instead of handed back',
      from: "    if (type === 'IEND') break\n  }\n  if (!dropped) return bytes", to: "    if (type === 'IEND') break\n  }" },

    // ── WebP ────────────────────────────────────────────────────────────────────────────────────
    { name: 'the WebP XMP chunk is kept',
      from: "if (type === 'EXIF' || type === 'XMP ') dropped = true", to: "if (type === 'EXIF') dropped = true" },
    { name: 'the RIFF size is not rewritten, so decoders read past the end of the shortened file',
      from: '  new DataView(out.buffer).setUint32(4, out.length - 8, true)\n', to: '' },
    { name: 'the padding byte after an odd-sized chunk is ignored, so every later chunk is misread',
      from: 'const end = pos + 8 + size + (size % 2)', to: 'const end = pos + 8 + size' },
  ],
}
