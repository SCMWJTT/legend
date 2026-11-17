import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PhotoRow } from '@shared/types'
import { act, call, thumbUrl } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import {
  FLAG_KEYS, MISSING_KEYS, dims, filterPhotos, fmtCaptured, groupOptions, kidsOf, missingRequired, pathLabel, sortOptions,
  valueLabel, valuesOf, type Ctx, type Group
} from '../logic'
import { Icon } from './Icon'
import { openMenu, openMenuAt, prompt, Stars, type MenuItem } from './ui'
import { DRAG_TYPE } from './Navigator'
import * as cmd from '../commands'
import { useShown } from './StatusBar'

type Visible = { list: PhotoRow[]; groups: Group[]; ctx: Ctx }

export function LibraryView({ visible }: { visible: Visible }) {
  const view = useStore((s) => s.view)
  useEffect(() => useShown.setState({ n: visible.list.length }), [visible.list.length])
  const showFacets = useStore((s) => s.ui.showFacets)
  return (
    <>
      <Toolbar visible={visible} />
      <FilterLine ctx={visible.ctx} />
      {showFacets && <Facets ctx={visible.ctx} />}
      {visible.list.length === 0 ? (
        <EmptyState />
      ) : view === 'grid' ? (
        <Grid visible={visible} />
      ) : view === 'table' ? (
        <Table visible={visible} />
      ) : (
        <Single list={visible.list} />
      )}
    </>
  )
}

