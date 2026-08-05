'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi! I'm Hushare's assistant 👋 Ask me anything — how to create an album, share it with guests, the plans, Face Finder, and more.",
}

export default function SupportChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, loading])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // Don't overlay the projector wall.
  if (pathname?.startsWith('/wall/')) return null

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter(m => m !== GREETING) }),
      })
      const data = await res.json().catch(() => ({})) as { reply?: string; error?: string }
      const reply = data.reply ?? data.error ?? "Something went wrong — please try again, or email us at hushare.space/support."
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "I couldn't reach the server. Please check your connection, or email us at hushare.space/support." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          aria-label="Open help chat"
          onClick={() => setOpen(true)}
          className="hush-chat-launcher"
          style={{
            position: 'fixed', left: 20, bottom: 20, zIndex: 60,
            width: 54, height: 54, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: '#630826', color: '#FDFAF5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(99,8,38,0.32)',
          }}
        >
          <MessageCircle size={24} aria-hidden="true" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Hushare help chat"
          style={{
            position: 'fixed', left: 16, bottom: 16, zIndex: 61,
            width: 'min(370px, calc(100vw - 32px))', height: 'min(520px, calc(100dvh - 32px))',
            display: 'flex', flexDirection: 'column',
            background: '#FDFAF5', border: '1px solid #E4DCCB', borderRadius: 18,
            boxShadow: '0 20px 60px rgba(99,8,38,0.28)', overflow: 'hidden',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#630826', color: '#FDFAF5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageCircle size={18} aria-hidden="true" />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Hushare help</span>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: '#FDFAF5', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%', padding: '9px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: m.role === 'user' ? '#630826' : '#FFFFFF',
                  color: m.role === 'user' ? '#FDFAF5' : '#2A211C',
                  border: m.role === 'user' ? 'none' : '1px solid #E7DDCC',
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, color: '#8B6F4E', fontSize: 13, padding: '4px 2px' }}>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" /> typing…
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #ECE4D4' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Ask about Hushare…"
              aria-label="Type your question"
              maxLength={1500}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: '1px solid #DDD5C5', background: '#FFFFFF', color: '#2A211C', fontSize: 14, outline: 'none' }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              aria-label="Send"
              style={{ width: 42, borderRadius: 12, border: 'none', background: '#630826', color: '#FDFAF5', cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Send size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
