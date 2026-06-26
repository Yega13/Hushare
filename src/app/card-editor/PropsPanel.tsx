'use client'

import React, { memo } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronUp,
  Copy, ImagePlus, Lock, Trash2, Unlock,
} from 'lucide-react'
import type { El, ElPatch, HistState, RectEl, TextEl } from './types'
import { ColorSwatch, NumInput, SliderRow } from './ui-atoms'

const LW = 480

type AlignAxis = 'cx'|'cy'|'left'|'right'|'top'|'bottom'

interface Props {
  selected: El | null
  bg: string
  els: El[]
  qrDataUrl: string
  transforming: boolean
  push: (s: HistState) => void
  updateEl: (id: string, patch: ElPatch, commit?: boolean) => void
  deleteEl: (id: string) => void
  duplicateEl: (id: string) => void
  moveLayer: (id: string, dir: number) => void
  alignEl: (axis: AlignAxis) => void
  handleImgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  applyTemplate: (style: 'branded'|'bw'|'clean') => void
  setTransforming: React.Dispatch<React.SetStateAction<boolean>>
}

function PropsPanel({
  selected, bg, els, qrDataUrl, transforming,
  push, updateEl, deleteEl, duplicateEl, moveLayer, alignEl,
  handleImgUpload, applyTemplate, setTransforming,
}: Props) {
  if (!selected) return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Background</p>
        <ColorSwatch value={bg} onChange={v => push({ els, bg: v })} />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Templates</p>
        <div className="space-y-1.5">
          {(['branded','bw','clean'] as const).map(s => (
            <button key={s} onClick={() => applyTemplate(s)}
              className="w-full text-xs font-medium rounded-lg px-3 py-2 text-left transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
              {s === 'branded' ? 'Hushare Branded (red)' : s === 'bw' ? 'B&W Elegant' : 'Clean White'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs" style={{ color: '#AAAAAA' }}>Click an element to edit. Double-click to resize/rotate. Two fingers to rotate on mobile.</p>
    </div>
  )

  const s = selected
  return (
    <div className="space-y-3">
      {/* Position & Size */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#555' }}>Position & Size</p>
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="X" value={s.x} onChange={v => updateEl(s.id, { x: v })} />
          <NumInput label="Y" value={s.y} onChange={v => updateEl(s.id, { y: v })} />
          {'width' in s && <NumInput label="W" value={(s as RectEl).width} min={1} onChange={v => updateEl(s.id, { width: v })} />}
          {(s.kind === 'rect' || s.kind === 'image') && <NumInput label="H" value={s.height} min={1} onChange={v => updateEl(s.id, { height: v })} />}
          {s.kind === 'line' && <NumInput label="Length" value={s.length} min={1} onChange={v => updateEl(s.id, { length: v })} />}
          {s.kind === 'ellipse' && <NumInput label="Rx" value={s.radiusX} min={1} onChange={v => updateEl(s.id, { radiusX: v })} />}
          {s.kind === 'ellipse' && <NumInput label="Ry" value={s.radiusY} min={1} onChange={v => updateEl(s.id, { radiusY: v })} />}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <NumInput label="Rotation" value={s.rotation} onChange={v => updateEl(s.id, { rotation: v })} unit="°" />
          <NumInput label="Opacity" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={v => updateEl(s.id, { opacity: v / 100 })} unit="%" />
        </div>
      </div>

      {/* Text props */}
      {s.kind === 'text' && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
          <p className="text-xs font-semibold" style={{ color: '#555' }}>Text</p>
          <textarea value={s.text} onChange={e => updateEl(s.id, { text: e.target.value })}
            className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: '#E0E0E0', resize: 'vertical', minHeight: 56 }} />
          <div className="flex gap-1.5">
            <div className="flex-1">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Size</span>
              <div className="flex items-center gap-1 rounded border px-1.5 py-1 mt-0.5" style={{ borderColor: '#E0E0E0' }}>
                <input type="number" value={s.fontSize} min={6} max={200} onChange={e => updateEl(s.id, { fontSize: Number(e.target.value) })} className="w-full text-xs bg-transparent outline-none" />
                <span className="text-xs" style={{ color: '#999' }}>px</span>
              </div>
            </div>
            <div className="flex-1">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Spacing</span>
              <div className="flex items-center gap-1 rounded border px-1.5 py-1 mt-0.5" style={{ borderColor: '#E0E0E0' }}>
                <input type="number" value={s.letterSpacing} step={0.5} onChange={e => updateEl(s.id, { letterSpacing: Number(e.target.value) })} className="w-full text-xs bg-transparent outline-none" />
              </div>
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>Font</span>
            <select value={s.fontFamily} onChange={e => updateEl(s.id, { fontFamily: e.target.value })}
              className="w-full mt-0.5 rounded border px-2 py-1 text-xs" style={{ borderColor: '#E0E0E0' }}>
              <option value="'Playfair Display', Georgia, serif">Playfair Display</option>
              <option value="'Montserrat', sans-serif">Montserrat</option>
              <option value="'Raleway', sans-serif">Raleway</option>
              <option value="'Oswald', sans-serif">Oswald</option>
              <option value="'Dancing Script', cursive">Dancing Script</option>
              <option value="'Geist', system-ui, sans-serif">Geist Sans</option>
              <option value="'Playwrite GB J', cursive">Playwrite Script</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="'Times New Roman', serif">Times New Roman</option>
            </select>
          </div>
          <div className="flex gap-1">
            {(['normal','bold','italic','bold italic'] as const).map(fs => (
              <button key={fs} onClick={() => updateEl(s.id, { fontStyle: fs })}
                className="flex-1 text-xs rounded py-1 transition"
                style={{ background: s.fontStyle === fs ? '#254F22' : '#F5F0E8', color: s.fontStyle === fs ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.fontStyle === fs ? '#254F22' : '#DDD5C5'), fontWeight: fs.includes('bold') ? 700 : 400, fontStyle: fs.includes('italic') ? 'italic' : 'normal' }}>
                {fs === 'normal' ? 'Aa' : fs === 'bold' ? 'B' : fs === 'italic' ? 'I' : 'BI'}
              </button>
            ))}
            <button onClick={() => updateEl(s.id, { textDecoration: s.textDecoration === 'underline' ? '' : 'underline' })}
              className="flex-1 text-xs rounded py-1 transition"
              style={{ background: s.textDecoration === 'underline' ? '#254F22' : '#F5F0E8', color: s.textDecoration === 'underline' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.textDecoration === 'underline' ? '#254F22' : '#DDD5C5'), textDecoration: 'underline' }}>
              U
            </button>
          </div>
          <div className="flex gap-1">
            {(['left','center','right'] as const).map(a => (
              <button key={a} onClick={() => updateEl(s.id, { align: a })}
                className="flex-1 py-1.5 rounded transition"
                style={{ background: s.align === a ? '#254F22' : '#F5F0E8', color: s.align === a ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.align === a ? '#254F22' : '#DDD5C5') }}>
                {a === 'left' ? <AlignLeft className="w-3.5 h-3.5 mx-auto" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5 mx-auto" /> : <AlignRight className="w-3.5 h-3.5 mx-auto" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#666' }}>Color</span>
            <ColorSwatch value={s.fill} onChange={v => updateEl(s.id, { fill: v })} />
          </div>
          <SliderRow label="Width" value={s.width} min={40} max={LW - 20} onChange={v => updateEl(s.id, { width: v })} />
          <SliderRow label="Line H" value={(s as TextEl).lineHeight} min={0.8} max={3} step={0.1} onChange={v => updateEl(s.id, { lineHeight: v })} />
        </div>
      )}

      {/* Shape props */}
      {(s.kind === 'rect' || s.kind === 'ellipse') && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
          <p className="text-xs font-semibold" style={{ color: '#555' }}>Shape</p>
          <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Fill</span><ColorSwatch value={s.fill} onChange={v => updateEl(s.id, { fill: v })} /></div>
          <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Stroke</span><ColorSwatch value={s.stroke} onChange={v => updateEl(s.id, { stroke: v })} /></div>
          <SliderRow label="Stroke W" value={s.strokeWidth} min={0} max={20} onChange={v => updateEl(s.id, { strokeWidth: v })} />
          {s.kind === 'rect' && <SliderRow label="Radius" value={s.cornerRadius} min={0} max={80} onChange={v => updateEl(s.id, { cornerRadius: v })} />}
        </div>
      )}

      {/* Line props */}
      {s.kind === 'line' && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
          <p className="text-xs font-semibold" style={{ color: '#555' }}>Line</p>
          <div className="flex items-center gap-2"><span className="text-xs w-10" style={{ color: '#666' }}>Color</span><ColorSwatch value={s.stroke} onChange={v => updateEl(s.id, { stroke: v })} /></div>
          <SliderRow label="Thickness" value={s.strokeWidth} min={0.5} max={20} step={0.5} onChange={v => updateEl(s.id, { strokeWidth: v })} />
          <div className="flex gap-1">
            <button onClick={() => updateEl(s.id, { lineCap: 'round' })} className="flex-1 text-xs rounded py-1" style={{ background: s.lineCap === 'round' ? '#254F22' : '#F5F0E8', color: s.lineCap === 'round' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.lineCap === 'round' ? '#254F22' : '#DDD5C5') }}>Rounded</button>
            <button onClick={() => updateEl(s.id, { lineCap: 'butt' })} className="flex-1 text-xs rounded py-1" style={{ background: s.lineCap === 'butt' ? '#254F22' : '#F5F0E8', color: s.lineCap === 'butt' ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.lineCap === 'butt' ? '#254F22' : '#DDD5C5') }}>Square</button>
            <button onClick={() => updateEl(s.id, { dashed: !s.dashed })} className="flex-1 text-xs rounded py-1" style={{ background: s.dashed ? '#254F22' : '#F5F0E8', color: s.dashed ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (s.dashed ? '#254F22' : '#DDD5C5') }}>Dashed</button>
          </div>
        </div>
      )}

      {/* Image props */}
      {s.kind === 'image' && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
          <label className="flex items-center justify-center gap-1.5 w-full rounded-lg py-2 text-xs font-semibold cursor-pointer hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px dashed #DDD5C5' }}>
            <ImagePlus className="w-3 h-3" /> Replace image
            <input type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
          </label>
        </div>
      )}

      {/* Shadow */}
      <div className="space-y-2 border-t pt-3" style={{ borderColor: '#F0F0F0' }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold" style={{ color: '#555' }}>Shadow</p>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-xs" style={{ color: '#888' }}>{s.shadowEnabled ? 'On' : 'Off'}</span>
            <input type="checkbox" checked={!!s.shadowEnabled} onChange={e => updateEl(s.id, { shadowEnabled: e.target.checked })} />
          </label>
        </div>
        {s.shadowEnabled && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2"><span className="text-xs w-10 shrink-0" style={{ color: '#666' }}>Color</span><ColorSwatch value={s.shadowColor ?? '#000000'} onChange={v => updateEl(s.id, { shadowColor: v })} /></div>
            <SliderRow label="Blur" value={s.shadowBlur ?? 10} min={0} max={50} onChange={v => updateEl(s.id, { shadowBlur: v })} />
            <SliderRow label="Offset X" value={s.shadowOffsetX ?? 4} min={-30} max={30} onChange={v => updateEl(s.id, { shadowOffsetX: v })} />
            <SliderRow label="Offset Y" value={s.shadowOffsetY ?? 4} min={-30} max={30} onChange={v => updateEl(s.id, { shadowOffsetY: v })} />
          </div>
        )}
      </div>

      {/* Alignment */}
      <div className="pt-2 border-t" style={{ borderColor: '#F0F0F0' }}>
        <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: '#999' }}>Align to canvas</p>
        <div className="grid grid-cols-3 gap-1">
          {([
            ['← Left', 'left'], ['— Center H', 'cx'], ['Right →', 'right'],
            ['↑ Top', 'top'],   ['| Center V', 'cy'], ['↓ Bottom', 'bottom'],
          ] as const).map(([label, axis]) => (
            <button key={axis} onClick={() => alignEl(axis)}
              className="text-[10px] rounded py-1.5 px-1 transition hover:opacity-80"
              style={{ background: '#F5F5F5', color: '#555', border: '1px solid #E0E0E0' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button onClick={() => duplicateEl(s.id)} className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg py-2 transition hover:opacity-80"
          style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
          <Copy className="w-3 h-3" /> Copy
        </button>
        <button onClick={() => moveLayer(s.id, 1)} className="flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-2 transition hover:opacity-80"
          style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
          <ChevronUp className="w-3 h-3" />
        </button>
        <button onClick={() => moveLayer(s.id, -1)} className="flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-2 transition hover:opacity-80"
          style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
          <ChevronDown className="w-3 h-3" />
        </button>
        <button onClick={() => updateEl(s.id, { locked: !s.locked })} className="flex items-center justify-center text-xs rounded-lg px-2.5 py-2"
          style={{ background: s.locked ? '#FFF3E0' : '#F5F5F5', color: s.locked ? '#E65100' : '#888', border: '1px solid ' + (s.locked ? '#FFE0B2' : '#E0E0E0') }}>
          {s.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
        <button onClick={() => deleteEl(s.id)} className="flex items-center justify-center text-xs rounded-lg px-2.5 py-2"
          style={{ background: '#FFF0F0', color: '#C0392B', border: '1px solid #FFCCCC' }}>
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Transform toggle */}
      <button onClick={() => setTransforming(t => !t)} className="w-full text-xs font-semibold rounded-lg py-2 transition"
        style={{ background: transforming ? '#E8F5E9' : '#F5F5F5', color: transforming ? '#254F22' : '#555', border: '1px solid ' + (transforming ? '#C8E6C9' : '#E0E0E0') }}>
        {transforming ? '✓ Handles on — dbl-click canvas to edit text' : 'Enable resize / rotate handles (dbl-click)'}
      </button>
    </div>
  )
}

export default memo(PropsPanel)
