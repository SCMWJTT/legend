import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HNode, Hierarchy } from '@shared/types'
import { act, call, thumbUrl } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import { ancestors, descendants, kidsOf, pathLabel, useCtx, valueLabel, valuesOf, type Ctx } from '../logic'
import { Icon } from './Icon'
import { confirm, openMenu, prompt } from './ui'
import { openPicker, PickerHost } from './NodePicker'
import { DRAG_TYPE, dragIds } from './Navigator'

const NODE_DRAG = 'application/x-legend-node'

export function Explorer() {
  const ctx = useCtx()
  const hid = useStore((s) => s.explorerHierarchy)
  const set = useStore((s) => s.set)
  const [mode, setMode] = useState<'tree' | 'cross' | 'report'>('tree')
  const hs = ctx.hierarchies
  const h = hs.find((x) => x.id === hid) ?? hs.find((x) => !x.archived) ?? null
  useEffect(() => { if (h && h.id !== hid) set({ explorerHierarchy: h.id }) }, [h, hid, set])

  return (
    <div className="explorer">
      <section>
        <div className="ex-head"><h3>Hierarchies</h3>
          <button className="iconbtn" title="New hierarchy" onClick={() => useStore.getState().openDialog('hierarchy')}><Icon name="plus" /></button>
        </div>
        <div className="ex-scroll">
          {hs.map((x) => (
            <div key={x.id} className={'nav-item' + (h?.id === x.id && mode !== 'cross' ? ' on' : '')} onClick={() => { set({ explorerHierarchy: x.id, explorerNode: null }); if (mode === 'cross') setMode('tree') }}>
              <Icon name="tree" size={15} />
              <span className="lbl" style={{ opacity: x.archived ? 0.45 : 1 }}>{x.name}</span>
              <span className="n">{[...ctx.nodeById.values()].filter((n) => n.hierarchyId === x.id && !n.retired).length}</span>
            </div>
          ))}
          <div style={{ height: 14 }} />
          <div className={'nav-item' + (mode === 'cross' ? ' on' : '')} onClick={() => setMode('cross')}><Icon name="grid" size={15} /><span className="lbl">Cross view</span></div>
          <div className={'nav-item' + (mode === 'report' ? ' on' : '')} onClick={() => setMode('report')}><Icon name="alert" size={15} /><span className="lbl">Tidy-up report</span></div>
        </div>
      </section>
      {mode === 'cross' ? <CrossView ctx={ctx} /> : mode === 'report' ? <Report ctx={ctx} h={h} /> : h ? <TreePane h={h} ctx={ctx} /> : <section />}
      {mode === 'cross' ? null : <DetailPane ctx={ctx} h={h} />}
      <PickerHost />
    </div>
  )
}

// ---------------------------------------------------------------- tree

