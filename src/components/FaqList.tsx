'use client'

import { useState, type ReactNode } from 'react'

type FaqItem = {
  q: string
  a: ReactNode
}

type Props = {
  items: FaqItem[]
  compactCount?: number
  plusSize?: number
}

export default function FaqList({ items, compactCount = 4, plusSize = 28 }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      {items.map(({ q, a }, i) => {
        const isHidden = !expanded && i >= compactCount
        const isLastVisible = expanded ? i === items.length - 1 : i === compactCount - 1
        return (
          <details
            key={i}
            className={`group ${isHidden ? 'hidden' : expanded && i >= compactCount ? 'hush-faq-extra' : ''}`}
            style={{ borderBottom: isLastVisible ? 'none' : '1px dashed rgba(196,166,120,0.45)' }}
          >
            <summary className="list-none cursor-pointer flex items-start gap-4 py-5 select-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#254F22] rounded-sm">
              <span
                aria-hidden
                className="flex-none inline-flex items-center justify-center rounded-full transition-transform group-open:rotate-45"
                style={{
                  width: plusSize,
                  height: plusSize,
                  background: '#254F22',
                  color: '#FDFAF5',
                  fontSize: plusSize >= 28 ? 18 : 16,
                  lineHeight: 1,
                  marginTop: 2,
                }}
              >
                +
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-serif)',
                  color: '#254F22',
                  fontSize: plusSize >= 28 ? '1.15rem' : '1.05rem',
                  fontWeight: 600,
                  lineHeight: 1.35,
                }}
              >
                {q}
              </span>
            </summary>
            <p className="pb-6 pl-12 pr-2 text-[0.95rem] leading-relaxed" style={{ color: '#5C4A3C' }}>
              {a}
            </p>
          </details>
        )
      })}
      {items.length > compactCount && (
        <button
          type="button"
          className="hush-press mt-3 flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold"
          style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#254F22' }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </>
  )
}
