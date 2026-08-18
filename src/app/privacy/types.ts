import type { ReactNode } from 'react'

// Shared by the three language files so a section is the same shape in every language and the page
// can render any of them without knowing which it got.
export type PrivacySection = {
  id: string
  heading: string
  body: ReactNode
}

export type PrivacyContent = {
  // Shown above the policy on translated pages: a reader is entitled to know that the English text
  // is the one that governs, and to be given a link to it. Null on the English page itself.
  localeNote: ReactNode | null
  sections: PrivacySection[]
}

// Same value as page.tsx's INK. Kept here so the language files can style emphasis without
// importing from the page they are rendered by.
export const INK = { color: '#630826' } as const
