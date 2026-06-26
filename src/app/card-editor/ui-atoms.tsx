'use client'

import { useEffect, useState } from 'react'

export function ColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  function handle(raw: string) {
    const v = raw.startsWith('#') ? raw : '#' + raw
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <input type="color" value={value} onChange={e => { setHex(e.target.value); onChange(e.target.value) }}
          className="absolute inset-0 opacity-0 cursor-pointer" style={{ width: 24, height: 24 }} />
        <div className="rounded border" style={{ width: 24, height: 24, background: value, borderColor: '#D0D0D0' }} />
      </div>
      <input type="text" value={hex} onChange={e => handle(e.target.value)} maxLength={7}
        className="rounded border px-1.5 py-0.5 text-xs font-mono" style={{ width: 72, borderColor: '#E0E0E0' }} />
    </div>
  )
}

export function NumInput({ label, value, onChange, min, max, step = 1, unit = '' }: { label: string; value: number; min?: number; max?: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(String(Math.round(value * 10) / 10))
  useEffect(() => { setLocal(String(Math.round(value * 10) / 10)) }, [value])
  function commit(raw: string) {
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, n) : n) : n
      onChange(clamped)
    } else { setLocal(String(Math.round(value * 10) / 10)) }
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: '#999' }}>{label}</span>
      <div className="flex items-center gap-1 rounded border px-1.5 py-1" style={{ borderColor: '#E0E0E0' }}>
        <input
          type="text" inputMode="decimal" value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { commit(local); e.currentTarget.blur() } }}
          className="w-full text-xs bg-transparent outline-none" style={{ color: '#1A1A1A' }} />
        {unit && <span className="text-xs shrink-0" style={{ color: '#999' }}>{unit}</span>}
      </div>
    </div>
  )
}

export function SliderRow({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-16" style={{ color: '#666' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1" />
      <span className="text-xs w-8 text-right font-mono" style={{ color: '#999' }}>{Math.round(value * 10) / 10}</span>
    </div>
  )
}
