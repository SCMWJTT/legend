import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditableField, HistoryEntry, PhotoRow, TextMode } from '@shared/types'
import { act, call, thumbUrl } from '../api'
import { useStore } from '../store'
import { fmtCaptured, pathLabel, useCtx, type Ctx } from '../logic'
import { Icon } from './Icon'
import { Stars } from './ui'
import { openPicker, PickerHost } from './NodePicker'
import { MapPanel, anchorOf, distanceM } from './MapPanel'
import * as cmd from '../commands'

function shared<T>(photos: PhotoRow[], get: (p: PhotoRow) => T): { value: T | null; mixed: boolean } {
  if (!photos.length) return { value: null, mixed: false }
  const first = get(photos[0])
  for (const p of photos) if (get(p) !== first) return { value: null, mixed: true }
  return { value: first, mixed: false }
}

export function Inspector() {
  const selected = useStore((s) => s.selected)
  const byId = useStore((s) => s.byId)
  const tab = useStore((s) => s.ui.inspTab)
  const setUi = useStore((s) => s.setUi)
  const ctx = useCtx()
  const photos = useMemo(() => [...selected].map((id) => byId.get(id)).filter((p): p is PhotoRow => !!p), [selected, byId])

  if (!photos.length) {
    return (
      <div className="insp-body" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <div className="muted" style={{ maxWidth: 230 }}>
          <div style={{ marginBottom: 10, color: 'var(--text4)' }}><Icon name="image" size={30} stroke={1.2} /></div>
          Select photos to describe, classify and place them. Select several to edit them together.
        </div>
      </div>
    )
  }
  const tabs = [['describe', 'Describe'], ['classify', 'Classify'], ['locate', 'Locate'], ['shoot', 'Shoot'], ['history', 'History']]
  return (
    <>
      <Head photos={photos} />
      <div className="insp-tabs">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setUi({ inspTab: k })}>{l}</button>
        ))}
      </div>
      <div className="insp-body" key={tab}>
        {tab === 'describe' && <Describe photos={photos} />}
        {tab === 'classify' && <Classify photos={photos} ctx={ctx} />}
        {tab === 'locate' && <Locate photos={photos} ctx={ctx} />}
        {tab === 'shoot' && <ShootTab photos={photos} ctx={ctx} />}
        {tab === 'history' && <History photos={photos} />}
      </div>
      <PickerHost />
    </>
  )
}

