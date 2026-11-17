// Filtering, sorting, grouping and facet counting, all in memory for instant response.
import { useMemo } from 'react'
import type { HNode, Hierarchy, PhotoRow, Shoot, Subgroup } from '@shared/types'
import { useStore, type Filters, type Source, type SortKey } from './store'

export interface Ctx {
  nodeById: Map<number, HNode>
  children: Map<string, HNode[]>
  hierarchies: Hierarchy[]
  hByKey: Map<string, Hierarchy>
  shoots: Map<number, Shoot>
  subgroups: Map<number, Subgroup>
}

export function useCtx(): Ctx {
  const nodeById = useStore((s) => s.nodeById)
  const children = useStore((s) => s.children)
  const hierarchies = useStore((s) => s.hierarchies)
  const shoots = useStore((s) => s.shoots)
  const subgroups = useStore((s) => s.subgroups)
  return useMemo(
    () => ({
      nodeById,
      children,
      hierarchies,
      hByKey: new Map(hierarchies.map((h) => [h.key, h])),
      shoots: new Map(shoots.map((s) => [s.id, s])),
      subgroups: new Map(subgroups.map((s) => [s.id, s]))
    }),
    [nodeById, children, hierarchies, shoots, subgroups]
  )
}

export function ancestors(nodeId: number, nodeById: Map<number, HNode>): HNode[] {
  const out: HNode[] = []
  let n = nodeById.get(nodeId)
  let guard = 0
  while (n && guard++ < 64) {
    out.unshift(n)
    n = n.parentId ? nodeById.get(n.parentId) : undefined
  }
  return out
}

export function pathLabel(nodeId: number, nodeById: Map<number, HNode>, sep = ' › '): string {
  return ancestors(nodeId, nodeById)
    .map((n) => n.label)
    .join(sep)
}

export function descendants(nodeId: number, ctx: Pick<Ctx, 'children' | 'nodeById'>): Set<number> {
  const out = new Set<number>([nodeId])
  const n = ctx.nodeById.get(nodeId)
  if (!n) return out
  const stack = [nodeId]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of ctx.children.get(`${n.hierarchyId}:${id}`) ?? []) {
      out.add(c.id)
      stack.push(c.id)
    }
  }
  return out
}

export function kidsOf(ctx: Pick<Ctx, 'children'>, hierarchyId: number, parentId: number | null): HNode[] {
  return ctx.children.get(`${hierarchyId}:${parentId ?? 0}`) ?? []
}

