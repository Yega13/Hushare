'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  value: string // datetime-local format: YYYY-MM-DDTHH:mm, or empty
  onChange: (value: string) => void
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parse(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null
  return { year: +m[1], month: +m[2] - 1, day: +m[3], hour: +m[4], minute: +m[5] }
}

function fmt(year: number, month: number, day: number, hour: number, minute: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export default function RevealDatePicker({ value, onChange }: Props) {
  const parsed = parse(value)
  const today = new Date()

  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const [openPicker, setOpenPicker] = useState<'hour' | 'minute' | null>(null)

  // When the value is cleared (e.g. owner clicks "Remove reveal"), reset the calendar
  // view back to the current month so it doesn't stay on a past selection.
  useEffect(() => {
    if (!value) {
      const now = new Date()
      setViewYear(now.getFullYear())
      setViewMonth(now.getMonth())
    }
  }, [value])
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpenPicker(null)
      }
    }
    if (openPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openPicker])

  const h24 = parsed?.hour ?? 12
  const minute = parsed?.minute ?? 0
  const isPM = h24 >= 12
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24

  const cells = useMemo(() => {
    const offset = new Date(viewYear, viewMonth, 1).getDay()
    const total = new Date(viewYear, viewMonth + 1, 0).getDate()
    return Array.from({ length: offset + total }, (_, i) => i < offset ? null : i - offset + 1)
  }, [viewYear, viewMonth])

  function pickDay(day: number) {
    onChange(fmt(viewYear, viewMonth, day, h24, minute))
  }

  function changeHour(h: number, pm: boolean) {
    if (!parsed) return
    const h24new = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h
    onChange(fmt(parsed.year, parsed.month, parsed.day, h24new, parsed.minute))
  }

  function changeMinute(m: number) {
    if (!parsed) return
    onChange(fmt(parsed.year, parsed.month, parsed.day, parsed.hour, m))
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const isPast = (d: number) => new Date(viewYear, viewMonth, d) < todayStart

  const isSelected = (d: number) =>
    !!parsed && d === parsed.day && viewMonth === parsed.month && viewYear === parsed.year
  const isToday = (d: number) =>
    d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()

  return (
    <div className="rounded-2xl select-none" style={{ background: 'rgba(253,250,245,0.95)', border: '1px solid #E0D5C5', overflow: 'visible' }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <button
          onClick={prevMonth}
          disabled={viewYear === today.getFullYear() && viewMonth <= today.getMonth()}
          className="w-7 h-7 rounded-full flex items-center justify-center transition"
          style={{
            color: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? '#C4B8A8' : '#8B6F4E',
            background: 'rgba(139,111,78,0.08)',
            opacity: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? 0.4 : 1,
            cursor: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm font-bold tracking-wide" style={{ color: '#3D2B1A', fontFamily: 'var(--font-serif)' }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="w-7 h-7 rounded-full flex items-center justify-center hover:opacity-70 transition" style={{ color: '#8B6F4E', background: 'rgba(139,111,78,0.08)' }}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 px-3 mb-0.5">
        {DAYS.map(d => (
          <div key={d} className="text-center py-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#C4A882' }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 px-3 pb-3 gap-y-1">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center">
            {day ? (
              <button
                onClick={() => !isPast(day) && pickDay(day)}
                disabled={isPast(day)}
                className={`w-8 h-8 rounded-full text-xs flex items-center justify-center transition ${isPast(day) ? 'cursor-not-allowed' : 'hover:scale-110'}`}
                style={{
                  background: isPast(day) ? 'transparent' : isSelected(day) ? '#630826' : isToday(day) ? 'rgba(99,8,38,0.1)' : 'transparent',
                  color: isPast(day) ? '#C4B8A8' : isSelected(day) ? '#FDFAF5' : isToday(day) ? '#630826' : '#5C3D1E',
                  fontWeight: isSelected(day) || isToday(day) ? '700' : '500',
                  boxShadow: isSelected(day) ? '0 2px 8px rgba(99,8,38,0.35)' : 'none',
                  opacity: isPast(day) ? 0.45 : 1,
                }}
              >
                {day}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid #EAE0D0' }} ref={pickerRef}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#C4A882' }}>Time</span>
        <div className="flex items-center gap-1.5 ml-auto">

          <div className="relative">
            <button
              onClick={() => parsed && setOpenPicker(openPicker === 'hour' ? null : 'hour')}
              disabled={!parsed}
              className="text-xs font-semibold rounded-lg px-2 py-1.5 focus:outline-none"
              style={{ background: 'rgba(92,61,30,0.07)', color: '#3D2B1A', border: '1px solid #E0D5C5', cursor: parsed ? 'pointer' : 'default', minWidth: 36, textAlign: 'center' }}
            >
              {String(h12).padStart(2, '0')}
            </button>
            {openPicker === 'hour' && (
              <div className="absolute bottom-full mb-1.5 left-1/2 z-50 rounded-xl p-2 shadow-xl" style={{ transform: 'translateX(-50%)', background: 'rgba(253,250,245,0.98)', border: '1px solid #E0D5C5', minWidth: 140 }}>
                <div className="grid grid-cols-4 gap-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                    <button
                      key={h}
                      onClick={() => { changeHour(h, isPM); setOpenPicker(null) }}
                      className="h-7 rounded-lg text-[11px] font-semibold transition hover:scale-105"
                      style={{
                        background: h === h12 ? '#630826' : 'rgba(92,61,30,0.07)',
                        color: h === h12 ? '#FDFAF5' : '#5C3D1E',
                        boxShadow: h === h12 ? '0 2px 6px rgba(99,8,38,0.3)' : 'none',
                      }}
                    >
                      {String(h).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="text-xs font-bold" style={{ color: '#C4A882' }}>:</span>

          <div className="relative">
            <button
              onClick={() => parsed && setOpenPicker(openPicker === 'minute' ? null : 'minute')}
              disabled={!parsed}
              className="text-xs font-semibold rounded-lg px-2 py-1.5 focus:outline-none"
              style={{ background: 'rgba(92,61,30,0.07)', color: '#3D2B1A', border: '1px solid #E0D5C5', cursor: parsed ? 'pointer' : 'default', minWidth: 36, textAlign: 'center' }}
            >
              {String(minute).padStart(2, '0')}
            </button>
            {openPicker === 'minute' && (
              <div className="absolute bottom-full mb-1.5 right-0 z-50 rounded-xl p-2 shadow-xl" style={{ background: 'rgba(253,250,245,0.98)', border: '1px solid #E0D5C5', minWidth: 176, maxHeight: 200, overflowY: 'auto' }}>
                {/* Every minute 0–59 (was 5-minute steps, which couldn't express e.g. :28). */}
                <div className="grid grid-cols-6 gap-1">
                  {Array.from({ length: 60 }, (_, i) => i).map(m => (
                    <button
                      key={m}
                      onClick={() => { changeMinute(m); setOpenPicker(null) }}
                      className="h-7 rounded-lg text-[11px] font-semibold transition hover:scale-105"
                      style={{
                        background: m === minute ? '#630826' : 'rgba(92,61,30,0.07)',
                        color: m === minute ? '#FDFAF5' : '#5C3D1E',
                        boxShadow: m === minute ? '0 2px 6px rgba(99,8,38,0.3)' : 'none',
                      }}
                    >
                      {String(m).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #E0D5C5' }}>
            {(['AM', 'PM'] as const).map(period => (
              <button
                key={period}
                onClick={() => changeHour(h12, period === 'PM')}
                disabled={!parsed}
                className="text-[11px] px-2.5 py-1.5 font-bold transition"
                style={{
                  background: (period === 'PM') === isPM ? '#630826' : 'rgba(92,61,30,0.07)',
                  color: (period === 'PM') === isPM ? '#FDFAF5' : '#8B6F4E',
                }}
              >
                {period}
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
