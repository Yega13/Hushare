'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi! I'm Hushare's assistant 👋 Ask me anything — how to create an album, share it with guests, the plans, Face Finder, and more.",
}

// Only the public "main website" pages — never on albums, the admin, account, the wall, editors, etc.
const CHAT_ROUTES = new Set([
  '/', '/about', '/pricing', '/collabs', '/support',
  '/statement', '/privacy', '/terms', '/report', '/login',
  '/shared-photo-album', '/wedding-photo-sharing', '/event-photo-sharing', '/qr-code-photo-album',
])

export default function SupportChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null) // null = default (bottom-left)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ offX: number; offY: number } | null>(null)

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, loading])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // Dragging: window-level listeners gated by the ref, so add/remove always match and there are no
  // stale closures. clamps the panel inside the viewport.
  useEffect(() => {
    function move(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      const w = panelRef.current?.offsetWidth ?? 336
      const h = panelRef.current?.offsetHeight ?? 460
      const left = Math.max(8, Math.min(e.clientX - d.offX, window.innerWidth - w - 8))
      const top = Math.max(8, Math.min(e.clientY - d.offY, window.innerHeight - h - 8))
      setPos({ left, top })
    }
    function up() { dragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return // don't drag when hitting the close button
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { offX: e.clientX - rect.left, offY: e.clientY - rect.top }
  }

  const normalized = pathname === '/' ? '/' : (pathname ?? '').replace(/\/$/, '')
  if (!CHAT_ROUTES.has(normalized) && !normalized.startsWith('/statement/')) return null

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

  // Panel position: default bottom-left until the user drags it, then free-floating.
  const panelPos: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: 16, bottom: 16 }

  return (
    <>
      <style>{`
        @keyframes hushChatPop {
          0%   { transform: scale(0) translateY(24px); opacity: 0; }
          55%  { transform: scale(1.18) translateY(0);  opacity: 1; }
          75%  { transform: scale(0.94); }
          100% { transform: scale(1); }
        }
        .hush-chat-launcher { animation: hushChatPop 620ms cubic-bezier(0.16, 1, 0.3, 1) 500ms both; }
        .hush-chat-launcher:hover { transform: scale(1.06); }
        @media (prefers-reduced-motion: reduce) { .hush-chat-launcher { animation: none; } }
      `}</style>

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
            boxShadow: '0 8px 24px rgba(99,8,38,0.32)', transition: 'transform 160ms ease',
          }}
        >
          <MessageCircle size={24} aria-hidden="true" />
        </button>
      )}

      {/* Panel — smaller on desktop, draggable by its header */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Hushare help chat"
          style={{
            position: 'fixed', zIndex: 61, ...panelPos,
            width: 'min(336px, calc(100vw - 24px))', height: 'min(460px, calc(100dvh - 24px))',
            display: 'flex', flexDirection: 'column',
            background: '#FDFAF5', border: '1px solid #E4DCCB', borderRadius: 18,
            boxShadow: '0 20px 60px rgba(99,8,38,0.28)', overflow: 'hidden',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {/* Header (drag handle) */}
          <div
            onPointerDown={startDrag}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 12px', background: '#630826', color: '#FDFAF5', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageCircle size={17} aria-hidden="true" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Hushare help</span>
            </div>
            <button type="button" data-no-drag aria-label="Close chat" onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: '#FDFAF5', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%', padding: '8px 11px', borderRadius: 13, fontSize: 13.5, lineHeight: 1.5,
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
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, color: '#8B6F4E', fontSize: 13, padding: '2px' }}>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" /> typing…
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, padding: 9, borderTop: '1px solid #ECE4D4' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Ask about Hushare…"
              aria-label="Type your question"
              maxLength={1500}
              style={{ flex: 1, padding: '9px 11px', borderRadius: 11, border: '1px solid #DDD5C5', background: '#FFFFFF', color: '#2A211C', fontSize: 13.5, outline: 'none', minWidth: 0 }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              aria-label="Send"
              style={{ width: 40, flexShrink: 0, borderRadius: 11, border: 'none', background: '#630826', color: '#FDFAF5', cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
