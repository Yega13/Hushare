'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, X, Send } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi! I'm Hushare's assistant 👋 Ask me anything about albums, sharing, the plans, or Face Finder.",
}

// Only the public "main website" pages — never on albums, the admin, account, the wall, editors, etc.
const CHAT_ROUTES = new Set([
  '/', '/about', '/pricing', '/collabs', '/support',
  '/statement', '/privacy', '/terms', '/report', '/login',
  '/shared-photo-album', '/wedding-photo-sharing', '/event-photo-sharing', '/qr-code-photo-album',
])

const MIN_THINK_MS = 750   // hold the "thinking" dots at least this long so replies never feel abrupt
const REVEAL_CHUNK = 3     // chars revealed per tick (typewriter)
const REVEAL_INTERVAL = 15 // ms per tick

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export default function SupportChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false) // fetch phase → dots
  const [busy, setBusy] = useState(false)         // whole turn (fetch + typing) → input disabled
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ offX: number; offY: number } | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => () => { aliveRef.current = false }, [])
  // Hide the "back to top" button while the panel is open — they share the bottom-right corner.
  useEffect(() => {
    if (open) document.body.classList.add('hush-chat-open')
    else document.body.classList.remove('hush-chat-open')
    return () => document.body.classList.remove('hush-chat-open')
  }, [open])
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, thinking])
  useEffect(() => { if (open && !closing) inputRef.current?.focus() }, [open, closing])

  useEffect(() => {
    function move(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      const w = panelRef.current?.offsetWidth ?? 320
      const h = panelRef.current?.offsetHeight ?? 440
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
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { offX: e.clientX - rect.left, offY: e.clientY - rect.top }
  }

  function closePanel() {
    if (closing) return
    setClosing(true)
    setTimeout(() => { setOpen(false); setClosing(false) }, 180)
  }

  const normalized = pathname === '/' ? '/' : (pathname ?? '').replace(/\/$/, '')
  if (!CHAT_ROUTES.has(normalized) && !normalized.startsWith('/statement/')) return null

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setBusy(true)
    setThinking(true)
    const started = Date.now()
    let reply: string
    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter(m => m !== GREETING) }),
      })
      const data = await res.json().catch(() => ({})) as { reply?: string; error?: string }
      reply = data.reply ?? data.error ?? "Something went wrong — please try again, or email us via hushare.space/support."
    } catch {
      reply = "I couldn't reach the server. Please check your connection, or email us at hushare.space/support."
    }
    // Hold the thinking dots a beat so an instant answer doesn't feel abrupt.
    const elapsed = Date.now() - started
    if (elapsed < MIN_THINK_MS) await sleep(MIN_THINK_MS - elapsed)
    if (!aliveRef.current) return
    setThinking(false)

    // Typewriter reveal — feels like it's being written, not dumped all at once.
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    for (let i = 0; i <= reply.length; i += REVEAL_CHUNK) {
      if (!aliveRef.current) return
      const slice = reply.slice(0, i)
      setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: slice }; return c })
      await sleep(REVEAL_INTERVAL)
    }
    if (!aliveRef.current) return
    setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: reply }; return c })
    setBusy(false)
  }

  const panelPos: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { right: 16, bottom: 16 }

  return (
    <>
      <style>{`
        @keyframes hushChatSlideIn { 0% { transform: translateX(100%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        .hush-chat-launcher { animation: hushChatSlideIn 520ms cubic-bezier(0.16,1,0.3,1) 500ms backwards; }
        .hush-chat-launcher:hover { transform: translateX(-3px); background: #7A1533 !important; }
        @keyframes hushPanelIn  { 0% { transform: scale(0.9) translateY(16px); opacity: 0; } 100% { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes hushPanelOut { 0% { transform: scale(1) translateY(0); opacity: 1; } 100% { transform: scale(0.9) translateY(16px); opacity: 0; } }
        .hush-chat-panel { transform-origin: bottom right; }
        .hush-chat-in  { animation: hushPanelIn  200ms cubic-bezier(0.16,1,0.3,1) both; }
        .hush-chat-out { animation: hushPanelOut 175ms ease both; }
        .hush-typing { display: flex; gap: 4px; align-items: center; padding: 6px 3px; }
        .hush-typing span { width: 7px; height: 7px; border-radius: 50%; background: #B98E4C; animation: hushDot 1s infinite ease-in-out; }
        .hush-typing span:nth-child(2) { animation-delay: 0.15s; }
        .hush-typing span:nth-child(3) { animation-delay: 0.30s; }
        @keyframes hushDot { 0%,60%,100% { transform: translateY(0); opacity: 0.35; } 30% { transform: translateY(-5px); opacity: 1; } }
        body.hush-chat-open .hush-back-to-top { opacity: 0 !important; pointer-events: none !important; }
        @media (prefers-reduced-motion: reduce) { .hush-chat-launcher, .hush-chat-in, .hush-chat-out { animation-duration: 1ms !important; } }
      `}</style>

      {/* Launcher — slim tab docked to the right edge */}
      {!open && (
        <button
          type="button" aria-label="Open help chat" onClick={() => setOpen(true)}
          className="hush-chat-launcher"
          style={{
            position: 'fixed', right: 0, top: '68%', zIndex: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '8px 6px 9px', border: 'none', cursor: 'pointer',
            borderRadius: '11px 0 0 11px', background: '#630826', color: '#FDFAF5',
            boxShadow: '-4px 4px 16px rgba(99,8,38,0.28)',
            transition: 'transform 160ms ease, background 160ms ease',
          }}
        >
          <MessageCircle size={17} aria-hidden="true" />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.03em' }}>Help</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          ref={panelRef} role="dialog" aria-label="Hushare help chat"
          className={`hush-chat-panel ${closing ? 'hush-chat-out' : 'hush-chat-in'}`}
          style={{
            position: 'fixed', zIndex: 61, ...panelPos,
            width: 'min(332px, calc(100vw - 24px))', height: 'min(452px, calc(100dvh - 24px))',
            display: 'flex', flexDirection: 'column',
            background: '#FDFAF5', border: '1px solid #E4DCCB', borderRadius: 18,
            boxShadow: '0 20px 60px rgba(99,8,38,0.28)', overflow: 'hidden', fontFamily: 'var(--font-sans)',
          }}
        >
          <div
            onPointerDown={startDrag}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 12px', background: '#630826', color: '#FDFAF5', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageCircle size={17} aria-hidden="true" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Hushare help</span>
            </div>
            <button type="button" data-no-drag aria-label="Close chat" onClick={closePanel} style={{ background: 'transparent', border: 'none', color: '#FDFAF5', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%', padding: '8px 11px', borderRadius: 13, fontSize: 13.5, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
                  background: m.role === 'user' ? '#630826' : '#FFFFFF',
                  color: m.role === 'user' ? '#FDFAF5' : '#2A211C',
                  border: m.role === 'user' ? 'none' : '1px solid #E7DDCC',
                }}
              >
                {m.content}
              </div>
            ))}
            {thinking && (
              <div className="hush-typing" style={{ alignSelf: 'flex-start' }} aria-label="Assistant is typing">
                <span /><span /><span />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: 9, borderTop: '1px solid #ECE4D4' }}>
            <textarea
              ref={inputRef} value={input} rows={1}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Ask about Hushare…" aria-label="Type your question" maxLength={1500}
              style={{ flex: 1, padding: '9px 11px', borderRadius: 11, border: '1px solid #DDD5C5', background: '#FFFFFF', color: '#2A211C', fontSize: 13.5, lineHeight: 1.4, outline: 'none', minWidth: 0, resize: 'none', maxHeight: 96, overflowY: 'auto', fontFamily: 'inherit' }}
            />
            <button
              type="button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Send"
              style={{ width: 40, height: 38, flexShrink: 0, borderRadius: 11, border: 'none', background: '#630826', color: '#FDFAF5', cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
