export type Base = {
  id: string; x: number; y: number; rotation: number; opacity: number
  locked: boolean; visible: boolean; name: string
  shadowEnabled?: boolean; shadowColor?: string; shadowBlur?: number
  shadowOffsetX?: number; shadowOffsetY?: number
}
export type TextEl    = Base & { kind: 'text';    text: string; fontSize: number; fontFamily: string; fontStyle: string; textDecoration: string; fill: string; align: 'left'|'center'|'right'; width: number; letterSpacing: number; lineHeight: number }
export type RectEl    = Base & { kind: 'rect';    width: number; height: number; fill: string; stroke: string; strokeWidth: number; cornerRadius: number }
export type EllipseEl = Base & { kind: 'ellipse'; radiusX: number; radiusY: number; fill: string; stroke: string; strokeWidth: number }
export type LineEl    = Base & { kind: 'line';    length: number; stroke: string; strokeWidth: number; lineCap: 'butt'|'round'; dashed: boolean }
export type ImgEl     = Base & { kind: 'image';   src: string; width: number; height: number }
export type El        = TextEl | RectEl | EllipseEl | LineEl | ImgEl

export type HistState = { els: El[]; bg: string }

export type ElPatch = {
  x?: number; y?: number; rotation?: number; opacity?: number
  locked?: boolean; visible?: boolean; name?: string
  shadowEnabled?: boolean; shadowColor?: string; shadowBlur?: number
  shadowOffsetX?: number; shadowOffsetY?: number
  // Text
  text?: string; fontSize?: number; fontFamily?: string; fontStyle?: string
  textDecoration?: string; fill?: string; align?: 'left'|'center'|'right'
  width?: number; letterSpacing?: number; lineHeight?: number
  // Rect / Ellipse
  height?: number; stroke?: string; strokeWidth?: number; cornerRadius?: number
  radiusX?: number; radiusY?: number
  // Line
  length?: number; lineCap?: 'butt'|'round'; dashed?: boolean
  // Image
  src?: string
}
