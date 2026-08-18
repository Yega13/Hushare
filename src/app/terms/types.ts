import type { ReactNode } from 'react'

export type TermsSection = { id: string; heading: string; body: ReactNode }

export type TermsContent = {
  // Shown above the terms on translated pages: which text governs, and a link to it.
  localeNote: ReactNode | null
  sections: TermsSection[]
}

// Same value as terms/page.tsx uses, so a translated page is styled identically.
export const INK = { color: '#630826' } as const
