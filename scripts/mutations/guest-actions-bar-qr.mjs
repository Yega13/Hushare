// Mutation set for the QR import in src/components/GuestActionsBar.tsx -- run with:
//   node scripts/mutations/run.mjs guest-actions-bar-qr
//
// The QR code is pre-generated on every guest page load. When its chunk would not load, the
// uncaught rejection reached report-error in chunk words and the album was reloaded. Each mutation
// below takes that protection away while the share panel still looks exactly the same.
//
// NOT MUTATED: the `return` before QRCode.toDataURL, which lets the single .catch also cover a
// failed toDataURL. The test's mock makes the IMPORT fail, so the library never runs and a missing
// return cannot be observed from that file. A failed toDataURL would also be reported in words that
// match no reload rule, so the stakes there are an extra row, not a reload.
export default {
  file: 'src/components/GuestActionsBar.tsx',
  test: 'tests/guest-actions-bar-qr.test.tsx',
  mutations: [
    { name: 'THE CATCH IS GONE, so a QR chunk that will not load is an unhandled rejection again',
      from: "      .catch((error: unknown) => reportClientError(optionalLoadFailure('qr', error)))\n", to: "" },
    { name: 'the failure is swallowed, erasing the only evidence of it',
      from: "      .catch((error: unknown) => reportClientError(optionalLoadFailure('qr', error)))",
      to: "      .catch(() => {})" },
    { name: 'the QR failure is reported as a lost upload panel',
      from: "optionalLoadFailure('qr', error)", to: "optionalLoadFailure('upload', error)" },
  ],
}
