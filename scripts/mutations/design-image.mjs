// Mutation set for src/lib/design-image.ts -- run with: node scripts/mutations/run.mjs design-image
//
// Every one of these is invisible to the owner who uploads: the header still appears. The cost lands on
// every guest who opens the album, as a 10 MB first paint, a black box around a logo, or an owner
// told their picture cannot be used when it uploaded fine yesterday.
export default {
  file: 'src/lib/design-image.ts',
  test: 'tests/design-image.test.ts',
  mutations: [
    { name: 'THE CAMERA-SIZE HEADER IS STORED AS IT CAME: the pixel size is not checked',
      from: "    if (original && img && Math.max(img.width, img.height) <= maxEdge) {",
      to: "    if (original) {" },
    { name: 'an image exactly at the edge cap is redrawn for nothing',
      from: "    if (original && img && Math.max(img.width, img.height) <= maxEdge) {",
      to: "    if (original && img && Math.max(img.width, img.height) < maxEdge) {" },
    { name: 'an original over the byte cap is kept and sent to an endpoint that refuses it',
      from: "      if (blob.size <= maxBytes) original = blob",
      to: "      original = blob" },
    { name: 'a transparent logo can fall back to JPEG and get a black background',
      from: "    ? [['image/webp', 0.9], ['image/png', 1]]",
      to: "    ? [['image/webp', 0.9], ['image/jpeg', 0.92], ['image/png', 1]]" },
    { name: 'the type ASKED for is recorded instead of the type the canvas produced',
      from: "  if (redrawn && redrawn.size <= maxBytes) return { ok: true, blob: redrawn, type: redrawn.type }",
      to: "  if (redrawn && redrawn.size <= maxBytes) return { ok: true, blob: redrawn, type: 'image/webp' }" },
    { name: 'a redraw still over the byte cap is accepted',
      from: "  if (redrawn && redrawn.size <= maxBytes) return { ok: true, blob: redrawn, type: redrawn.type }",
      to: "  if (redrawn) return { ok: true, blob: redrawn, type: redrawn.type }" },
    { name: 'AN OWNER IS BLOCKED from a picture the browser cannot redraw, though it uploaded before',
      from: "  if (original) return { ok: true, blob: original, type: file.type }\n",
      to: "" },
    { name: 'an unreadable Android pick is no longer recovered through the redraw',
      from: "  const img = await deps.decode(file).catch(() => null)",
      to: "  const img = original ? await deps.decode(file).catch(() => null) : null" },
    { name: 'small images are enlarged to the cap',
      from: "  const scale = Math.min(1, maxEdge / Math.max(width, height))",
      to: "  const scale = maxEdge / Math.max(width, height)" },
    { name: 'a very thin image is drawn zero pixels tall',
      from: "height: Math.max(1, Math.round(height * scale)) }",
      to: "height: Math.round(height * scale) }" },
    { name: 'the decoded image is never released (a blob URL leaked per upload)',
      from: "    img?.release()\n", to: "" },
  ],
}