const TOD = (c: string | null): string => {
  if (!c) return 'Unknown'
  const h = Number(c.slice(11, 13))
  if (h >= 5 && h < 12) return 'Morning'
  if (h >= 12 && h < 17) return 'Afternoon'
  if (h >= 17 && h < 20) return 'Evening'
  return 'Night'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------- dimensions (facets and grouping)

export interface Dim {
  key: string
  label: string
  hierarchy?: Hierarchy
}

export function dims(ctx: Ctx): Dim[] {
  const out: Dim[] = ctx.hierarchies.filter((h) => !h.archived).map((h) => ({ key: `h:${h.key}`, label: h.name, hierarchy: h }))
  out.push(
    { key: 'shoot', label: 'Shoot' },
    { key: 'subgroup', label: 'Subgroup' },
    { key: 'year', label: 'Year' },
    { key: 'month', label: 'Month' },
    { key: 'tod', label: 'Time of day' },
    { key: 'rating', label: 'Rating' },
    { key: 'status', label: 'Status' },
    { key: 'camera', label: 'Camera' },
    { key: 'lens', label: 'Lens' }
  )
  return out
}

/** Values a photo has for a dimension. For hierarchies this includes every ancestor (counts "at or below"). */
export function valuesOf(p: PhotoRow, dim: string, ctx: Ctx): string[] {
  if (dim.startsWith('h:')) {
    const h = ctx.hByKey.get(dim.slice(2))
    if (!h) return []
    const out = new Set<string>()
    for (const id of p.nodes) {
      const n = ctx.nodeById.get(id)
      if (!n || n.hierarchyId !== h.id) continue
      for (const a of ancestors(id, ctx.nodeById)) out.add(String(a.id))
    }
    return out.size ? [...out] : ['0']
  }
  switch (dim) {
    case 'shoot':
      return [String(p.shootId ?? 0)]
    case 'subgroup':
      return [String(p.subgroupId ?? 0)]
    case 'year':
      return [p.captured ? p.captured.slice(0, 4) : '0']
    case 'month':
      return [p.captured ? p.captured.slice(0, 7) : '0']
    case 'tod':
      return [TOD(p.captured)]
    case 'rating':
      return [String(p.rating)]
    case 'status':
      return [p.status]
    case 'camera':
      return [p.cameraBody || '0']
    case 'lens':
      return [p.lens || '0']
  }
  return []
}

export function valueLabel(dim: string, v: string, ctx: Ctx): string {
  if (v === '0') return dim.startsWith('h:') || dim === 'shoot' || dim === 'subgroup' ? 'None' : dim === 'rating' ? 'No stars' : 'Unknown'
  if (dim.startsWith('h:')) return ctx.nodeById.get(Number(v))?.label ?? v
  switch (dim) {
    case 'shoot': {
      const s = ctx.shoots.get(Number(v))
      return s ? `${s.code} · ${s.name}` : v
    }
    case 'subgroup':
      return ctx.subgroups.get(Number(v))?.heading ?? v
    case 'month':
      return `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`
    case 'rating':
      return '★'.repeat(Number(v))
    case 'status':
      return v.charAt(0).toUpperCase() + v.slice(1)
  }
  return v
}

// ---------------------------------------------------------------- missing fields

export function isMissing(p: PhotoRow, key: string, ctx: Ctx): boolean {
  switch (key) {
    case 'title':
      return !p.title.trim()
    case 'caption':
      return !p.caption.trim()
    case 'note':
      return !p.note.trim()
    case 'alt':
      return !p.alt.trim()
    case 'shoot':
      return p.shootId === null
    case 'subgroup':
      return p.subgroupId === null
    case 'legendId':
      return !p.legendId
    case 'position':
      return p.lat === null && !p.noLocation
  }
  if (key.startsWith('h:')) {
    const h = ctx.hByKey.get(key.slice(2))
    return !!h && !p.nodes.some((id) => ctx.nodeById.get(id)?.hierarchyId === h.id)
  }
  return false
}

/** Required fields (for the "missing" marker on thumbnails). */
export function missingRequired(p: PhotoRow, ctx: Ctx): string[] {
  const out: string[] = []
  if (!p.title.trim()) out.push('title')
  if (!p.alt.trim()) out.push('alt text')
  if (p.shootId === null) out.push('shoot')
  if (p.lat === null && !p.noLocation) out.push('position')
  for (const h of ctx.hierarchies) if (h.required && isMissing(p, `h:${h.key}`, ctx)) out.push(h.name)
  return out
}

export const MISSING_KEYS = [
  ['title', 'Title'],
  ['caption', 'Caption'],
  ['note', 'Note'],
  ['alt', 'Alt text'],
  ['shoot', 'Shoot'],
  ['subgroup', 'Subgroup'],
  ['legendId', 'Legend ID'],
  ['position', 'Position']
] as const

export const FLAG_KEYS = [
  ['needs', 'Needs attention'],
  ['offline', 'File offline'],
  ['people', 'Shows people'],
  ['private', 'Private place'],
  ['variant', 'Variants'],
  ['changed', 'Changed since export'],
  ['thumbless', 'No thumbnail yet']
] as const

// ---------------------------------------------------------------- filtering

function inSource(p: PhotoRow, s: Source, nodeSet: Set<number> | null): boolean {
  switch (s.kind) {
    case 'all':
    case 'saved':
      return true
    case 'set':
      return p.sets.includes(s.id)
    case 'shoot':
      return p.shootId === s.id
    case 'subgroup':
      return p.subgroupId === s.id
    case 'noShoot':
      return p.shootId === null
    case 'node':
      return p.nodes.some((n) => nodeSet!.has(n))
  }
}

function textHit(p: PhotoRow, q: string, ctx: Ctx): boolean {
  const hay = [p.title, p.caption, p.note, p.alt, p.rawKey, p.legendId ?? '', p.publishedName ?? '']
  for (const s of hay) if (s.toLowerCase().includes(q)) return true
  for (const id of p.nodes) {
    for (const a of ancestors(id, ctx.nodeById)) {
      if (a.label.toLowerCase().includes(q)) return true
      if (a.altNames.some((x) => x.toLowerCase().includes(q))) return true
    }
  }
  const sh = p.shootId ? ctx.shoots.get(p.shootId) : null
  if (sh && (sh.name.toLowerCase().includes(q) || sh.code.toLowerCase().includes(q))) return true
  const sg = p.subgroupId ? ctx.subgroups.get(p.subgroupId) : null
  if (sg && sg.heading.toLowerCase().includes(q)) return true
  return false
}

function flagHit(p: PhotoRow, f: string, variantKeys: Set<string>): boolean {
  switch (f) {
    case 'offline':
      return p.fileOffline
    case 'people':
      return p.people
    case 'private':
      return p.privatePlace
    case 'variant':
      return variantKeys.has(p.rawKey.toLowerCase())
    case 'changed':
      return !!p.exportedAt && p.modifiedAt > p.exportedAt
    case 'thumbless':
      return p.thumbVer === 0
  }
  return true
}

export function filterPhotos(photos: PhotoRow[], source: Source, f: Filters, ctx: Ctx, skipFacet?: string): PhotoRow[] {
  const nodeSet = source.kind === 'node' ? descendants(source.id, ctx) : null
  const q = f.text.trim().toLowerCase()
  const facetEntries = Object.entries(f.facets).filter(([k, v]) => v.length && k !== skipFacet)
  let variantKeys = new Set<string>()
  if (f.flags.includes('variant')) {
    const count = new Map<string, number>()
    for (const p of photos) count.set(p.rawKey.toLowerCase(), (count.get(p.rawKey.toLowerCase()) ?? 0) + 1)
    variantKeys = new Set([...count].filter(([, n]) => n > 1).map(([k]) => k))
  }
  return photos.filter((p) => {
    if (!inSource(p, source, nodeSet)) return false
    if (f.minRating && p.rating < f.minRating) return false
    for (const m of f.missing) if (!isMissing(p, m, ctx)) return false
    for (const fl of f.flags) {
      if (fl === 'needs' ? !missingRequired(p, ctx).length : !flagHit(p, fl, variantKeys)) return false
    }
    for (const [dim, vals] of facetEntries) {
      const have = valuesOf(p, dim, ctx)
      if (!vals.some((v) => have.includes(v))) return false
    }
    if (q && !textHit(p, q, ctx)) return false
    return true
  })
}

// ---------------------------------------------------------------- sorting and grouping

function firstEntry(p: PhotoRow, hKey: string, ctx: Ctx): HNode | null {
  const h = ctx.hByKey.get(hKey)
  if (!h) return null
  for (const id of p.nodes) {
    const n = ctx.nodeById.get(id)
    if (n?.hierarchyId === h.id) return n
  }
  return null
}

export function sortPhotos(list: PhotoRow[], key: SortKey, dir: 1 | -1, ctx: Ctx): PhotoRow[] {
  const val = (p: PhotoRow): string | number => {
    switch (key) {
      case 'captured':
        return p.captured ?? ''
      case 'rawKey':
        return p.rawKey.toLowerCase() + '#' + String(p.variantNo).padStart(3, '0')
      case 'legendId':
        return p.legendId ?? '￿'
      case 'title':
        return p.title.toLowerCase() || '￿'
      case 'rating':
        return p.rating
      case 'status':
        return ['draft', 'ready', 'published', 'withdrawn'].indexOf(p.status)
      case 'importedAt':
        return p.importedAt
      case 'modifiedAt':
        return p.modifiedAt
      case 'shoot':
        return p.shootId ? ctx.shoots.get(p.shootId)?.code ?? '' : '￿'
    }
    if (key.startsWith('h:')) {
      const n = firstEntry(p, key.slice(2), ctx)
      return n ? pathLabel(n.id, ctx.nodeById).toLowerCase() : '￿'
    }
    return 0
  }
  const decorated = list.map((p) => ({ p, v: val(p), c: p.captured ?? '' }))
  decorated.sort((a, b) => (a.v < b.v ? -dir : a.v > b.v ? dir : a.c < b.c ? -1 : a.c > b.c ? 1 : a.p.id - b.p.id))
  return decorated.map((d) => d.p)
}

export interface Group {
  key: string
  label: string
  photos: PhotoRow[]
}

export function groupOptions(ctx: Ctx): { key: string; label: string }[] {
  const out = [
    { key: 'none', label: 'No grouping' },
    { key: 'shoot', label: 'Shoot' },
    { key: 'subgroup', label: 'Subgroup' },
    { key: 'date', label: 'Capture date' },
    { key: 'month', label: 'Month' },
    { key: 'year', label: 'Year' }
  ]
  for (const h of ctx.hierarchies.filter((x) => !x.archived)) {
    const depth = Math.max(h.levels.length, 2)
    for (let d = 1; d <= Math.min(depth, 4); d++) {
      const lvl = h.levels[d - 1] ?? `Level ${d}`
      out.push({ key: `h:${h.key}:${d}`, label: `${h.name} · ${lvl}` })
    }
  }
  return out
}

export function groupPhotos(list: PhotoRow[], by: string, ctx: Ctx): Group[] {
  if (by === 'none') return [{ key: 'all', label: '', photos: list }]
  const map = new Map<string, Group>()
  const add = (key: string, label: string, p: PhotoRow): void => {
    let g = map.get(key)
    if (!g) map.set(key, (g = { key, label, photos: [] }))
    g.photos.push(p)
  }
  for (const p of list) {
    if (by === 'shoot') {
      const s = p.shootId ? ctx.shoots.get(p.shootId) : null
      add(String(p.shootId ?? 0), s ? `${s.code} · ${s.name}` : 'No shoot', p)
    } else if (by === 'subgroup') {
      const s = p.subgroupId ? ctx.subgroups.get(p.subgroupId) : null
      const sh = p.shootId ? ctx.shoots.get(p.shootId) : null
      add(`${p.shootId ?? 0}:${p.subgroupId ?? 0}`, s ? `${sh?.code ?? ''} · ${s.heading}` : sh ? `${sh.code} · no subgroup` : 'No shoot', p)
    } else if (by === 'date') {
      const d = p.captured?.slice(0, 10) ?? ''
      add(d || 'none', d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) : 'Undated', p)
    } else if (by === 'month') {
      const m = p.captured?.slice(0, 7) ?? ''
      add(m || 'none', m ? valueLabel('month', m, ctx) : 'Undated', p)
    } else if (by === 'year') {
      const y = p.captured?.slice(0, 4) ?? ''
      add(y || 'none', y || 'Undated', p)
    } else if (by.startsWith('h:')) {
      const [, key, d] = by.split(':')
      const n = firstEntry(p, key, ctx)
      const chain = n ? ancestors(n.id, ctx.nodeById) : []
      const at = chain[Number(d) - 1]
      add(at ? String(at.id) : 'none', at ? chain.slice(0, Number(d)).map((x) => x.label).join(' › ') : 'None', p)
    }
  }
  const groups = [...map.values()]
  groups.sort((a, b) => (a.key === 'none' || a.key === '0' ? 1 : b.key === 'none' || b.key === '0' ? -1 : a.label.localeCompare(b.label)))
  return groups
}

