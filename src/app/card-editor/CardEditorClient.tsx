'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Stage, Layer, Text, Line, Rect as KRect, Ellipse, Image as KonvaImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { ArrowLeft, Circle, Download, ImagePlus, Layers, Minus, MousePointer, Redo2, Square, Type, Undo2 } from 'lucide-react'
import QRCode from 'qrcode'
import type { Base, TextEl, RectEl, EllipseEl, LineEl, ImgEl, El, HistState, ElPatch } from './types'
import { ColorSwatch, NumInput, SliderRow } from './ui-atoms'
import PropsPanel from './PropsPanel'
import LayersPanel from './LayersPanel'

// ─── Dimensions ───────────────────────────────────────────────────────────────

const LW = 480        // logical card width (coordinate space)
const LH = Math.round(LW * 1700 / 1200)  // 680

function uid() { return Math.random().toString(36).slice(2, 9) }
function base(name: string): Base { return { id: uid(), x: LW/2, y: LH/2, rotation: 0, opacity: 1, locked: false, visible: true, name } }

const CX = LW / 2, CY = LH / 2
const SNAP = 8
const LS_KEY = 'hushare_card_v1'

// ─── Templates ────────────────────────────────────────────────────────────────

function makeQrEl(src: string): ImgEl {
  return { ...base('QR Code'), kind: 'image', x: CX - 85, y: 300, src, width: 170, height: 170 }
}

function template(title: string, qr: string, style: 'branded'|'bw'|'clean'): { els: El[]; bg: string } {
  const SERIF = "'Playfair Display', Georgia, serif"
  const footer: TextEl = { ...base('Footer'), kind: 'text', x: CX - 90, y: LH - 36, text: 'hushare.space', fontSize: 11, fontFamily: SERIF, fontStyle: 'italic', textDecoration: '', fill: '#AAAAAA', align: 'center', width: 180, letterSpacing: 0.5, lineHeight: 1.2 }
  const qrEl = makeQrEl(qr)

  if (style === 'branded') {
    // Red header band — matches the actual Hushare branded design (z-order: first = bottom)
    const headerRect: RectEl = { ...base('Header'), locked: true, kind: 'rect', x: 0, y: 0, width: LW, height: 100, fill: '#630826', stroke: '#630826', strokeWidth: 0, cornerRadius: 0 }
    const shadowRect: RectEl = { ...base('Header shadow'), locked: true, kind: 'rect', x: 0, y: 100, width: LW, height: 4, fill: '#9B1727', stroke: '#9B1727', strokeWidth: 0, cornerRadius: 0 }
    // Logo: 618×146 native → scale to fit 228×54 in header (locked, not editable by accident)
    const logoImg: ImgEl = { ...base('Logo'), locked: true, kind: 'image', x: (LW - 228) / 2, y: 23, src: '/logo/logo-light-transparent.png', width: 228, height: 54 }
    const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 120, text: title || 'CAPTURE THE MOMENT', fontSize: 28, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#1A1A1A', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
    const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 200, length: 140, stroke: '#630826', strokeWidth: 2, lineCap: 'round', dashed: false }
    const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 215, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
    return { els: [headerRect, shadowRect, logoImg, footer, qrEl, body, sep, heading], bg: '#FAFAFA' }
  }

  if (style === 'clean') {
    const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 72, text: title || 'CAPTURE THE MOMENT', fontSize: 30, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#111111', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
    const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 148, length: 140, stroke: '#630826', strokeWidth: 2, lineCap: 'round', dashed: false }
    const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 162, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
    return { els: [footer, qrEl, body, sep, heading], bg: '#FFFFFF' }
  }

  // bw
  const heading: TextEl = { ...base('Heading'), kind: 'text', x: CX - 200, y: 72, text: title || 'CAPTURE THE MOMENT', fontSize: 30, fontFamily: SERIF, fontStyle: 'bold', textDecoration: '', fill: '#111111', align: 'center', width: 400, letterSpacing: 1, lineHeight: 1.3 }
  const sep: LineEl = { ...base('Divider'), kind: 'line', x: CX - 70, y: 148, length: 140, stroke: '#630826', strokeWidth: 2, lineCap: 'round', dashed: false }
  const body: TextEl = { ...base('Body'), kind: 'text', x: CX - 155, y: 162, text: 'Scan the QR code with your camera to upload your photos and videos.', fontSize: 13, fontFamily: SERIF, fontStyle: 'normal', textDecoration: '', fill: '#555555', align: 'center', width: 310, letterSpacing: 0, lineHeight: 1.5 }
  const border: RectEl = { ...base('Border'), kind: 'rect', x: 20, y: 20, width: LW - 40, height: LH - 40, fill: 'transparent', stroke: '#111111', strokeWidth: 2, cornerRadius: 0 }
  const border2: RectEl = { ...base('Border inner'), kind: 'rect', x: 32, y: 32, width: LW - 64, height: LH - 64, fill: 'transparent', stroke: '#111111', strokeWidth: 1, cornerRadius: 0 }
  return { els: [border2, border, footer, qrEl, body, sep, heading], bg: '#FFFFFF' }
}

