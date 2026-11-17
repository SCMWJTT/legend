import type { PhotoRow, Shoot, Subgroup } from './types'

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function fmtDate(captured: string | null, fmt: string): string {
  if (!captured) return 'undated'
  const [Y, M, D] = [captured.slice(0, 4), captured.slice(5, 7), captured.slice(8, 10)]
  return fmt
    .replace('YYYY', Y)
    .replace('YY', Y.slice(2))
    .replace('MM', M)
    .replace('DD', D)
}

/**
 * Build a published name from a template.
 * Segments: {date:YYYY-MM-DD} {date:YYYYMMDD} {date:YY-MM-DD} {shoot} {code} {number} {subgroup}
 * Anything outside braces is kept as fixed text.
 */
export function publishedName(template: string, p: PhotoRow, shoot: Shoot | null, sg: Subgroup | null): string {
  const num = p.legendId ? p.legendId.split('-').pop()! : '00000'
  const out = template.replace(/\{([a-z]+)(?::([^}]*))?\}/gi, (_m, key: string, arg: string | undefined) => {
    switch (key.toLowerCase()) {
      case 'date':
        return fmtDate(p.captured, arg || 'YYYY-MM-DD')
      case 'shoot':
        return shoot ? slugify(shoot.name) : ''
      case 'code':
        return shoot?.code ?? ''
      case 'number':
        return num
      case 'subgroup':
        return sg ? slugify(sg.heading) : ''
      default:
        return ''
    }
  })
  return out.replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
}

export const TEMPLATE_SEGMENTS = [
  { token: '{date:YYYY-MM-DD}', label: 'Date 2012-12-27' },
  { token: '{date:YYYYMMDD}', label: 'Date 20121227' },
  { token: '{date:YY-MM-DD}', label: 'Date 12-12-27' },
  { token: '{shoot}', label: 'Shoot name' },
  { token: '{code}', label: 'Shoot code' },
  { token: '{number}', label: 'Number' },
  { token: '{subgroup}', label: 'Subgroup heading' }
]