/** The photos currently shown, in order, with their groups. */
export function useVisible(): { list: PhotoRow[]; groups: Group[]; ctx: Ctx } {
  const photos = useStore((s) => s.photos)
  const source = useStore((s) => s.source)
  const filters = useStore((s) => s.filters)
  const sort = useStore((s) => s.ui.sort)
  const groupBy = useStore((s) => s.ui.groupBy)
  const ctx = useCtx()
  return useMemo(() => {
    const filtered = filterPhotos(photos, source, filters, ctx)
    const sorted = sortPhotos(filtered, sort.key, sort.dir, ctx)
    const groups = groupPhotos(sorted, groupBy, ctx)
    const list = groups.flatMap((g) => g.photos)
    return { list, groups, ctx }
  }, [photos, source, filters, sort, groupBy, ctx])
}

export const sortOptions = (ctx: Ctx): { key: string; label: string }[] => [
  { key: 'captured', label: 'Capture time' },
  { key: 'rawKey', label: 'Raw key' },
  { key: 'legendId', label: 'Legend ID' },
  { key: 'title', label: 'Title' },
  { key: 'rating', label: 'Rating' },
  { key: 'status', label: 'Status' },
  { key: 'importedAt', label: 'Import date' },
  { key: 'modifiedAt', label: 'Last modified' },
  { key: 'shoot', label: 'Shoot' },
  ...ctx.hierarchies.filter((h) => !h.archived).map((h) => ({ key: `h:${h.key}`, label: h.name }))
]

export function fmtCaptured(c: string | null): string {
  if (!c) return 'Undated'
  const d = new Date(c)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
