// Mutation set for the OptionalPanel wrappers in src/app/[slug]/AlbumPageClient.tsx -- run with:
//   node scripts/mutations/run.mjs album-page-panels
//
// Each lazy panel on the album page sits inside OptionalPanel, so one that will not load cannot
// replace the whole album with "Something went wrong" -- which is what 26 production rows since
// 2026-08-22 recorded. Every mutation below still compiles into a working page on a good day.
export default {
  file: 'src/app/[slug]/AlbumPageClient.tsx',
  test: 'tests/album-page-wiring.test.ts',
  mutations: [
    { name: 'THE UPLOAD PANEL IS UNWRAPPED -- the exact panel whose failure blanked albums',
      from: "          <OptionalPanel part=\"upload\">\n          <UploadZone album={album} isOwner={effectiveIsOwner} onPhotosUploaded={handlePhotosUploaded} />\n          </OptionalPanel>",
      to: "          <UploadZone album={album} isOwner={effectiveIsOwner} onPhotosUploaded={handlePhotosUploaded} />" },
    // The realistic mistake: the wrapper survives a refactor, but the panel ends up beside it.
    { name: 'the upload panel is moved OUT of its wrapper, which still exists and contains nothing',
      from: "          <OptionalPanel part=\"upload\">\n          <UploadZone album={album} isOwner={effectiveIsOwner} onPhotosUploaded={handlePhotosUploaded} />\n          </OptionalPanel>",
      to: "          <UploadZone album={album} isOwner={effectiveIsOwner} onPhotosUploaded={handlePhotosUploaded} />\n          <OptionalPanel part=\"upload\">\n          </OptionalPanel>" },
    { name: 'the owner toolbar is unwrapped, so an owner can lose the whole album page',
      from: "          <OptionalPanel part=\"owner-toolbar\">\n", to: "" },
    { name: 'the face finder is unwrapped',
      from: "          <OptionalPanel part=\"face-finder\">\n", to: "" },
    { name: 'the designer is unwrapped',
      from: "          <OptionalPanel part=\"designer\">\n", to: "" },
    { name: 'the upload panel is reported under the wrong part',
      from: "<OptionalPanel part=\"upload\">", to: "<OptionalPanel part=\"designer\">" },
  ],
}
