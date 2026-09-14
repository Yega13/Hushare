// Mutation set for src/components/photo-grid/LightboxOverlay.tsx -- run with:
//   node scripts/mutations/run.mjs lightbox-overlay
//
// The full-screen viewer every guest opens. Each mutation below still renders a working-looking
// viewer -- and hands a guest the owner's controls, closes the viewer on every arrow tap, misstates the
// count, or offers a download that cannot work.
export default {
  file: 'src/components/photo-grid/LightboxOverlay.tsx',
  test: 'tests/lightbox-overlay.test.tsx',
  mutations: [
    // ── what a guest can do to the album ────────────────────────────────────────────────────────
    { name: 'A GUEST GETS THE HEADER-PHOTO CONTROL',
      from: '{isOwner && !slideshowMode && (', to: '{!slideshowMode && (' },
    { name: 'A GUEST GETS DELETE AND SETTINGS',
      from: '{isOwner && (', to: '{true && (' },

    // ── taps ────────────────────────────────────────────────────────────────────────────────────
    { name: 'every tap on Next also closes the viewer',
      from: 'onClick={(e) => { e.stopPropagation(); onNext() }}', to: 'onClick={() => { onNext() }}' },
    // NOT MUTATED: removing Download's own stopPropagation. The controls row it sits in stops the
    // click as well (`onClick={(e) => e.stopPropagation()}` on the row), so the viewer stays open
    // either way -- the mutant survived on 2026-09-14 because it is equivalent, not because a test
    // is missing. The arrows sit outside that row, which is why their mutation IS observable.
    { name: 'a tap on the dark background no longer closes the viewer',
      from: '      onClick={onClose}\n      onWheel=', to: '      onWheel=' },
    { name: 'the slideshow arrows appear in slideshow mode',
      from: '      {!slideshowMode && (\n        <>\n          <button\n            className="absolute left-3', to: '      {true && (\n        <>\n          <button\n            className="absolute left-3' },

    // ── what it says ────────────────────────────────────────────────────────────────────────────
    { name: 'THE COUNTER CLAIMS THE LOADED WINDOW IS THE WHOLE ALBUM ("34 / 40" in a 4,565-photo album)',
      from: 'const shownTotal = Math.max(collectionTotal ?? 0, viewerPhotos.length)', to: 'const shownTotal = viewerPhotos.length' },
    { name: 'the slideshow claims the album total over a 10-photo show',
      from: '<strong>{lightboxIndex + 1} / {viewerPhotos.length}</strong>', to: '<strong>{lightboxIndex + 1} / {shownTotal}</strong>' },
    { name: 'the header-photo control offers to set a photo that already is the header',
      from: "title={coverPhotoId === current.id ? t('lb.clearCover') : t('lb.setCover')}", to: "title={t('lb.setCover')}" },

    // ── downloads and deletes ───────────────────────────────────────────────────────────────────
    { name: 'a video offers a download there is no file for',
      from: "{!slideshowMode && current.media_type !== 'video' && (", to: '{!slideshowMode && (' },
    { name: 'a photo that failed to load can still be "downloaded"',
      from: 'disabled={broken.has(current.id)}', to: 'disabled={false}' },
    { name: 'delete can be tapped again while the photo is already being deleted',
      from: 'disabled={deleting === current.id}', to: 'disabled={false}' },
    { name: 'REMOVING A SLIDE DELETES THE PHOTO FROM THE ALBUM',
      from: 'onRemoveFromSlideshow(current.id) }}', to: 'onDelete(current) }}' },
  ],
}
