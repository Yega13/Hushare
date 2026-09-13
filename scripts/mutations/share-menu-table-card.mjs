// Mutation set for the table-card download handler in src/components/owner-toolbar/ShareMenu.tsx --
// run with:
//   node scripts/mutations/run.mjs share-menu-table-card
//
// Each mutation compiles and downloads a card perfectly on a device that fetches jspdf. On one that
// does not, each either reloads the owner's page for nothing, files the failure under the wrong part,
// or leaves the owner staring at a button that silently did nothing.
export default {
  file: 'src/components/owner-toolbar/ShareMenu.tsx',
  test: 'tests/share-menu-wiring.test.ts',
  mutations: [
    { name: 'THE CATCH IS GONE -- the rejection goes unhandled again, and after one reload the owner is shown nothing',
      from: "      if (!failOptionalPart('table-card', error)) showAppToast(t('common.errorGeneric'), 'error')\n", to: '' },
    { name: 'the failure is filed as the QR code, at warn, where an owner who cannot print a card never alerts',
      from: "failOptionalPart('table-card', error)", to: "failOptionalPart('qr', error)" },
    { name: 'the toast shows only when the page IS reloading, so the owner sees it flash and vanish -- and never otherwise',
      from: "if (!failOptionalPart(", to: "if (failOptionalPart(" },
    { name: 'the owner is never told',
      from: " showAppToast(t('common.errorGeneric'), 'error')", to: '' },
  ],
}