function EmptyState() {
  const total = useStore((s) => s.photos.length)
  const open = useStore((s) => s.openDialog)
  return (
    <div className="viewport" style={{ display: 'grid', placeItems: 'center' }}>
      {total === 0 ? (
        <div className="empty">
          <div style={{ color: 'var(--accent)', marginBottom: 14 }}><Icon name="import" size={36} stroke={1.2} /></div>
          <div style={{ fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Start by importing a folder of Lightroom exports</div>
          <div style={{ marginBottom: 18 }}>Legend reads the files and never changes them.</div>
          <button className="btn primary" onClick={() => open('import')}><Icon name="import" size={14} />Import a folder…</button>
        </div>
      ) : (
        <div className="empty">
          No photos match.
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => { const s = useStore.getState(); s.setSource({ kind: 'all' }); s.set({ filters: EMPTY_FILTERS }) }}>Clear filters</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- toolbar

function sourceLabel(ctx: Ctx): string {
  const s = useStore.getState()
  const src = s.source
  switch (src.kind) {
    case 'all': return 'All photos'
    case 'noShoot': return 'Not in a shoot'
    case 'set': return s.sets.find((x) => x.id === src.id)?.name ?? 'Set'
    case 'shoot': { const x = ctx.shoots.get(src.id); return x ? `${x.code} · ${x.name}` : 'Shoot' }
    case 'subgroup': return ctx.subgroups.get(src.id)?.heading ?? 'Subgroup'
    case 'node': return pathLabel(src.id, ctx.nodeById)
    case 'saved': return src.name
  }
}

function Toolbar({ visible }: { visible: Visible }) {
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const view = useStore((s) => s.view)
  const set = useStore((s) => s.set)
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const selected = useStore((s) => s.selected.size)
  useStore((s) => s.source)
  const ctx = visible.ctx
  const [text, setText] = useState(filters.text)
  useEffect(() => setText(filters.text), [filters.text])
  useEffect(() => {
    const t = setTimeout(() => text !== useStore.getState().filters.text && setFilters({ text }), 160)
    return () => clearTimeout(t)
  }, [text, setFilters])

  return (
    <div className="toolbar">
      <button className={'iconbtn' + (ui.navOpen ? '' : ' on')} title="Show or hide the navigator" onClick={() => setUi({ navOpen: !ui.navOpen })}><Icon name="panelL" /></button>
      <div className="crumbs" title={sourceLabel(ctx)}>
        <b>{sourceLabel(ctx)}</b>
        <span className="n">{visible.list.length.toLocaleString()}{selected ? ` · ${selected.toLocaleString()} sel.` : ''}</span>
      </div>
      <div className="search">
        <Icon name="search" size={15} />
        <input className="field" placeholder="Search titles, captions, names, places…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); setFilters({ text: '' }); (e.target as HTMLInputElement).blur() } }} />
      </div>
      <button className={'iconbtn' + (ui.showFacets ? ' on' : '')} title="Filter columns (F)" onClick={() => setUi({ showFacets: !ui.showFacets })}><Icon name="filter" /></button>
      <button className="iconbtn" title="More filters" onClick={(e) => openMenuAt(e.currentTarget, filterMenu())}><Icon name="sliders" /></button>
      <button className="btn ghost small" title="Sort" onClick={(e) => openMenuAt(e.currentTarget, [
        { head: 'Sort by' },
        ...sortOptions(ctx).map((o) => ({ label: o.label, icon: ui.sort.key === o.key ? 'check' : undefined, onClick: () => setUi({ sort: { ...useStore.getState().ui.sort, key: o.key } }) })),
        { sep: true },
        { label: 'Ascending', icon: ui.sort.dir === 1 ? 'check' : undefined, onClick: () => setUi({ sort: { ...useStore.getState().ui.sort, dir: 1 } }) },
        { label: 'Descending', icon: ui.sort.dir === -1 ? 'check' : undefined, onClick: () => setUi({ sort: { ...useStore.getState().ui.sort, dir: -1 } }) }
      ])}>
        <Icon name={ui.sort.dir === 1 ? 'sortUp' : 'sortDown'} size={15} />
        {sortOptions(ctx).find((o) => o.key === ui.sort.key)?.label ?? 'Sort'}
      </button>
      <button className={'iconbtn' + (ui.groupBy !== 'none' ? ' on' : '')} title={ui.groupBy === 'none' ? 'Group by' : `Grouped by ${groupOptions(ctx).find((o) => o.key === ui.groupBy)?.label}`}
        onClick={(e) => openMenuAt(e.currentTarget, [{ head: 'Group by' }, ...groupOptions(ctx).map((o) => ({ label: o.label, icon: ui.groupBy === o.key ? 'check' : undefined, onClick: () => setUi({ groupBy: o.key }) }))])}>
        <Icon name="layers" />
      </button>
      {view === 'grid' && (
        <input className="slider" type="range" min={0} max={6} value={ui.thumbSize} onChange={(e) => setUi({ thumbSize: Number(e.target.value) })} title="Thumbnail size" />
      )}
      {view === 'grid' && <button className="iconbtn" title="What thumbnails show" onClick={(e) => openMenuAt(e.currentTarget, overlayMenu(ctx))}><Icon name="eye" /></button>}
      <div className="seg">
        <button className={view === 'grid' ? 'on' : ''} title="Grid (G)" onClick={() => set({ view: 'grid' })}><Icon name="grid" size={15} /></button>
        <button className={view === 'table' ? 'on' : ''} title="Table (T)" onClick={() => set({ view: 'table' })}><Icon name="table" size={15} /></button>
        <button className={view === 'single' ? 'on' : ''} title="Single (E)" onClick={() => set({ view: 'single' })}><Icon name="single" size={15} /></button>
      </div>
      <button className={'iconbtn' + (ui.inspOpen ? '' : ' on')} title="Show or hide the inspector" onClick={() => setUi({ inspOpen: !ui.inspOpen })}><Icon name="panelR" /></button>
    </div>
  )
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function filterMenu(): MenuItem[] {
  const s = useStore.getState()
  const f = s.filters
  const ctx = { hierarchies: s.hierarchies }
  const items: MenuItem[] = [{ head: 'Missing' }]
  for (const [k, l] of MISSING_KEYS) items.push({ label: l, icon: f.missing.includes(k) ? 'check' : undefined, onClick: () => s.setFilters({ missing: toggleIn(f.missing, k) }) })
  for (const h of ctx.hierarchies.filter((x) => !x.archived)) {
    const k = `h:${h.key}`
    items.push({ label: `${h.name} entry`, icon: f.missing.includes(k) ? 'check' : undefined, onClick: () => s.setFilters({ missing: toggleIn(f.missing, k) }) })
  }
  items.push({ sep: true }, { head: 'Show only' })
  for (const [k, l] of FLAG_KEYS) items.push({ label: l, icon: f.flags.includes(k) ? 'check' : undefined, onClick: () => s.setFilters({ flags: toggleIn(f.flags, k) }) })
  items.push({ sep: true }, { head: 'Rating at least' })
  for (let n = 1; n <= 5; n++) items.push({ label: '★'.repeat(n), icon: f.minRating === n ? 'check' : undefined, onClick: () => s.setFilters({ minRating: f.minRating === n ? 0 : n }) })
  items.push(
    { sep: true },
    {
      label: 'Save this filter…',
      icon: 'save',
      onClick: async () => {
        const name = await prompt('Save filter', '', 'Saved filters appear in the navigator.', 'Save')
        if (!name) return
        const st = useStore.getState()
        const path = st.library!.path
        const all = { ...st.ui.savedFilters }
        all[path] = [...(all[path] ?? []).filter((x) => x.name !== name), { name, source: st.source, filters: st.filters }]
        st.setUi({ savedFilters: all })
      }
    }
  )
  return items
}

const OVERLAYS: [string, string][] = [
  ['title', 'Title'],
  ['legendId', 'Legend ID (or raw key)'],
  ['rawKey', 'Raw key'],
  ['date', 'Capture date'],
  ['shoot', 'Shoot and subgroup'],
  ['location', 'Location'],
  ['status', 'Status'],
  ['rating', 'Rating stars'],
  ['badges', 'Badges (offline, variant, no position, changed)'],
  ['missing', 'Missing-field marker']
]

function overlayMenu(ctx: Ctx): MenuItem[] {
  const s = useStore.getState()
  const o = s.ui.overlays
  const items: MenuItem[] = [{ head: 'Show on thumbnails' }]
  for (const [k, l] of OVERLAYS) items.push({ label: l, icon: o.includes(k) ? 'check' : undefined, onClick: () => s.setUi({ overlays: toggleIn(o, k) }) })
  const hs = ctx.hierarchies.filter((h) => !h.archived && h.key !== 'location')
  if (hs.length) items.push({ sep: true })
  for (const h of hs) {
    const k = `h:${h.key}`
    items.push({ label: h.name, icon: o.includes(k) ? 'check' : undefined, onClick: () => s.setUi({ overlays: toggleIn(o, k) }) })
  }
  return items
}

// ---------------------------------------------------------------- active filter chips

function FilterLine({ ctx }: { ctx: Ctx }) {
  const f = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const chips: { label: string; clear: () => void }[] = []
  if (f.text) chips.push({ label: `“${f.text}”`, clear: () => setFilters({ text: '' }) })
  for (const m of f.missing) {
    const l = MISSING_KEYS.find(([k]) => k === m)?.[1] ?? ctx.hByKey.get(m.slice(2))?.name ?? m
    chips.push({ label: `Missing ${l.toLowerCase()}`, clear: () => setFilters({ missing: f.missing.filter((x) => x !== m) }) })
  }
  for (const fl of f.flags) chips.push({ label: FLAG_KEYS.find(([k]) => k === fl)?.[1] ?? fl, clear: () => setFilters({ flags: f.flags.filter((x) => x !== fl) }) })
  if (f.minRating) chips.push({ label: `${'★'.repeat(f.minRating)} or more`, clear: () => setFilters({ minRating: 0 }) })
  for (const [dim, vals] of Object.entries(f.facets)) {
    for (const v of vals) chips.push({ label: valueLabel(dim, v, ctx), clear: () => setFilters({ facets: { ...f.facets, [dim]: vals.filter((x) => x !== v) } }) })
  }
  if (!chips.length) return null
  return (
    <div className="filterline">
      {chips.map((c, i) => (
        <span key={i} className="fchip">{c.label}<button onClick={c.clear}><Icon name="x" size={11} stroke={2} /></button></span>
      ))}
      <button className="linkbtn" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Clear all</button>
    </div>
  )
}

// ---------------------------------------------------------------- facet columns

function Facets({ ctx }: { ctx: Ctx }) {
  const columns = useStore((s) => s.ui.facetColumns)
  const setUi = useStore((s) => s.setUi)
  const all = dims(ctx)
  return (
    <div className="facets" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((dim, i) => (
        <FacetColumn key={i} dim={dim} ctx={ctx} options={all.map((d) => ({ key: d.key, label: d.label }))}
          onChange={(d) => setUi({ facetColumns: columns.map((c, j) => (j === i ? d : c)) })}
          onRemove={columns.length > 1 ? () => setUi({ facetColumns: columns.filter((_, j) => j !== i) }) : undefined}
          onAdd={columns.length < 6 && i === columns.length - 1 ? () => setUi({ facetColumns: [...columns, all.find((d) => !columns.includes(d.key))?.key ?? 'year'] }) : undefined}
        />
      ))}
    </div>
  )
}

function FacetColumn({ dim, ctx, options, onChange, onRemove, onAdd }: {
  dim: string; ctx: Ctx; options: { key: string; label: string }[]; onChange: (d: string) => void; onRemove?: () => void; onAdd?: () => void
}) {
  const photos = useStore((s) => s.photos)
  const source = useStore((s) => s.source)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const selectedVals = filters.facets[dim] ?? []
  const [open, setOpen] = useState<Set<string>>(new Set())

  // Counts use every filter except this column's own selection, so columns narrow each other.
  const counts = useMemo(() => {
    const base = filterPhotos(photos, source, filters, ctx, dim)
    const m = new Map<string, number>()
    for (const p of base) for (const v of valuesOf(p, dim, ctx)) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }, [photos, source, filters, ctx, dim])

  const toggle = (v: string, multi: boolean): void => {
    const next = multi ? toggleIn(selectedVals, v) : selectedVals.length === 1 && selectedVals[0] === v ? [] : [v]
    setFilters({ facets: { ...filters.facets, [dim]: next } })
  }

  const rows: { v: string; label: string; depth: number; hasKids: boolean }[] = []
  if (dim.startsWith('h:')) {
    const h = ctx.hByKey.get(dim.slice(2))
    if (h) {
      const walk = (parent: number | null, depth: number): void => {
        for (const n of kidsOf(ctx, h.id, parent)) {
          if (n.retired && !counts.get(String(n.id))) continue
          const kids = kidsOf(ctx, h.id, n.id)
          rows.push({ v: String(n.id), label: n.label, depth, hasKids: kids.length > 0 })
          if (open.has(String(n.id)) || selectedVals.some((sv) => ctx.nodeById.get(Number(sv)) && pathLabel(Number(sv), ctx.nodeById).startsWith(pathLabel(n.id, ctx.nodeById) + ' › ')))
            walk(n.id, depth + 1)
        }
      }
      walk(null, 0)
    }
    if (counts.get('0')) rows.push({ v: '0', label: 'None', depth: 0, hasKids: false })
  } else {
    const keys = [...counts.keys()]
    keys.sort((a, b) => {
      if (a === '0') return 1
      if (b === '0') return -1
      if (dim === 'rating' || dim === 'year' || dim === 'month') return b.localeCompare(a)
      if (dim === 'tod') return ['Morning', 'Afternoon', 'Evening', 'Night', 'Unknown'].indexOf(a) - ['Morning', 'Afternoon', 'Evening', 'Night', 'Unknown'].indexOf(b)
      return valueLabel(dim, a, ctx).localeCompare(valueLabel(dim, b, ctx))
    })
    for (const k of keys) rows.push({ v: k, label: valueLabel(dim, k, ctx), depth: 0, hasKids: false })
  }

  return (
    <div className="facet">
      <div className="facet-head">
        <select className="select mini-select" value={dim} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {selectedVals.length > 0 && <button className="iconbtn" style={{ width: 22, height: 22 }} title="Clear" onClick={() => setFilters({ facets: { ...filters.facets, [dim]: [] } })}><Icon name="x" size={12} /></button>}
        {onAdd && <button className="iconbtn" style={{ width: 22, height: 22 }} title="Add a column" onClick={onAdd}><Icon name="plus" size={13} /></button>}
        {onRemove && <button className="iconbtn" style={{ width: 22, height: 22 }} title="Remove this column" onClick={onRemove}><Icon name="more" size={13} /></button>}
      </div>
      <div className="facet-list">
        {rows.map((r) => {
          const n = counts.get(r.v) ?? 0
          const on = selectedVals.includes(r.v)
          return (
            <div key={r.v} className={'facet-row' + (on ? ' on' : '') + (n === 0 ? ' zero' : '')} style={{ paddingLeft: 8 + r.depth * 13 }}
              onClick={(e) => toggle(r.v, e.ctrlKey || e.metaKey)} title={on ? 'Click to clear; Ctrl-click to add more' : 'Ctrl-click to choose several'}>
              {dim.startsWith('h:') && (
                <span className="tw" style={{ width: 12, display: 'grid', placeItems: 'center', color: 'var(--text4)' }}
                  onClick={(e) => { e.stopPropagation(); const s = new Set(open); if (s.has(r.v)) s.delete(r.v); else s.add(r.v); setOpen(s) }}>
                  {r.hasKids && <Icon name={open.has(r.v) ? 'down' : 'right'} size={10} stroke={2.2} />}
                </span>
              )}
              <span className="l">{r.label}</span>
              <span className="n">{n.toLocaleString()}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- selection helpers

function clickSelect(e: React.MouseEvent, id: number, order: PhotoRow[]): void {
  const s = useStore.getState()
  if (e.shiftKey && s.anchorId !== null) {
    const ids = order.map((p) => p.id)
    const a = ids.indexOf(s.anchorId)
    const b = ids.indexOf(id)
    if (a >= 0 && b >= 0) {
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
      const next = e.ctrlKey ? new Set([...s.selected, ...range]) : new Set(range)
      useStore.setState({ selected: next, focusId: id })
      return
    }
  }
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(s.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    useStore.setState({ selected: next, focusId: id, anchorId: id })
    return
  }
  s.select([id], id)
}

function startDrag(e: React.DragEvent, id: number): void {
  const s = useStore.getState()
  let ids = [...s.selected]
  if (!s.selected.has(id)) {
    s.select([id], id)
    ids = [id]
  }
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
  e.dataTransfer.effectAllowed = 'copyMove'
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = ids.length === 1 ? '1 photo' : `${ids.length} photos`
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, -10, -10)
  setTimeout(() => ghost.remove(), 0)
}

function contextMenu(e: React.MouseEvent, id: number): void {
  const s = useStore.getState()
  if (!s.selected.has(id)) s.select([id], id)
  openMenu(e, cmd.photoMenu())
}

/** Arrow-key movement shared by grid, table and single view. */
function moveFocus(e: React.KeyboardEvent, order: PhotoRow[], step: number): boolean {
  const s = useStore.getState()
  const ids = order.map((p) => p.id)
  const cur = s.focusId !== null ? ids.indexOf(s.focusId) : -1
  const next = Math.max(0, Math.min(ids.length - 1, cur < 0 ? 0 : cur + step))
  const id = ids[next]
  if (id === undefined) return false
  if (e.shiftKey && s.anchorId !== null) {
    const a = ids.indexOf(s.anchorId)
    useStore.setState({ selected: new Set(ids.slice(Math.min(a, next), Math.max(a, next) + 1)), focusId: id })
  } else s.select([id], id)
  return true
}

// ---------------------------------------------------------------- grid

const SIZES = [118, 142, 170, 205, 250, 310, 390]

type GridItem = { kind: 'head'; g: Group; closed: boolean } | { kind: 'row'; photos: PhotoRow[] }

function Grid({ visible }: { visible: Visible }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const ui = useStore((s) => s.ui)
  const focusId = useStore((s) => s.focusId)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const tileW = SIZES[ui.thumbSize] ?? 205
  const cols = Math.max(1, Math.floor((width - 24) / tileW))
  const realW = Math.floor((width - 24) / cols)
  const metaLines = ui.overlays.filter((o) => ['title', 'legendId', 'rawKey', 'date', 'shoot', 'location', 'status'].includes(o) || o.startsWith('h:')).length
  const showMeta = Math.min(metaLines, 3)
  const tileH = Math.round(realW * 0.78) + (showMeta ? 8 + showMeta * 16 : 0)
  const grouped = visible.groups.length > 1 || (visible.groups[0]?.label ?? '') !== ''

  const items = useMemo(() => {
    const out: GridItem[] = []
    for (const g of visible.groups) {
      const isClosed = closed.has(g.key)
      if (grouped) out.push({ kind: 'head', g, closed: isClosed })
      if (isClosed) continue
      for (let i = 0; i < g.photos.length; i += cols) out.push({ kind: 'row', photos: g.photos.slice(i, i + cols) })
    }
    return out
  }, [visible.groups, cols, closed, grouped])

  const order = useMemo(() => items.flatMap((it) => (it.kind === 'row' ? it.photos : [])), [items])

  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => (items[i].kind === 'head' ? 46 : tileH),
    overscan: 4
  })
  useEffect(() => v.measure(), [tileH, v])

  // Keep the focused photo in view when it moves by keyboard.
  useEffect(() => {
    if (focusId === null) return
    const idx = items.findIndex((it) => it.kind === 'row' && it.photos.some((p) => p.id === focusId))
    if (idx >= 0) v.scrollToIndex(idx, { align: 'auto' })
  }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ask for thumbnails of what is on screen first.
  const vitems = v.getVirtualItems()
  const onScreen = vitems.flatMap((vi) => (items[vi.index]?.kind === 'row' ? (items[vi.index] as { photos: PhotoRow[] }).photos : []))
  const missingKey = onScreen.filter((p) => p.thumbVer <= 0).map((p) => p.id).join(',')
  useEffect(() => {
    if (!missingKey) return
    const t = setTimeout(() => void call('prioritiseThumbs', missingKey.split(',').map(Number)), 250)
    return () => clearTimeout(t)
  }, [missingKey])

  const onKey = (e: React.KeyboardEvent): void => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -1e9, End: 1e9, PageUp: -cols * 4, PageDown: cols * 4 }
    if (e.key in map) {
      e.preventDefault()
      moveFocus(e, order, map[e.key])
    } else if (e.key === 'Enter') useStore.getState().set({ view: 'single' })
  }

  return (
    <div className="viewport" ref={ref} tabIndex={0} onKeyDown={onKey}
      onMouseDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('grid-row')) useStore.getState().select([]) }}>
      <div className="grid-inner" style={{ height: v.getTotalSize() + 20 }}>
        {vitems.map((vi) => {
          const it = items[vi.index]
          if (it.kind === 'head') {
            return (
              <div key={'h' + it.g.key} className={'ghead' + (it.closed ? ' closed' : '')} style={{ top: vi.start, height: 46 }}
                onClick={() => { const s = new Set(closed); if (s.has(it.g.key)) s.delete(it.g.key); else s.add(it.g.key); setClosed(s) }}>
                <span className="caret"><Icon name="down" size={13} stroke={2} /></span>
                {it.g.label}
                <span className="n">{it.g.photos.length}</span>
                <button className="linkbtn sel" onClick={(e) => { e.stopPropagation(); useStore.getState().select(it.g.photos.map((p) => p.id)) }}>Select group</button>
              </div>
            )
          }
          return (
            <div key={vi.key} className="grid-row" style={{ top: vi.start, height: tileH }}>
              {it.photos.map((p) => <Tile key={p.id} p={p} w={realW} h={tileH} order={order} ctx={visible.ctx} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Tile = memo(function Tile({ p, w, h, order, ctx }: { p: PhotoRow; w: number; h: number; order: PhotoRow[]; ctx: Ctx }) {
  const selected = useStore((s) => s.selected.has(p.id))
  const focus = useStore((s) => s.focusId === p.id)
  const overlays = useStore((s) => s.ui.overlays)
  const [loaded, setLoaded] = useState(false)
  const url = thumbUrl(p.id, p.thumbVer)
  const missing = overlays.includes('missing') ? missingRequired(p, ctx) : []
  const lines: { text: string; cls: string }[] = []
  for (const o of overlays) {
    if (o === 'title') lines.push({ text: p.title || 'Untitled', cls: 't1' + (p.title ? '' : ' muted') })
    else if (o === 'legendId') lines.push({ text: p.legendId ?? p.rawKey, cls: 't2' })
    else if (o === 'rawKey') lines.push({ text: p.rawKey + (p.variantNo ? ` · v${p.variantNo + 1}` : ''), cls: 't2' })
    else if (o === 'date') lines.push({ text: fmtCaptured(p.captured), cls: 't2' })
    else if (o === 'status') lines.push({ text: p.status, cls: 't2' })
    else if (o === 'shoot') {
      const sh = p.shootId ? ctx.shoots.get(p.shootId) : null
      const sg = p.subgroupId ? ctx.subgroups.get(p.subgroupId) : null
      lines.push({ text: sh ? `${sh.code}${sg ? ' · ' + sg.heading : ''}` : 'No shoot', cls: 't2' })
    } else if (o === 'location' || o.startsWith('h:')) {
      const key = o === 'location' ? 'location' : o.slice(2)
      const h = ctx.hByKey.get(key)
      const labels = h ? p.nodes.map((id) => ctx.nodeById.get(id)).filter((n) => n?.hierarchyId === h.id).map((n) => n!.label) : []
      lines.push({ text: labels.join(', ') || '—', cls: 't2' })
    }
  }
  const noPos = p.lat === null && !p.noLocation
  const changed = !!p.exportedAt && p.modifiedAt > p.exportedAt
  return (
    <div className={'tile' + (selected ? ' sel' : '') + (focus ? ' focus' : '')} style={{ width: w, height: h }}
      draggable onDragStart={(e) => startDrag(e, p.id)}
      onMouseDown={(e) => { if (e.button === 0) clickSelect(e, p.id, order) }}
      onDoubleClick={() => useStore.getState().set({ view: 'single' })}
      onContextMenu={(e) => contextMenu(e, p.id)}>
      <div className="tile-in">
        <div className="img">
          {url ? <img src={url} className={loaded ? 'ok' : ''} onLoad={() => setLoaded(true)} draggable={false} alt="" /> : <div className="ph" />}
          {overlays.includes('badges') && (
            <div className="badges">
              {p.fileOffline && <span className="badge bad" title="File offline"><Icon name="offline" size={11} /></span>}
              {p.variantNo > 0 && <span className="badge acc" title="Variant">v{p.variantNo + 1}</span>}
              {noPos && <span className="badge" title="No position"><Icon name="pin" size={11} /></span>}
              {changed && <span className="badge warn" title="Changed since export">●</span>}
              {missing.length > 0 && <span className="missing-dot" title={`Missing: ${missing.join(', ')}`} />}
            </div>
          )}
          {!overlays.includes('badges') && missing.length > 0 && <div className="badges"><span className="missing-dot" title={`Missing: ${missing.join(', ')}`} /></div>}
          {overlays.includes('rating') && (
            <div className={'stars' + (p.rating ? ' has' : '')} onMouseDown={(e) => e.stopPropagation()}>
              <Stars value={p.rating} size={12} onChange={(n) => {
                const s = useStore.getState()
                const ids = s.selected.has(p.id) ? [...s.selected] : [p.id]
                void act('editFields', ids, [{ field: 'rating', value: n }], `Rating ${n}`)
              }} />
            </div>
          )}
        </div>
        {lines.length > 0 && (
          <div className="meta">
            {lines.slice(0, 3).map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
          </div>
        )}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------- table

const COLS: Record<string, { label: string; w: number; sort?: string }> = {
  thumb: { label: '', w: 64 },
  rawKey: { label: 'Raw key', w: 170, sort: 'rawKey' },
  legendId: { label: 'Legend ID', w: 110, sort: 'legendId' },
  title: { label: 'Title', w: 220, sort: 'title' },
  caption: { label: 'Caption', w: 260 },
  alt: { label: 'Alt text', w: 220 },
  rating: { label: 'Rating', w: 80, sort: 'rating' },
  captured: { label: 'Captured', w: 150, sort: 'captured' },
  shoot: { label: 'Shoot', w: 90, sort: 'shoot' },
  subgroup: { label: 'Subgroup', w: 180 },
  status: { label: 'Status', w: 80, sort: 'status' },
  position: { label: 'Position', w: 150 },
  publishedName: { label: 'Published name', w: 260 },
  camera: { label: 'Camera', w: 160 },
  file: { label: 'File', w: 300 }
}

function cell(p: PhotoRow, c: string, ctx: Ctx) {
  const miss = <span className="miss">—</span>
  switch (c) {
    case 'thumb': { const u = thumbUrl(p.id, p.thumbVer); return u ? <img src={u} alt="" /> : null }
    case 'rawKey': return <span className="mono">{p.rawKey}{p.variantNo ? ` v${p.variantNo + 1}` : ''}</span>
    case 'legendId': return p.legendId ? <span className="mono">{p.legendId}</span> : miss
    case 'title': return p.title || miss
    case 'caption': return p.caption || miss
    case 'alt': return p.alt || miss
    case 'rating': return p.rating ? <span style={{ color: 'var(--accent)' }}>{'★'.repeat(p.rating)}</span> : miss
    case 'captured': return fmtCaptured(p.captured)
    case 'shoot': return p.shootId ? <span className="mono">{ctx.shoots.get(p.shootId)?.code}</span> : miss
    case 'subgroup': return p.subgroupId ? ctx.subgroups.get(p.subgroupId)?.heading : miss
    case 'status': return p.status
    case 'position': return p.lat !== null ? `${p.lat.toFixed(4)}, ${p.lon!.toFixed(4)}` : p.noLocation ? 'No location' : miss
    case 'publishedName': return p.publishedName ? <span className="mono">{p.publishedName}</span> : miss
    case 'camera': return [p.cameraBody, p.lens].filter(Boolean).join(' · ') || miss
    case 'file': return <span className="mono">{p.filePath}</span>
  }
  if (c.startsWith('h:')) {
    const h = ctx.hByKey.get(c.slice(2))
    const l = h ? p.nodes.map((id) => ctx.nodeById.get(id)).filter((n) => n?.hierarchyId === h.id).map((n) => n!.label) : []
    return l.length ? l.join(', ') : miss
  }
  return null
}

function Table({ visible }: { visible: Visible }) {
  const ref = useRef<HTMLDivElement>(null)
  const columns = useStore((s) => s.ui.tableColumns)
  const sort = useStore((s) => s.ui.sort)
  const setUi = useStore((s) => s.setUi)
  const selected = useStore((s) => s.selected)
  const focusId = useStore((s) => s.focusId)
  const list = visible.list
  const ctx = visible.ctx
  const v = useVirtualizer({ count: list.length, getScrollElement: () => ref.current, estimateSize: () => 40, overscan: 10 })
  useEffect(() => {
    if (focusId === null) return
    const i = list.findIndex((p) => p.id === focusId)
    if (i >= 0) v.scrollToIndex(i, { align: 'auto' })
  }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps
  const colDef = (c: string) => COLS[c] ?? { label: ctx.hByKey.get(c.slice(2))?.name ?? c, w: 180, sort: c }
  const width = columns.reduce((a, c) => a + colDef(c).w + 16, 24)

  const columnMenu = useCallback((e: React.MouseEvent) => {
    const all = [...Object.keys(COLS), ...ctx.hierarchies.filter((h) => !h.archived).map((h) => `h:${h.key}`)]
    openMenu(e, [{ head: 'Columns' }, ...all.map((c) => ({
      label: colDef(c).label || 'Thumbnail', icon: columns.includes(c) ? 'check' : undefined,
      onClick: () => setUi({ tableColumns: columns.includes(c) ? columns.filter((x) => x !== c) : [...columns, c] })
    }))])
  }, [columns, ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viewport table" ref={ref} tabIndex={0}
      onKeyDown={(e) => { const m: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -15, PageDown: 15, Home: -1e9, End: 1e9 }; if (e.key in m) { e.preventDefault(); moveFocus(e, list, m[e.key]) } else if (e.key === 'Enter') useStore.getState().set({ view: 'single' }) }}>
      <div className="thead" style={{ width }} onContextMenu={columnMenu}>
        {columns.map((c) => {
          const d = colDef(c)
          return (
            <div key={c} className={'th' + (sort.key === d.sort ? ' on' : '')} style={{ width: d.w + 16 }}
              onClick={() => d.sort && setUi({ sort: { key: d.sort, dir: sort.key === d.sort ? (sort.dir === 1 ? -1 : 1) : 1 } })}>
              {d.label}{sort.key === d.sort ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
            </div>
          )
        })}
        <button className="iconbtn" style={{ width: 22, height: 22 }} title="Choose columns" onClick={columnMenu}><Icon name="plus" size={13} /></button>
      </div>
      <div style={{ height: v.getTotalSize(), position: 'relative', width }}>
        {v.getVirtualItems().map((vi) => {
          const p = list[vi.index]
          return (
            <div key={p.id} className={'trow' + (selected.has(p.id) ? ' sel' : '') + (focusId === p.id ? ' focus' : '')} style={{ top: vi.start }}
              draggable onDragStart={(e) => startDrag(e, p.id)}
              onMouseDown={(e) => e.button === 0 && clickSelect(e, p.id, list)}
              onDoubleClick={() => useStore.getState().set({ view: 'single' })}
              onContextMenu={(e) => contextMenu(e, p.id)}>
              {columns.map((c) => <div key={c} style={{ width: colDef(c).w + 16 }}>{cell(p, c, ctx)}</div>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- single view

function Single({ list }: { list: PhotoRow[] }) {
  const focusId = useStore((s) => s.focusId)
  const idx = Math.max(0, list.findIndex((p) => p.id === focusId))
  const p = list[idx]
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!list.length) return
    if (focusId === null || !list.some((x) => x.id === focusId)) useStore.getState().select([list[0].id], list[0].id)
  }, [focusId, list])
  useEffect(() => {
    const el = stripRef.current?.querySelector('img.on') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [idx])
  const go = (d: number): void => {
    const n = list[Math.max(0, Math.min(list.length - 1, idx + d))]
    if (n) useStore.getState().select([n.id], n.id)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  if (!p) return null
  const preview = thumbUrl(p.id, p.thumbVer, 'p')
  const from = Math.max(0, idx - 30)
  const strip = list.slice(from, idx + 31)
  return (
    <div className="single" ref={ref} tabIndex={0} style={{ outline: 'none' }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) } if (e.key === 'ArrowRight') { e.preventDefault(); go(1) } }}
      onContextMenu={(e) => contextMenu(e, p.id)}>
      <div className="stage">
        {preview ? <img key={p.id} src={preview} alt={p.alt} /> : <div className="muted">Preparing preview…</div>}
        <button className="navb l" onClick={() => go(-1)} disabled={idx === 0}><Icon name="left" size={20} /></button>
        <button className="navb r" onClick={() => go(1)} disabled={idx === list.length - 1}><Icon name="right" size={20} /></button>
      </div>
      <div>
        <div className="caption"><b>{p.title || 'Untitled'}</b>{p.caption}<span className="muted" style={{ marginLeft: 12 }}>{idx + 1} / {list.length}</span></div>
        <div className="strip" ref={stripRef}>
          {strip.map((x) => {
            const u = thumbUrl(x.id, x.thumbVer)
            return u ? <img key={x.id} src={u} className={x.id === p.id ? 'on' : ''} onClick={() => useStore.getState().select([x.id], x.id)} alt="" /> : null
          })}
        </div>
      </div>
    </div>
  )
}
