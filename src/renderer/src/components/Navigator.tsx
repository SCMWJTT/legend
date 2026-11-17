import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { act } from '../api'
import { useStore, EMPTY_FILTERS, type Source } from '../store'
import { ancestors, kidsOf, useCtx, missingRequired } from '../logic'
import { Icon } from './Icon'
import { openMenu, prompt, confirm } from './ui'
import * as cmd from '../commands'

export const DRAG_TYPE = 'application/x-legend-photos'

export function dragIds(e: DragEvent): number[] | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function useDrop(onIds: (ids: number[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false)
        const ids = dragIds(e)
        if (ids?.length) {
          e.preventDefault()
          onIds(ids)
        }
      }
    }
  }
}

function sameSource(a: Source, b: Source): boolean {
  return a.kind === b.kind && (a as { id?: number }).id === (b as { id?: number }).id && (a as { name?: string }).name === (b as { name?: string }).name
}

function Item({
  src,
  icon,
  label,
  n,
  depth = 0,
  twisty,
  onDropIds,
  onContext,
  extra,
  onClick
}: {
  src?: Source
  icon?: ReactNode
  label: ReactNode
  n?: number
  depth?: number
  twisty?: { open: boolean; toggle: () => void } | null
  onDropIds?: (ids: number[]) => void
  onContext?: (e: React.MouseEvent) => void
  extra?: ReactNode
  onClick?: () => void
}) {
  const source = useStore((s) => s.source)
  const setSource = useStore((s) => s.setSource)
  const drop = useDrop(onDropIds ?? (() => {}))
  const on = src ? sameSource(source, src) : false
  return (
    <div
      className={'nav-item' + (on ? ' on' : '') + (drop.over ? ' drop' : '')}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => {
        if (onClick) onClick()
        else if (src) {
          setSource(src)
          useStore.getState().setFilters({ ...EMPTY_FILTERS, text: useStore.getState().filters.text })
        }
      }}
      onContextMenu={onContext}
      {...(onDropIds ? drop.props : {})}
    >
      {twisty !== undefined && (
        <span
          className="tw"
          onClick={(e) => {
            e.stopPropagation()
            twisty?.toggle()
          }}
        >
          {twisty && <Icon name={twisty.open ? 'down' : 'right'} size={12} stroke={2} />}
        </span>
      )}
      {icon}
      <span className="lbl">{label}</span>
      {extra}
      {n !== undefined && <span className="n">{n.toLocaleString()}</span>}
    </div>
  )
}

