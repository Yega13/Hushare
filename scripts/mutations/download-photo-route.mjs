// Mutation set for the database reads in src/app/api/download/photo/route.ts -- run with:
//   node scripts/mutations/run.mjs download-photo-route
export default {
  file: 'src/app/api/download/photo/route.ts',
  test: 'tests/route-wiring-download-photo.test.ts',
  mutations: [
    { name: 'a single gateway blip on the photo read fails the download',
      from: "    .eq('id', photoId)\n    .maybeSingle())", to: "    .eq('id', photoId)\n    .maybeSingle(), { attempts: 1 })" },
    { name: 'a single gateway blip on the album read fails the download',
      from: "    .eq('id', photo.album_id)\n    .maybeSingle())", to: "    .eq('id', photo.album_id)\n    .maybeSingle(), { attempts: 1 })" },
    { name: 'A FAILED ALBUM READ TELLS THE GUEST THE PHOTO DOES NOT EXIST',
      from: "  if (albumErr) {\n    return serverError('download-photo', albumErr.message, { publicMessage: 'DB error', context: { step: 'album-read' } })\n  }\n", to: '' },
    { name: 'the panel row no longer says which read failed',
      from: ", context: { step: 'photo-read' } })", to: ' })' },
  ],
}