function TreePane({ h, ctx }: { h: Hierarchy; ctx: Ctx }) {
  const photos = useStore((s) => s.photos)
  const selectedNode = useStore((s) => s.explorerNode)
  const set = useStore((s) => s.set)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ id: number; where: 'in' | 'before' } | null>(null)
  const [showRetired, setShowRetired] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of photos) {
      const seen = new Set<number>()
      for (const id of p.nodes) {
        const n = ctx.nodeById.get(id)
        if (n?.hierarchyId !== h.id) continue
        for (const a of ancestors(id, ctx.nodeById)) seen.add(a.id)
      }
      for (const id of seen) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }, [photos, ctx, h.id])

  // Reveal the selected node.
  useEffect(() => {
    if (!selectedNode) return
    const chain = ancestors(selectedNode, ctx.nodeById).slice(0, -1).map((n) => n.id)
    if (chain.some((id) => !open.has(id))) setOpen(new Set([...open, ...chain]))
  }, [selectedNode]) // eslint-disable-line react-hooks/exhaustive-deps

  const match = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return null
    const hits = new Set<number>()
    for (const n of ctx.nodeById.values()) {
      if (n.hierarchyId !== h.id) continue
      if (n.label.toLowerCase().includes(query) || n.altNames.some((a) => a.toLowerCase().includes(query))) for (const a of ancestors(n.id, ctx.nodeById)) hits.add(a.id)
    }
    return hits
  }, [q, ctx, h.id])

  const rows: { n: HNode; depth: number; hasKids: boolean }[] = []
  const walk = (parent: number | null, depth: number): void => {
    for (const n of kidsOf(ctx, h.id, parent)) {
      if (n.retired && !showRetired) continue
      if (match && !match.has(n.id)) continue
      const kids = kidsOf(ctx, h.id, n.id).filter((k) => showRetired || !k.retired)
      rows.push({ n, depth, hasKids: kids.length > 0 })
      if (open.has(n.id) || match) walk(n.id, depth + 1)
    }
  }
  walk(null, 0)

  const toggle = (id: number): void => { const s = new Set(open); if (s.has(id)) s.delete(id); else s.add(id); setOpen(s) }

  const menu = (e: React.MouseEvent, n: HNode): void => {
    set({ explorerNode: n.id })
    openMenu(e, [
      { label: 'Add child…', icon: 'plus', onClick: async () => { const l = await prompt(`New entry under "${n.label}"`, '', undefined, 'Add'); if (l) { await act('createNode', h.id, n.id, l); setOpen(new Set([...open, n.id])) } } },
      { label: 'Add sibling…', onClick: async () => { const l = await prompt('New entry beside it', '', undefined, 'Add'); if (l) void act('createNode', h.id, n.parentId, l) } },
      { label: 'Rename', key: 'F2', onClick: () => setEditing(n.id) },
      { label: 'Merge into…', icon: 'merge', onClick: () => {
        const el = document.querySelector(`[data-node="${n.id}"]`) as HTMLElement
        openPicker(el, h, async (into) => {
          if (await confirm(`Merge "${n.label}" into "${pathLabel(into, ctx.nodeById)}"?`, 'All its photos and children move across; its name is kept as an alternate name and the entry is retired.', 'Merge')) void act('mergeNodes', n.id, into)
        }, () => useStore.getState().toast('Choose an existing entry to merge into', 'warn'))
      } },
      { label: 'Move to top level', disabled: n.parentId === null, onClick: () => void act('moveNode', n.id, null, null) },
      { sep: true },
      { label: 'Add to selected photos', icon: 'tag', onClick: () => { const ids = [...useStore.getState().selected]; if (ids.length) void act('assignNode', ids, n.id); else useStore.getState().toast('No photos are selected in the library', 'warn') } },
      { label: 'Show photos in library', icon: 'image', onClick: () => { useStore.getState().setSource({ kind: 'node', id: n.id }); useStore.getState().setFilters(EMPTY_FILTERS) } },
      { sep: true },
      n.retired
        ? { label: 'Restore', onClick: () => void act('updateNode', n.id, { retired: false }) }
        : { label: 'Retire (hide from pickers)', onClick: () => void act('updateNode', n.id, { retired: true }) },
      { label: 'Delete', icon: 'trash', onClick: async () => {
        if (await call<boolean>('nodeInUse', n.id)) return useStore.getState().toast('This entry has been used, so it can be retired but not deleted', 'warn')
        if (await confirm(`Delete "${n.label}"?`, undefined, 'Delete', true)) void act('deleteNode', n.id)
      } }
    ])
  }

  return (
    <section>
      <div className="ex-head">
        <h3>{h.name}</h3>
        <button className="btn small" onClick={async () => { const l = await prompt(`New ${h.name} entry`, '', 'Added at the top level. Drag it to place it, or type a path with >.', 'Add'); if (l) void act('createPath', h.id, l.split(/\s*(?:>|›)\s*/).filter(Boolean), []) }}><Icon name="plus" size={13} />Entry</button>
        <button className="iconbtn" title="More" onClick={(e) => openMenu(e, [
          { label: 'Expand all', onClick: () => setOpen(new Set([...ctx.nodeById.values()].filter((n) => n.hierarchyId === h.id).map((n) => n.id))) },
          { label: 'Collapse all', onClick: () => setOpen(new Set()) },
          { label: showRetired ? 'Hide retired entries' : 'Show retired entries', onClick: () => setShowRetired(!showRetired) },
          { sep: true },
          { label: 'Import outline (.txt)…', icon: 'import', onClick: () => void act('importOutline', h.id) },
          { label: 'Export outline (.txt)…', icon: 'save', onClick: async () => { const p = await call<string | null>('exportOutline', h.id); if (p) useStore.getState().toast(`Saved ${p}`) } }
        ])}><Icon name="more" /></button>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <input className="field" style={{ borderRadius: 8 }} placeholder="Find an entry…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ex-scroll"
        onDragOver={(e) => { if (e.dataTransfer.types.includes(NODE_DRAG) && e.target === e.currentTarget) { e.preventDefault(); setDrop(null) } }}
        onDrop={(e) => { const id = Number(e.dataTransfer.getData(NODE_DRAG)); if (id && e.target === e.currentTarget) void act('moveNode', id, null, null) }}>
        {rows.length === 0 && <div className="empty">No entries yet.<br />Add one, import an outline, or import photos with Lightroom keywords.</div>}
        {rows.map(({ n, depth, hasKids }) => (
          <div key={n.id} data-node={n.id}
            className={'tree-row' + (selectedNode === n.id ? ' on' : '') + (n.retired ? ' retired' : '') + (drop?.id === n.id ? (drop.where === 'in' ? ' drop-in' : ' drop-before') : '')}
            style={{ '--d': depth } as React.CSSProperties}
            draggable={editing !== n.id}
            onDragStart={(e) => { e.dataTransfer.setData(NODE_DRAG, String(n.id)); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => {
              const isNode = e.dataTransfer.types.includes(NODE_DRAG)
              const isPhoto = e.dataTransfer.types.includes(DRAG_TYPE)
              if (!isNode && !isPhoto) return
              e.preventDefault()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const where = isNode && e.clientY < r.top + r.height * 0.3 ? 'before' : 'in'
              if (drop?.id !== n.id || drop.where !== where) setDrop({ id: n.id, where })
            }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => {
              e.preventDefault()
              const where = drop?.where ?? 'in'
              setDrop(null)
              const ids = dragIds(e)
              if (ids?.length) return void act('assignNode', ids, n.id)
              const moving = Number(e.dataTransfer.getData(NODE_DRAG))
              if (!moving || moving === n.id) return
              if (where === 'in') { void act('moveNode', moving, n.id, null); setOpen(new Set([...open, n.id])) }
              else void act('moveNode', moving, n.parentId, n.id)
            }}
            onClick={() => set({ explorerNode: n.id })}
            onDoubleClick={() => setEditing(n.id)}
            onKeyDown={(e) => { if (e.key === 'F2') setEditing(n.id) }}
            tabIndex={0}
            onContextMenu={(e) => menu(e, n)}>
            <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(n.id) }}>{hasKids && <Icon name={open.has(n.id) || match ? 'down' : 'right'} size={11} stroke={2.2} />}</span>
            {editing === n.id ? (
              <input autoFocus defaultValue={n.label} onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { const v = e.target.value.trim(); setEditing(null); if (v && v !== n.label) void act('updateNode', n.id, { label: v }) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
            ) : (
              <span className="lbl">{n.label}{n.altNames.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>  ({n.altNames.join(', ')})</span>}</span>
            )}
            {n.lat !== null && <Icon name="pin" size={12} />}
            <span className="n">{(counts.get(n.id) ?? 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- details

function DetailPane({ ctx, h }: { ctx: Ctx; h: Hierarchy | null }) {
  const nodeId = useStore((s) => s.explorerNode)
  const node = nodeId ? ctx.nodeById.get(nodeId) : undefined
  if (node && h && node.hierarchyId === h.id) return <NodeDetails n={node} ctx={ctx} h={h} />
  if (h) return <HierarchySettings h={h} />
  return <section />
}

function Field({ label, value, onCommit, multiline, placeholder }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const props = { className: 'field', value: v, placeholder, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value), onBlur: () => v !== value && onCommit(v) }
  return (
    <div>
      <div className="label">{label}</div>
      {multiline ? <textarea {...props} rows={4} /> : <input {...props} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
    </div>
  )
}

function NodeDetails({ n, ctx, h }: { n: HNode; ctx: Ctx; h: Hierarchy }) {
  const photos = useStore((s) => s.photos)
  const below = useMemo(() => {
    const d = descendants(n.id, ctx)
    return photos.filter((p) => p.nodes.some((id) => d.has(id)))
  }, [photos, n.id, ctx])
  const direct = below.filter((p) => p.nodes.includes(n.id)).length
  const chain = ancestors(n.id, ctx.nodeById)
  const level = h.levels[chain.length - 1]
  const [pos, setPos] = useState('')
  useEffect(() => setPos(n.lat !== null ? `${n.lat}, ${n.lon}` : ''), [n.lat, n.lon, n.id])
  const centre = (): { lat: number; lon: number } | null => {
    const ps = below.filter((p) => p.lat !== null)
    if (!ps.length) return null
    return { lat: +(ps.reduce((a, p) => a + p.lat!, 0) / ps.length).toFixed(6), lon: +(ps.reduce((a, p) => a + p.lon!, 0) / ps.length).toFixed(6) }
  }
  return (
    <section>
      <div className="ex-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <div className="muted" style={{ fontSize: 12 }}>{chain.slice(0, -1).map((a) => a.label).join(' › ') || h.name}{level ? ` · ${level}` : ''}</div>
        <h3 style={{ fontSize: 17 }}>{n.label}</h3>
        <div className="muted mono" style={{ fontSize: 11 }}>{n.publicId}{n.retired ? ' · retired' : ''}</div>
      </div>
      <div className="insp-body" style={{ paddingTop: 4 }}>
        <Field label="Label" value={n.label} onCommit={(v) => v.trim() && void act('updateNode', n.id, { label: v })} />
        <Field label="Alternate names (comma separated)" value={n.altNames.join(', ')} onCommit={(v) => void act('updateNode', n.id, { altNames: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <Field label="Description (introduction for its gallery page)" value={n.description} multiline onCommit={(v) => void act('updateNode', n.id, { description: v })} />
        {h.hasPosition && (
          <div>
            <div className="label">Map position</div>
            <div className="row">
              <input className="field mono" value={pos} placeholder="lat, lon" onChange={(e) => setPos(e.target.value)}
                onBlur={() => {
                  const m = pos.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/)
                  if (!pos.trim()) { if (n.lat !== null) void act('updateNode', n.id, { lat: null, lon: null }) }
                  else if (m) void act('updateNode', n.id, { lat: Number(m[1]), lon: Number(m[2]), zoom: n.zoom ?? 15 })
                }} />
              <button className="btn small ghost" title="Centre of its photos" onClick={() => { const c = centre(); if (c) void act('updateNode', n.id, { lat: c.lat, lon: c.lon, zoom: n.zoom ?? 15 }); else useStore.getState().toast('None of its photos has a position', 'warn') }}>
                <Icon name="crosshair" size={13} />From photos
              </button>
            </div>
          </div>
        )}
        <Field label="External references (one per line: name = value)" multiline value={Object.entries(n.refs).map(([k, v]) => `${k} = ${v}`).join('\n')}
          onCommit={(v) => void act('updateNode', n.id, { refs: Object.fromEntries(v.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((a) => a[0] && a[1] !== undefined).map((a) => [a[0], a.slice(1).join('=')])) })} />
        <div>
          <div className="label">Photos <span className="hint">{direct} directly · {below.length} at or below</span></div>
          <div className="minigrid">
            {below.slice(0, 48).map((p) => {
              const u = thumbUrl(p.id, p.thumbVer)
              return u ? <img key={p.id} src={u} title={p.title || p.rawKey} alt=""
                onClick={() => { const s = useStore.getState(); s.setSource({ kind: 'node', id: n.id }); s.setFilters(EMPTY_FILTERS); s.select([p.id], p.id) }}
                onDoubleClick={() => void act('updateNode', n.id, { coverPhotoId: p.id })} /> : null
            })}
          </div>
          {below.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => { const s = useStore.getState(); s.setSource({ kind: 'node', id: n.id }); s.setFilters(EMPTY_FILTERS) }}>Show all in library</button>
              <span className="muted" style={{ fontSize: 11.5 }}>Double-click a photo to make it the cover{n.coverPhotoId ? ' (cover set)' : ''}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function HierarchySettings({ h }: { h: Hierarchy }) {
  return (
    <section>
      <div className="ex-head"><h3>{h.name} settings</h3></div>
      <div className="insp-body" style={{ paddingTop: 4 }}>
        <Field label="Name" value={h.name} onCommit={(v) => v.trim() && void act('updateHierarchy', h.id, { name: v.trim() })} />
        <div>
          <div className="label">Key (permanent, used in exports)</div>
          <div className="mono muted">{h.key}</div>
        </div>
        <div>
          <div className="label">Entries per photo</div>
          <div className="seg">
            <button className={!h.multi ? 'on' : ''} onClick={() => void act('updateHierarchy', h.id, { multi: false })}>One</button>
            <button className={h.multi ? 'on' : ''} onClick={() => void act('updateHierarchy', h.id, { multi: true })}>Many</button>
          </div>
        </div>
        <Field label="Level names (comma separated, top first)" value={h.levels.join(', ')} placeholder="e.g. Country, Island, Location, Sublocation"
          onCommit={(v) => void act('updateHierarchy', h.id, { levels: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <label className="check"><input type="checkbox" checked={h.hasPosition} onChange={(e) => void act('updateHierarchy', h.id, { hasPosition: e.target.checked })} />Entries carry a map position</label>
        <label className="check"><input type="checkbox" checked={h.required} onChange={(e) => void act('updateHierarchy', h.id, { required: e.target.checked })} />Required before a photo is Ready</label>
        <label className="check"><input type="checkbox" checked={h.archived} onChange={(e) => void act('updateHierarchy', h.id, { archived: e.target.checked })} />Archived (hidden from the library and pickers)</label>
        <div className="muted" style={{ fontSize: 12 }}>Select an entry in the tree to edit it. Drag entries to move them; drop near the top edge of another entry to place it before that entry. Drop photos from the library onto an entry to assign it.</div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- cross view

function CrossView({ ctx }: { ctx: Ctx }) {
  const photos = useStore((s) => s.photos)
  const opts = useMemo(() => {
    const out: { key: string; label: string }[] = []
    for (const h of ctx.hierarchies.filter((x) => !x.archived)) for (let d = 1; d <= Math.max(2, Math.min(4, h.levels.length || 3)); d++) out.push({ key: `h:${h.key}:${d}`, label: `${h.name} · ${h.levels[d - 1] ?? `level ${d}`}` })
    out.push({ key: 'shoot', label: 'Shoot' }, { key: 'year', label: 'Year' }, { key: 'month', label: 'Month' }, { key: 'tod', label: 'Time of day' }, { key: 'rating', label: 'Rating' }, { key: 'status', label: 'Status' })
    return out
  }, [ctx])
  const [rowDim, setRow] = useState(opts.find((o) => o.key === 'h:location:3')?.key ?? opts[0]?.key ?? 'year')
  const [colDim, setCol] = useState(opts.find((o) => o.key.startsWith('h:keywords:1'))?.key ?? 'year')

  // Values at a given depth for hierarchy dims.
  const vals = (p: (typeof photos)[number], dim: string): string[] => {
    if (!dim.startsWith('h:')) return valuesOf(p, dim, ctx)
    const [, key, d] = dim.split(':')
    const all = valuesOf(p, `h:${key}`, ctx)
    if (all[0] === '0') return ['0']
    const at = all.filter((v) => ancestors(Number(v), ctx.nodeById).length === Number(d))
    return at.length ? at : ['0']
  }
  const label = (dim: string, v: string): string => valueLabel(dim.startsWith('h:') ? `h:${dim.split(':')[1]}` : dim, v, ctx)

  const { rows, cols, cells, max } = useMemo(() => {
    const cells = new Map<string, number[]>()
    const rs = new Map<string, number>()
    const cs = new Map<string, number>()
    for (const p of photos) {
      const rv = vals(p, rowDim)
      const cv = vals(p, colDim)
      for (const r of rv) {
        rs.set(r, (rs.get(r) ?? 0) + 1)
        for (const c of cv) {
          const k = r + '|' + c
          const a = cells.get(k) ?? []
          a.push(p.id)
          cells.set(k, a)
        }
      }
      for (const c of cv) cs.set(c, (cs.get(c) ?? 0) + 1)
    }
    const order = (m: Map<string, number>, dim: string) => [...m.keys()].sort((a, b) => (a === '0' ? 1 : b === '0' ? -1 : label(dim, a).localeCompare(label(dim, b))))
    let max = 1
    for (const a of cells.values()) max = Math.max(max, a.length)
    return { rows: order(rs, rowDim), cols: order(cs, colDim), cells, max }
  }, [photos, rowDim, colDim, ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section style={{ gridColumn: 'span 2' }}>
      <div className="ex-head">
        <h3>Cross view</h3>
        <span className="muted">Rows</span>
        <select className="select" style={{ width: 220 }} value={rowDim} onChange={(e) => setRow(e.target.value)}>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
        <span className="muted">Columns</span>
        <select className="select" style={{ width: 220 }} value={colDim} onChange={(e) => setCol(e.target.value)}>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      </div>
      <div className="muted" style={{ padding: '0 12px 10px', fontSize: 12 }}>Counts of photos for each pair. Click a cell to see those photos in the library. Empty cells show where coverage is missing.</div>
      <div className="cross">
        <table>
          <thead><tr><th style={{ writingMode: 'horizontal-tb', transform: 'none', height: 'auto' }} />{cols.map((c) => <th key={c}>{label(colDim, c)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th>{label(rowDim, r)}</th>
                {cols.map((c) => {
                  const ids = cells.get(r + '|' + c) ?? []
                  const a = ids.length / max
                  return (
                    <td key={c} className={ids.length ? '' : 'z'} style={ids.length ? { background: `rgba(224,168,94,${0.1 + a * 0.55})`, color: a > 0.5 ? '#1a1408' : 'var(--text)' } : { background: 'var(--bg2)' }}
                      title={`${label(rowDim, r)} × ${label(colDim, c)}: ${ids.length}`}
                      onClick={() => {
                        if (!ids.length) return
                        const s = useStore.getState()
                        const setName = `${label(rowDim, r)} × ${label(colDim, c)}`
                        s.setSource({ kind: 'all' })
                        s.set({ filters: { ...EMPTY_FILTERS, facets: facetFor(rowDim, r, colDim, c) } })
                        s.toast(`Showing ${setName}`)
                      }}>
                      {ids.length || '·'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function facetFor(rowDim: string, r: string, colDim: string, c: string): Record<string, string[]> {
  const key = (d: string) => (d.startsWith('h:') ? `h:${d.split(':')[1]}` : d)
  const out: Record<string, string[]> = {}
  out[key(rowDim)] = [r]
  out[key(colDim)] = [...(out[key(colDim)] ?? []), c]
  return out
}

// ---------------------------------------------------------------- tidy-up report

function Report({ ctx, h }: { ctx: Ctx; h: Hierarchy | null }) {
  const photos = useStore((s) => s.photos)
  const set = useStore((s) => s.set)
  const used = useMemo(() => {
    const u = new Set<number>()
    for (const p of photos) for (const id of p.nodes) for (const a of ancestors(id, ctx.nodeById)) u.add(a.id)
    return u
  }, [photos, ctx])
  const nodes = [...ctx.nodeById.values()].filter((n) => !n.retired && (!h || n.hierarchyId === h.id))
  const unused = nodes.filter((n) => !used.has(n.id))
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').replace(/s$/, '')
  const groups = new Map<string, HNode[]>()
  for (const n of nodes) {
    const k = norm(n.label)
    const a = groups.get(k) ?? []
    a.push(n)
    groups.set(k, a)
  }
  const similar = [...groups.values()].filter((g) => g.length > 1)
  const go = (n: HNode): void => set({ explorerHierarchy: n.hierarchyId, explorerNode: n.id })
  const List = ({ items }: { items: ReactNode[] }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{items}</div>
  return (
    <section>
      <div className="ex-head"><h3>Tidy-up report{h ? ` · ${h.name}` : ''}</h3></div>
      <div className="insp-body">
        <div>
          <div className="label">Similar labels <span className="hint">{similar.length}</span></div>
          {similar.length === 0 ? <div className="muted">None found.</div> : <List items={similar.map((g, i) => (
            <div key={i} className="hsec">{g.map((n) => <div key={n.id} className="nav-item" onClick={() => go(n)}><span className="lbl">{pathLabel(n.id, ctx.nodeById)}</span></div>)}</div>
          ))} />}
        </div>
        <div>
          <div className="label">Unused entries <span className="hint">{unused.length}</span></div>
          {unused.length === 0 ? <div className="muted">Every entry is used.</div> : <List items={unused.slice(0, 300).map((n) => (
            <div key={n.id} className="nav-item" onClick={() => go(n)}><span className="lbl">{pathLabel(n.id, ctx.nodeById)}</span></div>
          ))} />}
        </div>
      </div>
    </section>
  )
}