// ─── Undo/redo ────────────────────────────────────────────────────────────────

type HistAction =
  | { type: 'PUSH';    state: HistState }
  | { type: 'REPLACE'; state: HistState }
  | { type: 'UNDO' }
  | { type: 'REDO' }

type HR = { states: HistState[]; idx: number }

function histReducer(s: HR, a: HistAction): HR {
  switch (a.type) {
    case 'PUSH': {
      const states = [...s.states.slice(0, s.idx + 1), a.state].slice(-50)
      return { states, idx: states.length - 1 }
    }
    case 'REPLACE': return { states: [a.state], idx: 0 }
    case 'UNDO':    return { ...s, idx: Math.max(0, s.idx - 1) }
    case 'REDO':    return { ...s, idx: Math.min(s.states.length - 1, s.idx + 1) }
  }
}

function useHistory(init: HistState) {
  const [{ states, idx }, dispatch] = useReducer(histReducer, { states: [init], idx: 0 })
  const push    = useCallback((s: HistState) => dispatch({ type: 'PUSH',    state: s }), [])
  const replace = useCallback((s: HistState) => dispatch({ type: 'REPLACE', state: s }), [])
  const undo    = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo    = useCallback(() => dispatch({ type: 'REDO' }), [])
  return { state: states[idx], push, replace, undo, redo,
           canUndo: idx > 0, canRedo: idx < states.length - 1 }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CardEditorClient() {
  const params = useSearchParams()
  const router = useRouter()
  const shareUrl    = params.get('url') ?? ''
  const initialTitle = params.get('title') ?? ''

  const [qrDataUrl, setQrDataUrl] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const { state, push, replace, undo, redo, canUndo, canRedo } = useHistory({ els: [], bg: '#FFFFFF' })
  const { els, bg } = state
  const [_transientEls, _setElsNoHistory] = useState<El[]>([])
  const bgRef = useRef(bg); bgRef.current = bg
  // Stable after Phase 2 (push has empty deps); safe to use in callbacks
  const setEls = useCallback((next: El[] | ((p: El[]) => El[]), commit = true) => {
    const newEls = typeof next === 'function' ? next(elsRef.current) : next
    if (commit) push({ els: newEls, bg: bgRef.current })
    else _setElsNoHistory(newEls)
  }, [push])
  const liveEls = _transientEls.length > 0 ? _transientEls : els

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [transforming, setTransforming] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [rotAngle, setRotAngle] = useState<number | null>(null)
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [tool, setTool] = useState<'select'|'text'|'rect'|'ellipse'|'line'|'image'>('select')
  const [guides, setGuides] = useState({ v: false, h: false, vx: CX, hy: CY })
  const [fontsReady, setFontsReady] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dlFormat, setDlFormat] = useState<'png' | 'pdf'>('png')
  const [loadedImgs, setLoadedImgs] = useState<Record<string, HTMLImageElement>>({})
  const [rightTab, setRightTab] = useState<'props'|'layers'>('props')
  const [stageW, setStageW] = useState(LW)
  const [zoom, setZoom] = useState(1)
  const stageH = Math.round(stageW * LH / LW)
  const scale = stageW / LW
  const stageScale = scale * zoom   // final Konva scale (logical → screen pixels)
  const dlRatio = 1200 / stageW

  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const shapeRefs = useRef<Record<string, Konva.Node>>({})
  const stageContainer = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gestureRef = useRef<{ active: boolean; startAngle: number; startRot: number; startDist: number; startScale: number }>({ active: false, startAngle: 0, startRot: 0, startDist: 0, startScale: 1 })
  const isDragging = useRef(false)
  const copiedEl = useRef<El | null>(null)

  // Stable refs so the keyboard effect never needs to re-register
  const selectedIdRef  = useRef(selectedId);   selectedIdRef.current  = selectedId
  const liveElsRef     = useRef<El[]>([]);      liveElsRef.current     = liveEls as El[]
  const editingIdRef   = useRef(editingTextId); editingIdRef.current   = editingTextId
  const transformRef   = useRef(transforming);  transformRef.current   = transforming
  const elsRef         = useRef<El[]>([]);      elsRef.current         = els

  // Fonts are loaded via Next.js (layout.tsx) — served from same origin, CSP-safe.
  // After all fonts finish loading, force Konva to repaint so canvas picks them up.
  useEffect(() => {
    document.fonts.ready.then(() => stageRef.current?.batchDraw())
  }, [])

  // Stage sizing
  useEffect(() => {
    function update() {
      const sidebar = window.innerWidth >= 1024 ? 56 + 256 : 0
      setStageW(Math.min(LW, window.innerWidth - sidebar - 48))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Ctrl+Scroll to zoom
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(z => Math.min(3, Math.max(0.25, +(z - e.deltaY * 0.001).toFixed(2))))
    }
    const el = stageContainer.current
    el?.addEventListener('wheel', onWheel, { passive: false })
    return () => el?.removeEventListener('wheel', onWheel)
  }, [])

  // Prevent native pinch on canvas
  useEffect(() => {
    const el = stageContainer.current
    if (!el) return
    const fn = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault() }
    el.addEventListener('touchmove', fn, { passive: false })
    return () => el.removeEventListener('touchmove', fn)
  }, [])

  // Fonts
  useEffect(() => {
    document.fonts.ready.then(() =>
      Promise.all([
        document.fonts.load("bold 32px 'Playfair Display'"),
        document.fonts.load("400 14px 'Playfair Display'"),
      ]).finally(() => setFontsReady(true))
    )
  }, [])

  // QR + init
  useEffect(() => {
    if (!shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 400, margin: 1, color: { dark: '#111111', light: '#FFFFFF' } }).then(url => {
      setQrDataUrl(url)
      const t = template(initialTitle, url, 'branded')
      replace({ els: t.els, bg: t.bg })  // replace so undo can't go past this
    })
  }, [shareUrl, initialTitle])  // eslint-disable-line

  // Load from localStorage when opened without a shareUrl
  useEffect(() => {
    if (shareUrl) return
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as HistState
      if (Array.isArray(saved.els) && saved.els.length > 0) replace(saved)
    } catch { /* ignore */ }
  }, [])  // eslint-disable-line

  // Auto-save to localStorage on every committed state change
  useEffect(() => {
    if (els.length === 0) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ els, bg }))
        setSavedAt(Date.now())
      } catch { /* quota exceeded */ }
    }, 600)
    return () => clearTimeout(t)
  }, [els, bg])  // eslint-disable-line

  // Load images
  useEffect(() => {
    liveEls.filter((e): e is ImgEl => e.kind === 'image').filter(e => !loadedImgs[e.src]).forEach(e => {
      const img = new Image()
      img.onload = () => setLoadedImgs(p => ({ ...p, [e.src]: img }))
      img.src = e.src
    })
  }, [liveEls, loadedImgs])

  // Transformer sync
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const node = selectedId ? shapeRefs.current[selectedId] : null
    tr.nodes(node ? [node] : [])
    if (node && transforming) {
      tr.enabledAnchors(['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'])
      tr.rotateEnabled(true)
    } else if (node) {
      tr.enabledAnchors([])
      tr.rotateEnabled(false)
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, transforming, liveEls])

  // Keyboard shortcuts — registered once; reads current values via refs
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const sid    = selectedIdRef.current
      const els_   = liveElsRef.current
      const editId = editingIdRef.current
      const tfm    = transformRef.current
      const inp    = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement

      if (e.key === 'Escape') {
        if (editId)     { setEditingTextId(null) }
        else if (tfm)   { setTransforming(false) }
        else            { setSelectedId(null); setTransforming(false) }
        return
      }
      if (!inp) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && sid) {
          setEls(p => p.filter(el => el.id !== sid)); setSelectedId(null); setTransforming(false)
          return
        }
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'z') { e.preventDefault(); undo() }
          if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); redo() }
          if (e.key === 'd' && sid) {
            e.preventDefault()
            const el = els_.find(x => x.id === sid); if (!el) return
            const dup = { ...el, id: uid(), x: el.x + 16, y: el.y + 16, name: el.name + ' copy' }
            const idx = els_.findIndex(x => x.id === sid)
            setEls(p => [...p.slice(0, idx + 1), dup, ...p.slice(idx + 1)])
            setSelectedId(dup.id)
          }
          if (e.key === 'c' && sid) { e.preventDefault(); const el = els_.find(x => x.id === sid); if (el) copiedEl.current = el }
          if (e.key === 'v' && copiedEl.current) {
            e.preventDefault()
            const el = copiedEl.current
            const dup = { ...el, id: uid(), x: Math.min(el.x + 20, LW - 20), y: Math.min(el.y + 20, LH - 20), name: el.name.replace(/ copy$/, '') + ' copy' }
            setEls(p => [...p, dup]); setSelectedId(dup.id)
          }
          if (e.key === ']' && sid) { e.preventDefault(); setEls(p => { const i = p.findIndex(x => x.id === sid); const ni = Math.min(p.length - 1, i + 1); if (ni === i) return p; const n = [...p]; [n[i], n[ni]] = [n[ni], n[i]]; return n }) }
          if (e.key === '[' && sid) { e.preventDefault(); setEls(p => { const i = p.findIndex(x => x.id === sid); const ni = Math.max(0, i - 1); if (ni === i) return p; const n = [...p]; [n[i], n[ni]] = [n[ni], n[i]]; return n }) }
        }
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && sid) {
          e.preventDefault()
          const d = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
          setEls(p => p.map(el => el.id === sid ? { ...el, x: el.x + dx, y: el.y + dy } : el))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, push])  // all stable after useReducer; registered once

  const selected = useMemo(() => liveEls.find(e => e.id === selectedId) ?? null, [liveEls, selectedId])

  // ─── Element CRUD ──────────────────────────────────────────────────────────

  function updateEl(id: string, patch: ElPatch, commit = true) {
    setEls(p => p.map(e => e.id === id ? { ...e, ...patch } : e), commit)
  }

  function deleteEl(id: string) {
    const el = elsRef.current.find(e => e.id === id)
    setEls(p => p.filter(e => e.id !== id))
    setSelectedId(null); setTransforming(false)
    if (el?.kind === 'image') {
      setLoadedImgs(prev => {
        const stillUsed = elsRef.current.some(e => e.id !== id && e.kind === 'image' && (e as ImgEl).src === el.src)
        if (stillUsed) return prev
        const next = { ...prev }; delete next[el.src]; return next
      })
    }
  }

  function duplicateEl(id: string) {
    const el = liveEls.find(e => e.id === id)
    if (!el) return
    const dup = { ...el, id: uid(), x: el.x + 16, y: el.y + 16, name: el.name + ' copy' }
    const idx = liveEls.findIndex(e => e.id === id)
    setEls(p => [...p.slice(0, idx + 1), dup, ...p.slice(idx + 1)])
    setSelectedId(dup.id)
  }

  function pasteEl(el: El) {
    const dup = { ...el, id: uid(), x: Math.min(el.x + 20, LW - 20), y: Math.min(el.y + 20, LH - 20), name: el.name.replace(/ copy$/, '') + ' copy' }
    setEls(p => [...p, dup])
    setSelectedId(dup.id)
  }

  function moveLayer(id: string, dir: number) {
    setEls(p => {
      const i = p.findIndex(e => e.id === id)
      const ni = Math.max(0, Math.min(p.length - 1, i + dir))
      if (ni === i) return p
      const next = [...p]; [next[i], next[ni]] = [next[ni], next[i]]
      return next
    })
  }

  // ─── Add tools ─────────────────────────────────────────────────────────────

  function addText() {
    const el: TextEl = { ...base('Text'), kind: 'text', x: CX - 150, y: 120, text: 'Your text', fontSize: 22, fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'normal', textDecoration: '', fill: '#111111', align: 'center', width: 300, letterSpacing: 0, lineHeight: 1.4 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addRect() {
    const el: RectEl = { ...base('Rectangle'), kind: 'rect', x: CX - 80, y: CY - 50, width: 160, height: 100, fill: '#E8F5E9', stroke: '#630826', strokeWidth: 2, cornerRadius: 8 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addEllipse() {
    const el: EllipseEl = { ...base('Circle'), kind: 'ellipse', x: CX, y: CY, radiusX: 70, radiusY: 70, fill: '#E8F5E9', stroke: '#630826', strokeWidth: 2 }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function addLine() {
    const el: LineEl = { ...base('Line'), kind: 'line', x: CX - 80, y: CY, length: 160, stroke: '#630826', strokeWidth: 2, lineCap: 'round', dashed: false }
    setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
  }

  function handleImgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      if (typeof result !== 'string') return
      const el: ImgEl = { ...base('Image'), kind: 'image', x: CX - 80, y: CY - 80, src: result, width: 160, height: 160 }
      setEls(p => [...p, el]); setSelectedId(el.id); setTool('select')
    }
    reader.readAsDataURL(file); e.target.value = ''
  }

  function applyTemplate(style: 'branded'|'bw'|'clean') {
    if (!qrDataUrl) return
    const t = template(initialTitle, qrDataUrl, style)
    push({ els: t.els, bg: t.bg })
    setSelectedId(null)
  }

  // ─── Drag/Transform handlers ───────────────────────────────────────────────

  function handleDragMove(id: string, e: KonvaEventObject<DragEvent>) {
    const node = e.target; const el = liveEls.find(e => e.id === id)
    if (!el) return
    let hw = 0, hh = 0
    if (el.kind === 'text')    { hw = el.width / 2 }
    if (el.kind === 'rect')    { hw = el.width / 2; hh = el.height / 2 }
    if (el.kind === 'ellipse') { hw = el.radiusX; hh = el.radiusY }
    if (el.kind === 'line')    { hw = el.length / 2 }
    if (el.kind === 'image')   { hw = el.width / 2; hh = el.height / 2 }
    const cx = node.x() + hw, cy = node.y() + hh
    const snapV = Math.abs(cx - CX) < SNAP, snapH = Math.abs(cy - CY) < SNAP
    if (snapV) node.x(CX - hw)
    if (snapH) node.y(CY - hh)
    setGuides({ v: snapV, h: snapH, vx: CX, hy: CY })
    _setElsNoHistory(p => p.map(e => e.id === id ? { ...e, x: node.x(), y: node.y() } : e))
  }

  function handleDragEnd(id: string, e: KonvaEventObject<DragEvent>) {
    setGuides({ v: false, h: false, vx: CX, hy: CY })
    _setElsNoHistory([])
    setEls(p => p.map(el => el.id === id ? { ...el, x: e.target.x(), y: e.target.y() } : el))
  }

  function handleTransformEnd(id: string, e: KonvaEventObject<Event>) {
    const node = e.target; const el = elsRef.current.find(e => e.id === id); if (!el) return
    const sx = node.scaleX(), sy = node.scaleY()
    if (el.kind === 'text')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), fontSize: Math.max(6, Math.round(el.fontSize * sy)), width: Math.max(40, Math.round(el.width * sx)) })
    else if (el.kind === 'rect')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(4, Math.round(el.width * sx)), height: Math.max(4, Math.round(el.height * sy)) })
    else if (el.kind === 'ellipse') updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), radiusX: Math.max(2, Math.round(el.radiusX * sx)), radiusY: Math.max(2, Math.round(el.radiusY * sy)) })
    else if (el.kind === 'line')    updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), length: Math.max(4, Math.round(el.length * sx)) })
    else if (el.kind === 'image')   updateEl(id, { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(4, Math.round(el.width * sx)), height: Math.max(4, Math.round(el.height * sy)) })
    node.scaleX(1); node.scaleY(1)
  }

  // ─── Two-finger rotate/scale (delta-from-start approach) ──────────────────

  function onTouchStart(e: KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length === 2 && selectedId) {
      const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY
      const el = liveEls.find(e => e.id === selectedId)
      gestureRef.current = {
        active: true,
        startAngle: Math.atan2(dy, dx),
        startRot: el?.rotation ?? 0,
        startDist: Math.sqrt(dx * dx + dy * dy),
        startScale: 1,
      }
    }
  }

  function onTouchMove(e: KonvaEventObject<TouchEvent>) {
    const g = gestureRef.current
    if (!g.active || e.evt.touches.length !== 2 || !selectedId) return
    const t1 = e.evt.touches[0], t2 = e.evt.touches[1]
    const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY
    const angle = Math.atan2(dy, dx)
    let delta = (angle - g.startAngle) * 180 / Math.PI
    // Clamp large jumps (finger crossing)
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    const newRot = g.startRot + delta
    const node = shapeRefs.current[selectedId]
    if (node) { node.rotation(newRot); node.getLayer()?.batchDraw() }
  }

  function onTouchEnd() {
    if (gestureRef.current.active && selectedId) {
      const node = shapeRefs.current[selectedId]
      if (node) updateEl(selectedId, { rotation: node.rotation() })
    }
    gestureRef.current.active = false
  }

  // ─── Canvas click (add element on click for non-select tools) ─────────────

  function onStageClick(e: KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage() && e.target.getParent()?.className !== 'Layer') {
      return  // clicked an element, not background
    }
    if (tool === 'text')    { addText(); return }
    if (tool === 'rect')    { addRect(); return }
    if (tool === 'ellipse') { addEllipse(); return }
    if (tool === 'line')    { addLine(); return }
    if (tool === 'select')  { setSelectedId(null); setTransforming(false) }
  }

  // ─── Download ─────────────────────────────────────────────────────────────

  async function download() {
    if (!stageRef.current) return
    setSelectedId(null); setTransforming(false); setDownloading(true)
    await new Promise(r => setTimeout(r, 80))
    try {
      const slug = (initialTitle || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase()

      if (dlFormat === 'pdf') {
        const dataUrl = stageRef.current.toDataURL({ pixelRatio: dlRatio, mimeType: 'image/jpeg' })
        const { jsPDF } = await import('jspdf')
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
        pdf.addImage(dataUrl, 'JPEG', 0, 0, 148, 210)
        pdf.save(`${slug}-table-card.pdf`)
      } else {
        const url = stageRef.current.toDataURL({ pixelRatio: dlRatio, mimeType: 'image/png' })
        const a = document.createElement('a')
        a.download = `${slug}-table-card.png`
        a.href = url; a.click()
      }
    } finally { setDownloading(false) }
  }

  // ─── Inline text commit ────────────────────────────────────────────────────

  function commitTextEdit() {
    if (!editingTextId || !textareaRef.current) return
    const newText = textareaRef.current.value
    updateEl(editingTextId, { text: newText, name: newText.slice(0, 18) || 'Text' })
    setEditingTextId(null)
  }

  // ─── Alignment helpers ─────────────────────────────────────────────────────

  function alignEl(axis: 'cx'|'cy'|'left'|'right'|'top'|'bottom') {
    if (!selectedId) return
    const el = liveEls.find(e => e.id === selectedId); if (!el) return
    let hw = 0, hh = 0
    if (el.kind === 'text')    { hw = el.width / 2 }
    if (el.kind === 'rect')    { hw = el.width / 2;  hh = el.height / 2 }
    if (el.kind === 'ellipse') { hw = el.radiusX;    hh = el.radiusY }
    if (el.kind === 'line')    { hw = el.length / 2 }
    if (el.kind === 'image')   { hw = el.width / 2;  hh = el.height / 2 }
    if (axis === 'cx')     updateEl(el.id, { x: CX - hw })
    if (axis === 'cy')     updateEl(el.id, { y: CY - hh })
    if (axis === 'left')   updateEl(el.id, { x: 0 })
    if (axis === 'right')  updateEl(el.id, { x: LW - hw * 2 })
    if (axis === 'top')    updateEl(el.id, { y: 0 })
    if (axis === 'bottom') updateEl(el.id, { y: LH - hh * 2 })
  }

  // ─── Common Konva props ────────────────────────────────────────────────────

  function kProps(el: El) {
    const locked = el.locked
    return {
      draggable: !locked,
      opacity: el.opacity,
      visible: el.visible,
      shadowEnabled: !!el.shadowEnabled,
      shadowColor: el.shadowColor ?? '#000000',
      shadowBlur: el.shadowBlur ?? 10,
      shadowOffsetX: el.shadowOffsetX ?? 4,
      shadowOffsetY: el.shadowOffsetY ?? 4,
      onClick:    () => { setSelectedId(el.id); setTransforming(false) },
      onTap:      () => { setSelectedId(el.id); setTransforming(false) },
      onDblClick: () => {
        setSelectedId(el.id)
        if (el.kind === 'text') { setEditingTextId(el.id); setTimeout(() => textareaRef.current?.focus(), 20) }
        else setTransforming(true)
      },
      onDblTap: () => { setSelectedId(el.id); setTransforming(true) },
      onDragStart: () => { isDragging.current = true; _setElsNoHistory(elsRef.current) },
      onDragMove: (e: KonvaEventObject<DragEvent>) => handleDragMove(el.id, e),
      onDragEnd:  (e: KonvaEventObject<DragEvent>) => { isDragging.current = false; handleDragEnd(el.id, e) },
      onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(el.id, e),
      ref: (node: Konva.Node | null) => {
        if (node) shapeRefs.current[el.id] = node
        else delete shapeRefs.current[el.id]
      },
    }
  }

  // ─── Layer reorder (for LayersPanel) ──────────────────────────────────────

  const reorderEls = useCallback((fromId: string, toId: string) => {
    setEls(p => {
      const next = [...p]
      const fromIdx = next.findIndex(e => e.id === fromId)
      const toIdx   = next.findIndex(e => e.id === toId)
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }, [setEls])

  // ─── Tool definitions ─────────────────────────────────────────────────────

  const TOOLS = [
    { id: 'select',  icon: <MousePointer className="w-4 h-4" />,  label: 'Select'    },
    { id: 'text',    icon: <Type className="w-4 h-4" />,           label: 'Text'      },
    { id: 'rect',    icon: <Square className="w-4 h-4" />,         label: 'Rectangle' },
    { id: 'ellipse', icon: <Circle className="w-4 h-4" />,         label: 'Circle'    },
    { id: 'line',    icon: <Minus className="w-4 h-4" />,          label: 'Line'      },
    { id: 'image',   icon: <ImagePlus className="w-4 h-4" />,      label: 'Image'     },
  ] as const

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#F0F0F0', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: '#1A1A1A', minHeight: 48 }}>
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#DDD' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Back</span>
        </button>

        <span className="text-sm font-semibold text-white hidden sm:block mx-2">Card Editor</span>

        {savedAt && (
          <span key={savedAt} className="text-[10px] hidden sm:block animate-fade-out"
            style={{ color: '#6EE7B7', opacity: 0.85 }}>
            Saved
          </span>
        )}

        <div className="flex gap-1 ml-1">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition disabled:opacity-30"
            style={{ background: canUndo ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#DDD' }}>
            <Undo2 className="w-3.5 h-3.5" /> <span className="hidden md:inline">Undo</span>
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
            className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition disabled:opacity-30"
            style={{ background: canRedo ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#DDD' }}>
            <Redo2 className="w-3.5 h-3.5" /> <span className="hidden md:inline">Redo</span>
          </button>
        </div>

        <div className="flex-1" />

        {selectedId && (
          <button onClick={() => { setSelectedId(null); setTransforming(false) }}
            className="text-xs rounded-lg px-2.5 py-1.5 hidden sm:flex items-center gap-1"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#BBB' }}>
            <MousePointer className="w-3 h-3" /> Deselect
          </button>
        )}

        {/* Zoom controls */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))} title="Zoom out"
            className="px-2 py-1.5 text-sm hover:opacity-70 transition" style={{ color: '#DDD' }}>−</button>
          <button onClick={() => setZoom(1)} title="Reset zoom"
            className="px-1.5 py-1.5 text-[10px] font-mono hover:opacity-70 transition min-w-[3rem] text-center" style={{ color: '#DDD' }}>
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in"
            className="px-2 py-1.5 text-sm hover:opacity-70 transition" style={{ color: '#DDD' }}>+</button>
        </div>

        <div className="flex items-center rounded-lg overflow-hidden" style={{ background: '#1E401B' }}>
          {(['png', 'pdf'] as const).map(f => (
            <button key={f} onClick={() => setDlFormat(f)}
              className="px-2 py-2 text-[10px] font-bold transition"
              style={{ background: dlFormat === f ? '#630826' : 'transparent', color: dlFormat === f ? '#FDFAF5' : '#6EE7B7' }}>
              {f.toUpperCase()}
            </button>
          ))}
          <button onClick={download} disabled={downloading}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 transition hover:opacity-90 disabled:opacity-40"
            style={{ background: '#630826', color: '#FDFAF5' }}>
            <Download className="w-3.5 h-3.5" />
            {downloading ? '…' : <><span className="hidden sm:inline">Download</span> {dlFormat.toUpperCase()}</>}
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left toolbar (desktop) ────────────────────────────────────── */}
        <div className="hidden lg:flex flex-col items-center gap-1 py-3 px-1.5 shrink-0"
          style={{ background: '#2A2A2A', width: 56, borderRight: '1px solid #333' }}>
          {TOOLS.map(t => (
            <button key={t.id}
              onClick={() => {
                setTool(t.id as typeof tool)
                if (t.id !== 'select') {
                  if (t.id === 'text') addText()
                  else if (t.id === 'rect') addRect()
                  else if (t.id === 'ellipse') addEllipse()
                  else if (t.id === 'line') addLine()
                }
              }}
              title={t.label}
              className="w-9 h-9 flex items-center justify-center rounded-lg transition"
              style={{ background: tool === t.id ? '#630826' : 'transparent', color: tool === t.id ? '#FDFAF5' : '#AAA' }}>
              {t.id === 'image' ? (
                <label className="cursor-pointer flex items-center justify-center w-full h-full">
                  {t.icon}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                </label>
              ) : t.icon}
            </button>
          ))}
          <div className="flex-1" />
          <div className="w-8 h-px" style={{ background: '#444' }} />
          <button onClick={() => push({ els, bg })} title="Save checkpoint" className="w-9 h-9 flex items-center justify-center rounded-lg" style={{ color: '#666' }}>
            ·
          </button>
        </div>

        {/* ── Canvas area ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto flex items-start justify-center p-4 order-1 lg:order-none"
          style={{ background: '#E8E8E8' }}>
          <div ref={stageContainer} style={{ position: 'relative' }}>
            {!fontsReady && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.85)', fontSize: 12, color: '#888' }}>Loading…</div>
            )}

            {/* Rotation angle badge */}
            {rotAngle !== null && (
              <div className="absolute top-2 right-2 z-20 rounded-lg px-2.5 py-1 text-xs font-mono font-bold pointer-events-none"
                style={{ background: 'rgba(0,0,0,0.75)', color: '#FFF', letterSpacing: '0.05em' }}>
                {rotAngle}° {rotAngle === 0 ? '↔' : rotAngle === 90 ? '↕' : rotAngle === 45 || rotAngle === 135 || rotAngle === 225 || rotAngle === 315 ? '✕' : ''}
              </div>
            )}

            {/* Inline text editor overlay (desktop) */}
            {editingTextId && (() => {
              const el = liveEls.find(e => e.id === editingTextId)
              if (!el || el.kind !== 'text') return null
              return (
                <textarea
                  ref={textareaRef}
                  defaultValue={el.text}
                  onBlur={commitTextEdit}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setEditingTextId(null) }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit() }
                    // Shift+Enter → inserts newline (default textarea behavior)
                  }}
                  style={{
                    position: 'absolute',
                    left: el.x * stageScale,
                    top: el.y * stageScale,
                    width: el.width * stageScale,
                    minHeight: el.fontSize * stageScale * 1.5,
                    fontSize: el.fontSize * stageScale,
                    fontFamily: el.fontFamily,
                    fontStyle: el.fontStyle.includes('italic') ? 'italic' : 'normal',
                    fontWeight: el.fontStyle.includes('bold') ? 700 : 400,
                    color: el.fill,
                    textAlign: el.align,
                    background: 'rgba(255,255,255,0.92)',
                    border: '2px dashed #3B82F6',
                    borderRadius: 4,
                    outline: 'none',
                    resize: 'none',
                    padding: '2px 4px',
                    lineHeight: el.lineHeight,
                    letterSpacing: el.letterSpacing,
                    transform: el.rotation !== 0 ? `rotate(${el.rotation}deg)` : undefined,
                    transformOrigin: 'top left',
                    zIndex: 20,
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                  }}
                />
              )
            })()}
            <Stage
              ref={stageRef}
              width={stageW * zoom}
              height={stageH * zoom}
              scaleX={stageScale}
              scaleY={stageScale}
              style={{ borderRadius: 8, boxShadow: '0 8px 48px rgba(0,0,0,0.25)', cursor: tool === 'select' ? 'default' : 'crosshair', display: 'block' }}
              onClick={onStageClick}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <Layer>
                <KRect x={0} y={0} width={LW} height={LH} fill={bg} />

                {liveEls.map(el => {
                  const p = kProps(el)
                  if (el.kind === 'text')    return <Text key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} text={el.text} fontSize={el.fontSize} fontFamily={el.fontFamily} fontStyle={el.fontStyle} textDecoration={el.textDecoration} fill={el.fill} align={el.align} width={el.width} letterSpacing={el.letterSpacing} lineHeight={el.lineHeight} wrap="word" />
                  if (el.kind === 'rect')    return <KRect key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} width={el.width} height={el.height} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth} cornerRadius={el.cornerRadius} />
                  if (el.kind === 'ellipse') return <Ellipse key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} radiusX={el.radiusX} radiusY={el.radiusY} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth} />
                  if (el.kind === 'line')    return <Line key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} points={[0, 0, el.length, 0]} stroke={el.stroke} strokeWidth={el.strokeWidth} lineCap={el.lineCap} dash={el.dashed ? [el.strokeWidth * 3, el.strokeWidth * 2] : []} hitStrokeWidth={16} />
                  if (el.kind === 'image') {
                    const img = loadedImgs[el.src]; if (!img) return null
                    return <KonvaImage key={el.id} {...p} x={el.x} y={el.y} rotation={el.rotation} image={img} width={el.width} height={el.height} />
                  }
                  return null
                })}

                {guides.v && <Line points={[guides.vx, 0, guides.vx, LH]} stroke="#3B82F6" strokeWidth={1} dash={[5, 4]} listening={false} />}
                {guides.h && <Line points={[0, guides.hy, LW, guides.hy]} stroke="#3B82F6" strokeWidth={1} dash={[5, 4]} listening={false} />}

                <Transformer
                  ref={trRef}
                  boundBoxFunc={(o, n) => (n.width < 8 || n.height < 8 ? o : n)}
                  anchorSize={8} anchorCornerRadius={3}
                  borderStroke="#3B82F6" anchorStroke="#3B82F6" anchorFill="#FFFFFF"
                  rotateAnchorOffset={20}
                  rotateAnchorCursor={`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-8 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z' fill='%23111111'/%3E%3C/svg%3E") 12 12, crosshair`}
                  rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                  rotationSnapTolerance={8}
                  onTransform={() => {
                    const node = trRef.current?.nodes()[0]
                    if (node) setRotAngle(Math.round(node.rotation()))
                  }}
                  onTransformEnd={() => setTimeout(() => setRotAngle(null), 800)}
                />
              </Layer>
            </Stage>
          </div>
        </div>

        {/* ── Right panel (desktop) ─────────────────────────────────────── */}
        <div className="hidden lg:flex flex-col shrink-0 overflow-hidden"
          style={{ width: 256, background: '#FFFFFF', borderLeft: '1px solid #E5E5E5' }}>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: '#E5E5E5' }}>
            {(['props','layers'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition"
                style={{ borderBottom: rightTab === tab ? '2px solid #630826' : '2px solid transparent', color: rightTab === tab ? '#630826' : '#888' }}>
                {tab === 'layers' && <Layers className="w-3.5 h-3.5" />}
                {tab === 'props' ? 'Properties' : 'Layers'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {rightTab === 'props'
              ? <PropsPanel selected={selected} bg={bg} els={els} qrDataUrl={qrDataUrl} transforming={transforming} push={push} updateEl={updateEl} deleteEl={deleteEl} duplicateEl={duplicateEl} moveLayer={moveLayer} alignEl={alignEl} handleImgUpload={handleImgUpload} applyTemplate={applyTemplate} setTransforming={setTransforming} />
              : <LayersPanel els={liveEls} selectedId={selectedId} dragLayerId={dragLayerId} dragOverId={dragOverId} setSelectedId={setSelectedId} setTransforming={setTransforming} setDragLayerId={setDragLayerId} setDragOverId={setDragOverId} updateEl={updateEl} moveLayer={moveLayer} reorderEls={reorderEls} />
            }
          </div>
        </div>

      </div>

      {/* ── Mobile bottom bar ─────────────────────────────────────────────── */}
      <div className="lg:hidden flex flex-col shrink-0" style={{ background: '#FFFFFF', borderTop: '1px solid #E5E5E5' }}>
        {/* Tool strip */}
        <div className="flex overflow-x-auto gap-1 px-2 py-2" style={{ scrollbarWidth: 'none' }}>
          {TOOLS.map(t => (
            <button key={t.id}
              onClick={() => {
                setTool(t.id as typeof tool)
                if (t.id === 'text') addText()
                else if (t.id === 'rect') addRect()
                else if (t.id === 'ellipse') addEllipse()
                else if (t.id === 'line') addLine()
              }}
              className="flex flex-col items-center gap-0.5 shrink-0 rounded-xl px-3 py-2 transition"
              style={{ background: tool === t.id ? '#630826' : '#F5F5F5', color: tool === t.id ? '#FDFAF5' : '#555' }}>
              {t.id === 'image' ? (
                <label className="cursor-pointer flex flex-col items-center gap-0.5">
                  {t.icon}<span className="text-[10px]">{t.label}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                </label>
              ) : <>{t.icon}<span className="text-[10px]">{t.label}</span></>}
            </button>
          ))}
        </div>

        {/* Mobile properties (collapsed) */}
        {selected && (
          <div className="px-3 pb-3 max-h-64 overflow-y-auto border-t" style={{ borderColor: '#F0F0F0' }}>
            <PropsPanel selected={selected} bg={bg} els={els} qrDataUrl={qrDataUrl} transforming={transforming} push={push} updateEl={updateEl} deleteEl={deleteEl} duplicateEl={duplicateEl} moveLayer={moveLayer} alignEl={alignEl} handleImgUpload={handleImgUpload} applyTemplate={applyTemplate} setTransforming={setTransforming} />
          </div>
        )}
      </div>

    </div>
  )
}