function Section({ id, title, children, onAdd, addTitle }: { id: string; title: string; children: ReactNode; onAdd?: () => void; addTitle?: string }) {
  const closed = useStore((s) => !!s.ui.navCollapsed[`sec:${id}`])
  const setUi = useStore((s) => s.setUi)
  const toggle = (): void => setUi({ navCollapsed: { ...useStore.getState().ui.navCollapsed, [`sec:${id}`]: !closed } })
  return (
    <div className="nav-sec">
      <div className={'nav-head' + (closed ? ' closed' : '')} onClick={toggle}>
        <span className="caret"><Icon name="down" size={11} stroke={2} /></span>
        {title}
        {onAdd && (
          <button className="iconbtn add" style={{ width: 22, height: 22 }} title={addTitle} onClick={(e) => { e.stopPropagation(); onAdd() }}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {!closed && children}
    </div>
  )
}

export function Navigator() {
  const photos = useStore((s) => s.photos)
  const sets = useStore((s) => s.sets)
  const shoots = useStore((s) => s.shoots)
  const subgroups = useStore((s) => s.subgroups)
  const hierarchies = useStore((s) => s.hierarchies)
  const library = useStore((s) => s.library)
  const savedAll = useStore((s) => s.ui.savedFilters)
  const saved = savedAll[library?.path ?? ''] ?? []
  const navCollapsed = useStore((s) => s.ui.navCollapsed)
  const setUi = useStore((s) => s.setUi)
  const ctx = useCtx()
  const [showAllImports, setShowAllImports] = useState(false)

  const counts = useMemo(() => {
    const set = new Map<number, number>()
    const shoot = new Map<number, number>()
    const sg = new Map<number, number>()
    const node = new Map<number, number>()
    let noShoot = 0
    let needs = 0
    for (const p of photos) {
      for (const s of p.sets) set.set(s, (set.get(s) ?? 0) + 1)
      if (p.shootId) shoot.set(p.shootId, (shoot.get(p.shootId) ?? 0) + 1)
      else noShoot++
      if (p.subgroupId) sg.set(p.subgroupId, (sg.get(p.subgroupId) ?? 0) + 1)
      const seen = new Set<number>()
      for (const id of p.nodes) for (const a of ancestors(id, ctx.nodeById)) seen.add(a.id)
      for (const id of seen) node.set(id, (node.get(id) ?? 0) + 1)
      if (missingRequired(p, ctx).length) needs++
    }
    return { set, shoot, sg, node, noShoot, needs }
  }, [photos, ctx])

  const isOpen = (key: string): boolean => !!navCollapsed[key]
  const toggle = (key: string): void => setUi({ navCollapsed: { ...useStore.getState().ui.navCollapsed, [key]: !navCollapsed[key] } })

  const importSets = sets.filter((s) => s.kind === 'import')
  const manualSets = sets.filter((s) => s.kind === 'manual')

  const nodeTree = (hid: number, parent: number | null, depth: number): ReactNode =>
    kidsOf(ctx, hid, parent)
      .filter((n) => !n.retired)
      .map((n) => {
        const kids = kidsOf(ctx, hid, n.id).filter((k) => !k.retired)
        const open = isOpen(`n:${n.id}`)
        return (
          <div key={n.id}>
            <Item
              src={{ kind: 'node', id: n.id }}
              label={n.label}
              n={counts.node.get(n.id) ?? 0}
              depth={depth}
              twisty={kids.length ? { open, toggle: () => toggle(`n:${n.id}`) } : null}
              onDropIds={(ids) => void act('assignNode', ids, n.id)}
              onContext={(e) =>
                openMenu(e, [
                  { label: 'Add child…', icon: 'plus', onClick: async () => { const l = await prompt(`New entry under "${n.label}"`, '', undefined, 'Add'); if (l) void act('createNode', hid, n.id, l) } },
                  { label: 'Rename…', onClick: async () => { const l = await prompt('Rename', n.label, undefined, 'Rename'); if (l) void act('updateNode', n.id, { label: l }) } },
                  { label: 'Add to selected photos', icon: 'tag', onClick: () => { const ids = cmd.need(); if (ids) void act('assignNode', ids, n.id) } },
                  { label: 'Remove from selected photos', onClick: () => { const ids = cmd.need(); if (ids) void act('removeNode', ids, n.id) } },
                  { sep: true },
                  { label: 'Open in hierarchy explorer', icon: 'tree', onClick: () => useStore.getState().set({ workspace: 'hierarchies', explorerHierarchy: hid, explorerNode: n.id }) }
                ])
              }
            />
            {open && nodeTree(hid, n.id, depth + 1)}
          </div>
        )
      })

  return (
    <div className="nav-scroll">
      <Section id="lib" title="Library">
        <Item src={{ kind: 'all' }} icon={<Icon name="image" size={15} />} label="All photos" n={photos.length} />
        <Item src={{ kind: 'noShoot' }} icon={<Icon name="shoot" size={15} />} label="Not in a shoot" n={counts.noShoot} />
        <Item
          icon={<Icon name="alert" size={15} />}
          label="Needs attention"
          n={counts.needs}
          onClick={() => {
            const s = useStore.getState()
            s.setSource({ kind: 'all' })
            s.setFilters({ ...EMPTY_FILTERS, flags: ['needs'] })
          }}
        />
      </Section>

      {saved.length > 0 && (
        <Section id="saved" title="Saved filters">
          {saved.map((f) => (
            <Item
              key={f.name}
              src={{ kind: 'saved', name: f.name }}
              icon={<Icon name="filter" size={15} />}
              label={f.name}
              onClick={() => {
                const s = useStore.getState()
                s.set({ source: f.source.kind === 'saved' ? { kind: 'all' } : f.source, filters: f.filters, workspace: 'library' })
              }}
              onContext={(e) =>
                openMenu(e, [
                  {
                    label: 'Delete saved filter',
                    icon: 'trash',
                    onClick: () => {
                      const s = useStore.getState()
                      const all = { ...s.ui.savedFilters }
                      all[library!.path] = (all[library!.path] ?? []).filter((x) => x.name !== f.name)
                      s.setUi({ savedFilters: all })
                    }
                  }
                ])
              }
            />
          ))}
        </Section>
      )}

      <Section id="imports" title="Imports">
        {importSets.length === 0 && <div className="muted" style={{ padding: '2px 10px 6px', fontSize: 12 }}>Nothing imported yet</div>}
        {(showAllImports ? importSets : importSets.slice(0, 5)).map((s) => (
          <Item key={s.id} src={{ kind: 'set', id: s.id }} icon={<Icon name="import" size={15} />} label={s.name} n={counts.set.get(s.id) ?? 0} />
        ))}
        {importSets.length > 5 && (
          <div className="nav-item" onClick={() => setShowAllImports(!showAllImports)}>
            <span className="muted" style={{ paddingLeft: 22 }}>{showAllImports ? 'Show fewer' : `Show all ${importSets.length}`}</span>
          </div>
        )}
      </Section>

      <Section id="sets" title="Sets" onAdd={() => void cmd.newSet()} addTitle="New set from selection">
        {manualSets.length === 0 && <div className="muted" style={{ padding: '2px 10px 6px', fontSize: 12 }}>Drag photos onto a set to add them</div>}
        {manualSets.map((s) => (
          <Item
            key={s.id}
            src={{ kind: 'set', id: s.id }}
            icon={<Icon name="list" size={15} />}
            label={s.name}
            n={counts.set.get(s.id) ?? 0}
            onDropIds={(ids) => void act('addToSet', s.id, ids)}
            onContext={(e) =>
              openMenu(e, [
                { label: 'Rename…', onClick: async () => { const n = await prompt('Rename set', s.name); if (n) void act('renameSet', s.id, n) } },
                { label: 'Remove set', icon: 'trash', onClick: async () => { if (await confirm(`Remove the set "${s.name}"?`, 'The photos themselves are not affected.', 'Remove', true)) void act('deleteSet', s.id) } }
              ])
            }
          />
        ))}
      </Section>

      <Section id="shoots" title="Shoots" onAdd={cmd.newShoot} addTitle="New shoot from selection">
        {shoots.length === 0 && <div className="muted" style={{ padding: '2px 10px 6px', fontSize: 12 }}>Select photos and press Ctrl+N to make a shoot</div>}
        {shoots.filter((s) => !s.archived).map((s) => {
          const subs = subgroups.filter((g) => g.shootId === s.id)
          const open = isOpen(`s:${s.id}`)
          return (
            <div key={s.id}>
              <Item
                src={{ kind: 'shoot', id: s.id }}
                label={<><span className="code">{s.code}</span>&nbsp; {s.name}</>}
                n={counts.shoot.get(s.id) ?? 0}
                twisty={subs.length ? { open, toggle: () => toggle(`s:${s.id}`) } : null}
                onDropIds={(ids) => void act('setShoot', ids, s.id)}
                onContext={(e) =>
                  openMenu(e, [
                    { label: 'New subgroup from selection…', icon: 'layers', onClick: () => void cmd.newSubgroup(s.id) },
                    { label: 'Rename shoot…', onClick: async () => { const n = await prompt('Rename shoot', s.name); if (n) void act('updateShoot', s.id, { name: n }) } },
                    { label: 'Assign names to all its photos', icon: 'hash', onClick: () => void act('assignNames', photos.filter((p) => p.shootId === s.id).map((p) => p.id)) },
                    { sep: true },
                    { label: 'Archive shoot', onClick: () => void act('updateShoot', s.id, { archived: true }) }
                  ])
                }
              />
              {open && subs.map((g) => (
                <Item
                  key={g.id}
                  src={{ kind: 'subgroup', id: g.id }}
                  icon={<Icon name="layers" size={14} />}
                  label={g.heading}
                  n={counts.sg.get(g.id) ?? 0}
                  depth={1}
                  twisty={null}
                  onDropIds={(ids) => void act('setSubgroup', ids, g.id)}
                  onContext={(e) =>
                    openMenu(e, [
                      { label: 'Rename…', onClick: async () => { const n = await prompt('Subgroup heading', g.heading); if (n) void act('updateSubgroup', g.id, { heading: n }) } },
                      { label: 'Remove subgroup', icon: 'trash', onClick: async () => { if (await confirm(`Remove "${g.heading}"?`, 'Its photos stay in the shoot without a subgroup.', 'Remove', true)) void act('deleteSubgroup', g.id) } }
                    ])
                  }
                />
              ))}
            </div>
          )
        })}
        {shoots.some((s) => s.archived) && (
          <div className="nav-item" onClick={() => toggle('archived')}>
            <span className="muted" style={{ paddingLeft: 22 }}>{isOpen('archived') ? 'Hide archived' : 'Show archived'}</span>
          </div>
        )}
        {isOpen('archived') && shoots.filter((s) => s.archived).map((s) => (
          <Item key={s.id} src={{ kind: 'shoot', id: s.id }} label={<span className="muted"><span className="code">{s.code}</span>&nbsp; {s.name}</span>} n={counts.shoot.get(s.id) ?? 0}
            onContext={(e) => openMenu(e, [{ label: 'Restore shoot', onClick: () => void act('updateShoot', s.id, { archived: false }) }])} />
        ))}
      </Section>

      {hierarchies.filter((h) => !h.archived).map((h) => (
        <Section key={h.id} id={`h${h.id}`} title={h.name} onAdd={async () => { const l = await prompt(`New ${h.name} entry`, '', 'Added at the top level. Use the hierarchy explorer to arrange it.', 'Add'); if (l) void act('createNode', h.id, null, l) }} addTitle={`New ${h.name} entry`}>
          {kidsOf(ctx, h.id, null).filter((n) => !n.retired).length === 0 && (
            <div className="muted" style={{ padding: '2px 10px 6px', fontSize: 12 }}>No entries yet</div>
          )}
          {nodeTree(h.id, null, 0)}
        </Section>
      ))}
    </div>
  )
}
