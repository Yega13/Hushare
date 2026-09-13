// Mutation set for src/components/OptionalPanel.tsx -- run with:
//   node scripts/mutations/run.mjs optional-panel
//
// lib/optional-load decides, and its failOptionalPart carries the decision out (scripts/mutations/
// optional-fail proves that half). This proves the component hands every failure to it, with the
// component that threw, under its own part -- and that the guest is left with a translated line that
// does something, where they can see it.
export default {
  file: 'src/components/OptionalPanel.tsx',
  test: 'tests/optional-panel.test.tsx',
  mutations: [
    { name: 'THE FAILURE IS SWALLOWED -- contained, never reported, and a stale deploy never heals itself',
      from: "      onError={(error, info) => { failOptionalPart(part, error, info.componentStack) }}", to: "      onError={() => {}}" },
    { name: 'the component that threw never reaches the report',
      from: "failOptionalPart(part, error, info.componentStack)", to: "failOptionalPart(part, error)" },
    { name: 'every failure is filed under the upload panel, whichever part broke',
      from: "failOptionalPart(part, error, info.componentStack)", to: "failOptionalPart('upload', error, info.componentStack)" },
    { name: 'the fallback is dropped, so the guest reads the untranslated default instead',
      from: "      fallback={", to: "      data-fallback={" },
    { name: "the guest's retry does nothing",
      from: "            onClick={onRetry}", to: "            onClick={() => {}}" },
    { name: 'the fallback line is hard-coded English instead of translated',
      from: "            {t('common.errorGeneric')}", to: "            {'Something went wrong.'}" },
    { name: "the designer's fallback no longer floats -- it appears below the photo grid, out of the owner's sight",
      from: "style={floating ? ", to: "style={false ? " },
    { name: 'EVERY fallback floats, covering the top of the album for an ordinary panel',
      from: "style={floating ? ", to: "style={true ? " },
  ],
}
