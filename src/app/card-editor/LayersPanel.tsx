'use client'

import { memo } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import type { El, ElPatch } from './types'

interface Props {
  els: El[]
  selectedId: string | null
  dragLayerId: string | null
  dragOverId: string | null
  setSelectedId: (id: string | null) => void
  setTransforming: React.Dispatch<React.SetStateAction<boolean>>
  setDragLayerId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  updateEl: (id: string, patch: ElPatch, commit?: boolean) => void
  moveLayer: (id: string, dir: number) => void
  reorderEls: (fromId: string, toId: string) => void
}

function LayersPanel({
  els, selectedId, dragLayerId, dragOverId,
  setSelectedId, setTransforming, setDragLayerId, setDragOverId,
  updateEl, moveLayer, reorderEls,
}: Props) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: '#999' }}>Drag to reorder — top = front</p>
      {[...els].reverse().map(el => (
        <div key={el.id}
          draggable
          onDragStart={() => setDragLayerId(el.id)}
          onDragOver={e => { e.preventDefault(); setDragOverId(el.id) }}
          onDrop={() => { if (dragLayerId && dragLayerId !== el.id) { reorderEls(dragLayerId, el.id); setDragLayerId(null); setDragOverId(null) } }}
          onDragEnd={() => { setDragLayerId(null); setDragOverId(null) }}
          onClick={() => { setSelectedId(el.id); setTransforming(false) }}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing transition select-none"
          style={{
            background: el.id === selectedId ? '#E8F5E9' : el.id === dragOverId ? '#EEF2FF' : 'transparent',
            border: '1px solid ' + (el.id === selectedId ? '#C8E6C9' : el.id === dragOverId ? '#C7D2FE' : 'transparent'),
            opacity: el.id === dragLayerId ? 0.4 : 1,
          }}>
          <span className="text-[10px] w-10 shrink-0 text-center rounded px-1 py-0.5 font-mono uppercase" style={{ background: '#F5F5F5', color: '#888' }}>
            {el.kind.slice(0, 4)}
          </span>
          <span className="flex-1 text-xs truncate" style={{ color: '#1A1A1A' }}>{el.name}</span>
          <button onClick={e => { e.stopPropagation(); updateEl(el.id, { visible: !el.visible }, true) }}
            className="p-1 rounded transition hover:opacity-70">
            {el.visible ? <Eye className="w-3 h-3" style={{ color: '#888' }} /> : <EyeOff className="w-3 h-3" style={{ color: '#BBB' }} />}
          </button>
          <button onClick={e => { e.stopPropagation(); updateEl(el.id, { locked: !el.locked }, true) }}
            className="p-1 rounded transition hover:opacity-70">
            {el.locked ? <Lock className="w-3 h-3" style={{ color: '#E67' }} /> : <Unlock className="w-3 h-3" style={{ color: '#BBB' }} />}
          </button>
          <div className="flex flex-col gap-0">
            <button onClick={e => { e.stopPropagation(); moveLayer(el.id, 1) }} className="p-0.5 hover:opacity-70"><ChevronUp className="w-3 h-3" style={{ color: '#888' }} /></button>
            <button onClick={e => { e.stopPropagation(); moveLayer(el.id, -1) }} className="p-0.5 hover:opacity-70"><ChevronDown className="w-3 h-3" style={{ color: '#888' }} /></button>
          </div>
        </div>
      ))}
      {els.length === 0 && <p className="text-xs py-3 text-center" style={{ color: '#AAAAAA' }}>No elements yet.</p>}
    </div>
  )
}

export default memo(LayersPanel)