function Head({ photos }: { photos: PhotoRow[] }) {
  const p = photos[0]
  const many = photos.length > 1
  return (
    <div className="insp-head">
      {many ? (
        <div className="stack">
          {photos.slice(0, 3).reverse().map((x, i) => {
            const u = thumbUrl(x.id, x.thumbVer)
            return u ? <img key={x.id} src={u} style={{ left: (2 - i) * 5 - 5, top: (2 - i) * -3 + 3, transform: `rotate(${(i - 1) * 4}deg)` }} alt="" /> : null
          })}
        </div>
      ) : thumbUrl(p.id, p.thumbVer) ? <img src={thumbUrl(p.id, p.thumbVer)!} alt="" /> : <div style={{ width: 64, height: 48, background: 'var(--bg2)', borderRadius: 5 }} />}
      <div>
        <div className="t">{many ? `${photos.length.toLocaleString()} photos` : p.title || 'Untitled'}</div>
        <div className="s">{many ? 'Changes apply to all selected' : p.legendId ?? p.rawKey}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Describe

function TextField({ photos, field, label, limit, multiline, rows = 3 }: { photos: PhotoRow[]; field: EditableField; label: string; limit?: number; multiline?: boolean; rows?: number }) {
  const sv = shared(photos, (p) => (p as unknown as Record<string, string>)[field])
  const many = photos.length > 1
  const [val, setVal] = useState(sv.value ?? '')
  const [mode, setMode] = useState<TextMode>('replace')
  const [find, setFind] = useState('')
  const [dirty, setDirty] = useState(false)
  const ids = photos.map((p) => p.id).join(',')
  useEffect(() => { setVal(sv.value ?? ''); setDirty(false) }, [ids, sv.value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMode('replace'); setFind('') }, [ids])

  const commit = (): void => {
    if (!dirty) return
    setDirty(false)
    if (mode === 'replace' && !many && val === (sv.value ?? '')) return
    if (mode === 'findReplace' && !find) return
    void act('editFields', photos.map((p) => p.id), [{ field, value: mode === 'replace' ? val : val, mode, find }], `Edit ${label.toLowerCase()}`).then(() => {
      if (mode !== 'replace') { setVal(''); setFind('') }
    })
  }
  const revert = (): void => { setVal(sv.value ?? ''); setDirty(false) }
  const common = {
    className: 'field' + (sv.mixed && mode === 'replace' ? ' multi-ph' : ''),
    value: val,
    spellCheck: true,
    placeholder: sv.mixed && mode === 'replace' ? 'Multiple values' : mode === 'prepend' ? 'Text to add at the start' : mode === 'append' ? 'Text to add at the end' : mode === 'findReplace' ? 'Replace with' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setVal(e.target.value); setDirty(true) },
    onBlur: commit
  }
  const len = mode === 'replace' ? val.length : 0
  return (
    <div>
      <div className="label">
        {label}
        {limit && mode === 'replace' && <span className={'hint' + (len > limit ? ' over' : '')}>{len}/{limit}</span>}
      </div>
      {mode === 'findReplace' && <input className="field" style={{ marginBottom: 6 }} placeholder="Find" value={find} onChange={(e) => { setFind(e.target.value); setDirty(true) }} />}
      {multiline ? (
        <textarea {...common} rows={rows} onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commit() } if (e.key === 'Escape') revert() }} />
      ) : (
        <input {...common} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') revert() }} />
      )}
      {many && (
        <div className="modebar">
          <div className="seg">
            {(['replace', 'prepend', 'append', 'findReplace'] as TextMode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setVal(m === 'replace' ? sv.value ?? '' : ''); setDirty(false) }}>
                {{ replace: 'Replace', prepend: 'Add to start', append: 'Add to end', findReplace: 'Find & replace' }[m]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Describe({ photos }: { photos: PhotoRow[] }) {
  const ids = photos.map((p) => p.id)
  const rating = shared(photos, (p) => p.rating)
  const [rights, setRights] = useState(false)
  return (
    <>
      <TextField photos={photos} field="title" label="Title" />
      <TextField photos={photos} field="caption" label="Caption" limit={240} multiline rows={2} />
      <TextField photos={photos} field="note" label="Note" multiline rows={5} />
      <TextField photos={photos} field="alt" label="Alt text" limit={150} multiline rows={2} />
      <div>
        <div className="label">Rating {rating.mixed && <span className="hint">multiple values</span>}</div>
        <Stars value={rating.value} size={18} onChange={(n) => void act('editFields', ids, [{ field: 'rating', value: n }], `Rating ${n}`)} />
      </div>
      <Flags photos={photos} />
      <div>
        <button className="btn ghost small" style={{ paddingLeft: 0 }} onClick={() => setRights(!rights)}>
          <Icon name={rights ? 'down' : 'right'} size={12} stroke={2} /> Rights and credit
        </button>
        {rights && (
          <div className="col" style={{ marginTop: 10 }}>
            <TextField photos={photos} field="creator" label="Creator" />
            <TextField photos={photos} field="copyright" label="Copyright" />
            <TextField photos={photos} field="licence" label="Licence" />
            <TextField photos={photos} field="credit" label="Credit line" />
          </div>
        )}
      </div>
    </>
  )
}

function Flags({ photos }: { photos: PhotoRow[] }) {
  const ids = photos.map((p) => p.id)
  const flag = (field: EditableField, label: string, get: (p: PhotoRow) => boolean) => {
    const sv = shared(photos, get)
    return (
      <label className="check">
        <input type="checkbox" checked={!!sv.value} ref={(el) => { if (el) el.indeterminate = sv.mixed }}
          onChange={(e) => void act('editFields', ids, [{ field, value: e.target.checked }], label)} />
        {label}
      </label>
    )
  }
  return (
    <div>
      <div className="label">Flags</div>
      {flag('people', 'Shows identifiable people', (p) => p.people)}
      {flag('privatePlace', 'Private place (never publish the position)', (p) => p.privatePlace)}
    </div>
  )
}

// ---------------------------------------------------------------- Classify

function Classify({ photos, ctx }: { photos: PhotoRow[]; ctx: Ctx }) {
  const ids = photos.map((p) => p.id)
  const hs = ctx.hierarchies.filter((h) => !h.archived)
  return (
    <>
      {hs.map((h) => {
        const counts = new Map<number, number>()
        for (const p of photos) for (const id of p.nodes) if (ctx.nodeById.get(id)?.hierarchyId === h.id) counts.set(id, (counts.get(id) ?? 0) + 1)
        const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || pathLabel(a[0], ctx.nodeById).localeCompare(pathLabel(b[0], ctx.nodeById)))
        return (
          <div key={h.id} className="hsec">
            <div className="hname">
              {h.name}
              <span className="meta">{h.multi ? 'many' : 'one per photo'}{h.required ? ' · required' : ''}</span>
              <span className="grow" />
              <button className="btn small ghost" onClick={(e) => openPicker(e.currentTarget, h, (nodeId) => void act('assignNode', ids, nodeId), (labels) => void act('createPath', h.id, labels, ids))}>
                <Icon name="plus" size={13} /> Add
              </button>
            </div>
            {entries.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>None</div>
            ) : (
              <div className="chips">
                {entries.map(([id, n]) => {
                  const path = pathLabel(id, ctx.nodeById).split(' › ')
                  const partial = n < photos.length
                  return (
                    <span key={id} className={'chip' + (partial ? ' partial' : '')} title={pathLabel(id, ctx.nodeById) + (partial ? ` — on ${n} of ${photos.length}` : '')}>
                      {path.length > 1 && <span className="path">{path.slice(0, -1).join(' › ')} ›</span>}
                      {path[path.length - 1]}
                      {partial && <span className="count">{n}/{photos.length}</span>}
                      {partial && (
                        <button className="x" title="Add to all selected" onClick={() => void act('assignNode', ids, id)}><Icon name="plus" size={10} stroke={2.2} /></button>
                      )}
                      <button className="x" title="Remove" onClick={() => void act('removeNode', ids, id)}><Icon name="x" size={10} stroke={2.2} /></button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      <div className="muted" style={{ fontSize: 12 }}>
        Tip: drag photos onto an entry in the navigator, or type a path such as <span className="kbd">Trinidad &gt; Maracas &gt; Tyrico Bay</span> to create several levels at once.
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Locate

let positionClipboard: { lat: number; lon: number; elevation: number | null } | null = null

function Locate({ photos, ctx }: { photos: PhotoRow[]; ctx: Ctx }) {
  const ids = photos.map((p) => p.id)
  const settings = useStore((s) => s.settings)!
  const [placing, setPlacing] = useState(false)
  const lat = shared(photos, (p) => p.lat)
  const lon = shared(photos, (p) => p.lon)
  const [coords, setCoords] = useState('')
  const idKey = ids.join(',')
  useEffect(() => setCoords(lat.value !== null && lon.value !== null ? `${lat.value}, ${lon.value}` : ''), [idKey, lat.value, lon.value])
  useEffect(() => setPlacing(false), [idKey])
  const ele = shared(photos, (p) => p.elevation)
  const [eleText, setEleText] = useState('')
  useEffect(() => setEleText(ele.value === null ? '' : String(Math.round(ele.value * 10) / 10)), [idKey, ele.value])
  const precision = shared(photos, (p) => p.precision)
  const showEle = shared(photos, (p) => p.showElevation)
  const noLoc = shared(photos, (p) => p.noLocation)
  const sub = shared(photos, (p) => p.subgroupId)
  const subgroup = sub.value ? ctx.subgroups.get(sub.value) ?? null : null
  const hasCamera = photos.some((p) => p.camLat !== null)
  const locH = ctx.hierarchies.find((h) => h.hasPosition)

  const applyCoords = (): void => {
    const m = coords.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/)
    if (!m) return useStore.getState().toast('Type latitude, longitude — for example 10.652, -61.441', 'warn')
    const la = Number(m[1])
    const lo = Number(m[2])
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return useStore.getState().toast('Those numbers are outside the map', 'warn')
    void act('setPosition', ids, la, lo)
  }

  // Nearest Location entry that carries a position (a suggestion only).
  const suggestion = useMemo(() => {
    if (!locH || lat.value === null || lon.value === null) return null
    let best: { id: number; d: number } | null = null
    for (const n of ctx.nodeById.values()) {
      if (n.hierarchyId !== locH.id || n.lat === null || n.lon === null || n.retired) continue
      const d = distanceM({ lat: lat.value, lon: lon.value }, { lat: n.lat, lon: n.lon })
      if (d <= settings.suggestDistanceM && (!best || d < best.d)) best = { id: n.id, d }
    }
    if (!best) return null
    if (photos.every((p) => p.nodes.includes(best!.id))) return null
    return best
  }, [locH, lat.value, lon.value, ctx, settings.suggestDistanceM, photos])

  return (
    <>
      <MapPanel photos={photos} subgroup={subgroup} placing={placing} onPlaced={() => setPlacing(false)} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button className={'btn small' + (placing ? ' primary' : '')} onClick={() => setPlacing(!placing)}>
          <Icon name="crosshair" size={13} />{placing ? 'Click the map…' : photos.length > 1 ? 'Place selection here' : 'Place by clicking'}
        </button>
        <button className="btn small ghost" disabled={!hasCamera} onClick={() => void act('resetToCamera', ids)} title="Restore the position recorded by the camera"><Icon name="reset" size={13} />Camera position</button>
        <button className="btn small ghost" onClick={() => void act('useNodePosition', ids)} title="Place at the position of the photo's Location entry"><Icon name="pin" size={13} />Location's position</button>
      </div>
      {suggestion && (
        <div className="hsec row" style={{ padding: '8px 10px' }}>
          <Icon name="pin" size={14} />
          <span className="grow">Nearby: <b>{ctx.nodeById.get(suggestion.id)?.label}</b> <span className="muted">({Math.round(suggestion.d)} m)</span></span>
          <button className="btn small" onClick={() => void act('assignNode', ids, suggestion.id)}>Use</button>
        </div>
      )}
      <div>
        <div className="label">Latitude, longitude {lat.mixed && <span className="hint">multiple positions</span>}</div>
        <div className="row">
          <input className="field mono" value={coords} placeholder={lat.mixed ? 'Multiple values' : 'e.g. 10.652, -61.441'} onChange={(e) => setCoords(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyCoords()} />
          <button className="btn small" onClick={applyCoords}>Set</button>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small ghost" disabled={photos.length !== 1 || photos[0].lat === null}
            onClick={() => { const p = photos[0]; positionClipboard = { lat: p.lat!, lon: p.lon!, elevation: p.elevation }; useStore.getState().toast('Position copied') }}>
            <Icon name="copy" size={13} />Copy position
          </button>
          <button className="btn small ghost" onClick={() => {
            if (!positionClipboard) return useStore.getState().toast('Copy a position first', 'warn')
            void act('setPosition', ids, positionClipboard.lat, positionClipboard.lon)
          }}><Icon name="paste" size={13} />Paste position</button>
          <span className="grow" />
          <button className="btn small ghost" disabled={lat.value === null && !lat.mixed} onClick={() => void act('setPosition', ids, null, null)}>Clear</button>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="label">Elevation (m)</div>
          <input className="field" value={eleText} placeholder={ele.mixed ? 'Multiple values' : '—'} onChange={(e) => setEleText(e.target.value)}
            onBlur={() => { const v = eleText.trim() === '' ? null : Number(eleText); if (v === null || Number.isFinite(v)) { if (v !== ele.value) void act('editFields', ids, [{ field: 'elevation', value: v }], 'Elevation') } }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </div>
        <div className="grow">
          <div className="label">Publishing precision</div>
          <div className="seg">
            {(['exact', 'rounded', 'hidden'] as const).map((v) => (
              <button key={v} className={precision.value === v ? 'on' : ''} onClick={() => void act('editFields', ids, [{ field: 'precision', value: v }], 'Precision')}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="check"><input type="checkbox" checked={!!showEle.value} ref={(el) => { if (el) el.indeterminate = showEle.mixed }} onChange={(e) => void act('editFields', ids, [{ field: 'showElevation', value: e.target.checked }], 'Show elevation')} />Publish elevation</label>
        <label className="check"><input type="checkbox" checked={!!noLoc.value} ref={(el) => { if (el) el.indeterminate = noLoc.mixed }} onChange={(e) => void act('editFields', ids, [{ field: 'noLocation', value: e.target.checked }], 'No location')} />No location (position not expected)</label>
      </div>
      {photos.length === 1 && (
        <div className="kv">
          <div>Source</div><div>{{ camera: 'Camera', hand: 'Set by hand', node: 'From location entry', none: 'None' }[photos[0].posSource]}</div>
          <div>Camera position</div><div className="mono">{photos[0].camLat !== null ? `${photos[0].camLat.toFixed(5)}, ${photos[0].camLon!.toFixed(5)}` : '—'}</div>
          <div>Camera elevation</div><div>{photos[0].camEle !== null ? `${Math.round(photos[0].camEle)} m` : '—'}</div>
        </div>
      )}
      {subgroup && (
        <div className="muted" style={{ fontSize: 12 }}>
          The blue marker is the anchor for “{subgroup.heading}”{subgroup.anchorSet ? '' : ' (centre of its photos)'}; drag it to set where its pin sits on the atlas.
          {!anchorOf(subgroup) && ' It appears once its photos have positions.'}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- Shoot

function ShootTab({ photos, ctx }: { photos: PhotoRow[]; ctx: Ctx }) {
  const ids = photos.map((p) => p.id)
  const shoots = useStore((s) => s.shoots)
  const subgroups = useStore((s) => s.subgroups)
  const sh = shared(photos, (p) => p.shootId)
  const sg = shared(photos, (p) => p.subgroupId)
  const shoot = sh.value ? ctx.shoots.get(sh.value) ?? null : null
  const subgroup = sg.value ? ctx.subgroups.get(sg.value) ?? null : null
  const named = photos.filter((p) => p.legendId).length
  const p = photos[0]
  return (
    <>
      <div>
        <div className="label">Shoot</div>
        <div className="row">
          <select className="select" value={sh.mixed ? '' : String(sh.value ?? 0)} onChange={(e) => {
            if (e.target.value === 'new') cmd.newShoot()
            else void act('setShoot', ids, Number(e.target.value) || null)
          }}>
            {sh.mixed && <option value="">Multiple shoots</option>}
            <option value="0">No shoot</option>
            {shoots.filter((s) => !s.archived || s.id === sh.value).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            <option value="new">New shoot…</option>
          </select>
        </div>
      </div>
      {shoot && (
        <div>
          <div className="label">Subgroup</div>
          <select className="select" value={sg.mixed ? '' : String(sg.value ?? 0)} onChange={(e) => {
            if (e.target.value === 'new') void cmd.newSubgroup(shoot.id)
            else void act('setSubgroup', ids, Number(e.target.value) || null)
          }}>
            {sg.mixed && <option value="">Multiple subgroups</option>}
            <option value="0">No subgroup</option>
            {subgroups.filter((g) => g.shootId === shoot.id).map((g) => <option key={g.id} value={g.id}>{g.heading}</option>)}
            <option value="new">New subgroup from selection…</option>
          </select>
        </div>
      )}
      <div className="hsec">
        <div className="hname">Names<span className="grow" /><span className="meta">{named} of {photos.length} named</span></div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" disabled={!shoot || named === photos.length} onClick={cmd.assignNames}><Icon name="hash" size={13} />Assign names</button>
          <button className="btn small ghost" disabled={!named} onClick={() => void act('withdrawNames', ids)} title="Only for photos never exported. The number is retired for ever.">Withdraw</button>
        </div>
        {!shoot && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Photos need a shoot before they can be named.</div>}
      </div>
      {photos.length === 1 && (
        <div className="kv">
          <div>Legend ID</div><div className="mono">{p.legendId ?? '—'}</div>
          <div>Published name</div><div className="mono">{p.publishedName ?? '—'}</div>
          <div>Raw key</div><div className="mono">{p.rawKey}{p.variantNo ? ` (variant ${p.variantNo + 1})` : ''}</div>
          <div>File</div><div className="mono" title={p.filePath}><button className="linkbtn" style={{ padding: 0 }} onClick={() => cmd.revealFile(p)}>{p.filePath.split(/[\\/]/).pop()}</button>{p.fileOffline && <span style={{ color: 'var(--bad)' }}> · offline</span>}</div>
          <div>Pixels</div><div>{p.width} × {p.height}</div>
          <div>Captured</div><div>{fmtCaptured(p.captured)}</div>
          <div>Camera</div><div>{p.cameraBody || '—'}</div>
          <div>Lens</div><div>{p.lens || '—'}</div>
          <div>Exposure</div><div>{[p.focal ? `${p.focal} mm` : '', p.aperture ? `f/${p.aperture}` : '', p.shutter ? `${p.shutter} s` : '', p.iso ? `ISO ${p.iso}` : ''].filter(Boolean).join('  ·  ') || '—'}</div>
          <div>Imported</div><div>{new Date(p.importedAt).toLocaleString()}</div>
          <div>Modified</div><div>{new Date(p.modifiedAt).toLocaleString()}</div>
          <div>Status</div><div>{p.status}</div>
        </div>
      )}
      {shoot && <ShootDetails shootId={shoot.id} />}
      {subgroup && <SubgroupDetails subgroupId={subgroup.id} />}
    </>
  )
}

function Commit({ label, value, onCommit, multiline, rows = 3, mono }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; rows?: number; mono?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const done = (): void => { if (v !== value) onCommit(v) }
  return (
    <div>
      <div className="label">{label}</div>
      {multiline ? (
        <textarea className="field" rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={done} />
      ) : (
        <input className={'field' + (mono ? ' mono' : '')} value={v} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </div>
  )
}

function ShootDetails({ shootId }: { shootId: number }) {
  const s = useStore((st) => st.shoots.find((x) => x.id === shootId))
  if (!s) return null
  return (
    <div className="hsec col">
      <div className="hname" style={{ marginBottom: 0 }}><span className="code mono" style={{ color: 'var(--accent)' }}>{s.code}</span> Shoot details</div>
      <Commit label="Name" value={s.name} onCommit={(v) => void act('updateShoot', s.id, { name: v })} />
      <Commit label="Description" value={s.description} multiline onCommit={(v) => void act('updateShoot', s.id, { description: v })} />
      <div className="row">
        <div className="grow"><Commit label="Time zone" value={s.timeZone} mono onCommit={(v) => void act('updateShoot', s.id, { timeZone: v })} /></div>
        <div className="grow"><Commit label="Clock correction (min)" value={String(s.clockOffsetMin)} onCommit={(v) => void act('updateShoot', s.id, { clockOffsetMin: Number(v) || 0 })} /></div>
      </div>
    </div>
  )
}

function SubgroupDetails({ subgroupId }: { subgroupId: number }) {
  const g = useStore((st) => st.subgroups.find((x) => x.id === subgroupId))
  if (!g) return null
  return (
    <div className="hsec col">
      <div className="hname" style={{ marginBottom: 0 }}><Icon name="layers" size={14} /> Subgroup details</div>
      <Commit label="Heading" value={g.heading} onCommit={(v) => void act('updateSubgroup', g.id, { heading: v })} />
      <Commit label="Description" value={g.description} multiline rows={4} onCommit={(v) => void act('updateSubgroup', g.id, { description: v })} />
      <Commit label="Write-up reference" value={g.writeup} mono onCommit={(v) => void act('updateSubgroup', g.id, { writeup: v })} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small ghost" onClick={() => { const f = useStore.getState().focusId; if (f) void act('updateSubgroup', g.id, { coverPhotoId: f }) }}>Use focused photo as cover</button>
        <button className="btn small ghost" onClick={() => {
          const ids = [...useStore.getState().selected]
          void act('updateSubgroup', g.id, { featured: [...g.featured.filter((x) => !ids.includes(x)), ...ids].slice(0, 12) })
        }}>Add selection to featured</button>
      </div>
      {g.featured.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{g.featured.length} featured photo{g.featured.length > 1 ? 's' : ''} <button className="linkbtn" onClick={() => void act('updateSubgroup', g.id, { featured: [] })}>clear</button></div>}
    </div>
  )
}

// ---------------------------------------------------------------- History

function History({ photos }: { photos: PhotoRow[] }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const p = photos[0]
  const rev = useStore((s) => s.byId.get(p.id)?.modifiedAt)
  const busy = useRef(0)
  useEffect(() => {
    if (photos.length !== 1) return
    const n = ++busy.current
    void call<HistoryEntry[]>('history', p.id).then((h) => n === busy.current && setItems(h))
  }, [p.id, rev, photos.length])
  if (photos.length !== 1) return <div className="muted">Select a single photo to see its history.</div>
  if (!items) return null
  if (!items.length) return <div className="muted">No changes since import.</div>
  const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'number' && Math.abs(v) <= 1 && false ? String(v) : String(v))
  return (
    <div className="hist">
      {items.map((h, i) => (
        <div key={i} className={'it' + (h.undone ? ' undone' : '')}>
          <div className="when">{new Date(h.at).toLocaleString()} · {h.label}</div>
          <div className="chg">
            <b>{h.field}</b>{' '}
            {h.field === 'entry' || h.field === 'set' ? (h.newValue ? `added ${show(h.newValue)}` : `removed ${show(h.oldValue)}`) : (
              <><span className="old">{show(h.oldValue)}</span> → {show(h.newValue)}</>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
