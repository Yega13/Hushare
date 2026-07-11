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

// Returns the EXIF orientation (1–8) of a JPEG, or 1 when absent/unparseable.
// Needed because stripExifFromJpeg drops APP1 wholesale — including the orientation tag.
// A JPEG whose display depends on that tag must be re-encoded (pixels rotated) rather than
// losslessly stripped, or it uploads sideways. Callers check this BEFORE stripping.
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let i = 2
  while (i < bytes.length - 1) {
    while (i < bytes.length - 1 && bytes[i] === 0xff && bytes[i + 1] === 0xff) i++
    if (i >= bytes.length - 1 || bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xda) break // SOS — EXIF never appears after scan data starts
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue }
    if (i + 4 > bytes.length) break
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    if (segLen < 2 || i + 2 + segLen > bytes.length) break
    if (marker === 0xe1 && segLen >= 16) {
      const p = i + 4
      // "Exif\0\0" preamble, then the TIFF header
      if (
        bytes[p] === 0x45 && bytes[p + 1] === 0x78 && bytes[p + 2] === 0x69 &&
        bytes[p + 3] === 0x66 && bytes[p + 4] === 0x00 && bytes[p + 5] === 0x00
      ) {
        const tiff = p + 6
        const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
        const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d
        if (little || big) {
          const segEnd = i + 2 + segLen
          const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1])
          const u32 = (o: number) =>
            little
              ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
              : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
          const ifd = tiff + u32(tiff + 4)
          if (ifd + 2 <= segEnd) {
            const count = u16(ifd)
            for (let e = 0; e < count; e++) {
              const entry = ifd + 2 + e * 12
              if (entry + 12 > segEnd) break
              if (u16(entry) === 0x0112) {
                const v = u16(entry + 8)
                return v >= 1 && v <= 8 ? v : 1
              }
            }
          }
        }
      }
      return 1 // APP1 present but no readable orientation
    }
    i += 2 + segLen
  }
  return 1
}

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
