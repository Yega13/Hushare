// Pure-JS JPEG EXIF stripper. Works in both browser and Cloudflare Workers (no Node.js deps).
// Walks JPEG segment list and drops metadata-bearing segments:
//   APP1 (0xE1) — EXIF + XMP (GPS, camera make/model, timestamps)
//   APP3..APP15 (0xE3..0xEF) — IPTC, Photoshop info, Adobe metadata, vendor extras
//   COM (0xFE) — JPEG comments
// Keeps APP0 (JFIF) for compatibility. Structural markers (DQT, DHT, SOFn, SOS, EOI) are kept.
// APP2 (0xE2, ICC color profile) is intentionally PRESERVED so that wide-gamut photos
// (iPhone Display P3) display correctly in color-managed browsers.
// Minimal 18-byte JFIF APP0 marker (SOI already written separately).
// Some browsers/decoders require either APP0 (JFIF) or APP1 (EXIF) to be present.
// HEIC→JPEG conversions often have only APP1; after stripping it the JPEG has neither,
// causing createImageBitmap to throw "unreadable image file" on re-upload.
const JFIF_APP0 = new Uint8Array([
  0xff, 0xe0, 0x00, 0x10, // APP0 marker + length = 16
  0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
  0x01, 0x01, // version 1.1
  0x00,       // units = 0 (no units)
  0x00, 0x01, // Xdensity = 1
  0x00, 0x01, // Ydensity = 1
  0x00, 0x00, // no thumbnail
])

export function stripExifFromJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  // Skip EXIF stripping for unusually large files — the segment walk is fast due to
  // early SOS break, but a 50 MB+ JPEG is abnormal and not worth the UI freeze risk.
  if (bytes.length > 50 * 1024 * 1024) return bytes
  // Check whether original has APP0 (JFIF/JFXX). If not, inject one after stripping so
  // the output always has a valid introductory marker.
  const hasApp0 = bytes.length > 3 && bytes[2] === 0xff && bytes[3] === 0xe0
  const keep: Uint8Array[] = [bytes.subarray(0, 2)]
  if (!hasApp0) keep.push(JFIF_APP0)
  let i = 2
  while (i < bytes.length - 1) {
    while (i < bytes.length - 1 && bytes[i] === 0xff && bytes[i + 1] === 0xff) i++
    if (i >= bytes.length - 1 || bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xda) {
      keep.push(bytes.subarray(i))
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      keep.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (i + 4 > bytes.length) break
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    if (segLen < 2) break
    const segEnd = i + 2 + segLen
    if (segEnd > bytes.length) break
    const isAppMetadata = (marker >= 0xe1 && marker <= 0xef) && marker !== 0xe2  // preserve APP2 (ICC)
    const isComment = marker === 0xfe
    if (!isAppMetadata && !isComment) {
      keep.push(bytes.subarray(i, segEnd))
    }
    i = segEnd
  }
  const total = keep.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of keep) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
