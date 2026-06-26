import type { CSSProperties } from 'react'

export const btnBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
  padding: '6px 14px',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
  background: '#FFFFFF',
  border: '1px solid #DDD5C5',
  color: '#254F22',
}

export const sectionTitle: CSSProperties = {
  color: '#254F22',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

export const inputStyle: CSSProperties = {
  background: '#FDFAF5',
  border: '1px solid #DDD5C5',
  color: '#254F22',
}

export const accordionButton: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '13px 14px',
  cursor: 'pointer',
  color: '#254F22',
  background: 'transparent',
  border: 0,
  textAlign: 'left',
}

export const settingsSectionStyle: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E8E0D2',
  borderRadius: 14,
  overflow: 'hidden',
  marginBottom: 8,
}
