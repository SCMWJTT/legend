import { useEffect, useMemo, useState } from 'react'
import type { DuplicateChoice, DuplicateGroup, EditableField, ImportReport, PasteSpec, Settings } from '@shared/types'
import { publishedName, TEMPLATE_SEGMENTS } from '@shared/naming'
import { act, bridge, call } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import { loadLibrary } from '../App'
import { Dialog, confirm } from './ui'
import { Icon } from './Icon'

export function Dialogs() {
  const d = useStore((s) => s.dialog)
  const close = useStore((s) => s.closeDialog)
  if (!d) return null
  switch (d.kind) {
    case 'import': return <ImportDialog close={close} />
    case 'shoot': return <ShootDialog close={close} ids={(d.props?.ids as number[]) ?? []} />
    case 'settings': return <SettingsDialog close={close} />
    case 'paste': return <PasteDialog close={close} />
    case 'shortcuts': return <ShortcutsDialog close={close} />
    case 'hierarchy': return <HierarchyDialog close={close} />
  }
  return null
}

// ---------------------------------------------------------------- import

type ImportResult = { needsChoice: DuplicateGroup[] } | { report: ImportReport; setId: number; delta: never }

function ImportDialog({ close }: { close: () => void }) {
  const [folder, setFolder] = useState(() => localStorage.getItem('legend.lastImport') ?? '')
  const [recursive, setRecursive] = useState(false)
  const [step, setStep] = useState<'choose' | 'running' | 'choice' | 'done'>('choose')
  const [dups, setDups] = useState<DuplicateGroup[]>([])
  const [choices, setChoices] = useState<Record<string, DuplicateChoice>>({})
  const [report, setReport] = useState<ImportReport | null>(null)
  const [setId, setSetId] = useState<number | null>(null)
  const [openList, setOpenList] = useState<string | null>(null)
  const progress = useStore((s) => s.progress)

  const run = async (ch?: Record<string, DuplicateChoice>): Promise<void> => {
    if (!folder) return
    localStorage.setItem('legend.lastImport', folder)
    setStep('running')
    try {
      const r = await call<ImportResult>('runImport', folder, recursive, ch)
      if ('needsChoice' in r) {
        setDups(r.needsChoice)
        setChoices(Object.fromEntries(r.needsChoice.map((g) => [g.rawKey.toLowerCase(), 'variant'])))
        setStep('choice')
        return
      }
      useStore.getState().applyDelta((r as unknown as { delta: Parameters<ReturnType<typeof useStore.getState>['applyDelta']>[0] }).delta)
      setReport(r.report)
      setSetId(r.setId)
      setStep('done')
    } catch (e) {
      useStore.getState().toast((e as Error).message, 'error')
      setStep('choose')
    }
  }

  if (step === 'running') {
    const pct = progress.importTotal ? (100 * progress.importDone) / progress.importTotal : 0
    return (
      <Dialog title="Importing…" onClose={() => {}}>
        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        <div className="muted">{progress.importTotal ? `${progress.importDone} of ${progress.importTotal} files · ${progress.importLabel}` : 'Scanning the folder…'}</div>
      </Dialog>
    )
  }

  if (step === 'choice') {
    return (
      <Dialog title="Same raw key, several files" wide onClose={() => setStep('choose')}
        sub="These files share a raw key. Choose for each whether they are separate variants (each becomes its own photo) or whether the newest file replaces the others."
        foot={<>
          <div className="left row">
            <button className="btn small ghost" onClick={() => setChoices(Object.fromEntries(dups.map((g) => [g.rawKey.toLowerCase(), 'variant'])))}>All variants</button>
            <button className="btn small ghost" onClick={() => setChoices(Object.fromEntries(dups.map((g) => [g.rawKey.toLowerCase(), 'replace'])))}>All replacements</button>
          </div>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={() => void run(choices)}>Continue import</button>
        </>}>
        {dups.map((g) => {
          const k = g.rawKey.toLowerCase()
          return (
            <div key={k} className="hsec">
              <div className="hname"><span className="mono">{g.rawKey}</span><span className="grow" />
                <div className="seg">
                  <button className={choices[k] === 'variant' ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: 'variant' })}>Variants</button>
                  <button className={choices[k] === 'replace' ? 'on' : ''} onClick={() => setChoices({ ...choices, [k]: 'replace' })}>Replacement</button>
                </div>
              </div>
              <div className="mono muted" style={{ fontSize: 11.5 }}>{g.files.map((f) => <div key={f}>{f.split(/[\\/]/).pop()}</div>)}</div>
            </div>
          )
        })}
      </Dialog>
    )
  }

  if (step === 'done' && report) {
    const stats: [string, string, string[]][] = [
      ['added', 'New photos', report.added],
      ['known', 'Already catalogued', report.known],
      ['changed', 'Re-exported', report.changed],
      ['variants', 'Variants', report.variants],
      ['skipped', 'Skipped', report.skipped.map((s) => `${s.file} — ${s.reason}`).concat(report.replaced.map((r) => `${r} — replaced by a newer file`))],
      ['flags', 'Flagged', report.flags.map((f) => `${f.file} — ${f.message}`)]
    ]
    return (
      <Dialog title="Import complete" wide onClose={close}
        sub={report.changed.length ? 'Re-exported photos kept all their catalogue fields; their thumbnails are being refreshed.' : 'Thumbnails are being made in the background; you can start working now.'}
        foot={<>
          <button className="btn ghost" onClick={close}>Close</button>
          <button className="btn primary" onClick={() => { const s = useStore.getState(); if (setId) s.setSource({ kind: 'set', id: setId }); s.set({ filters: EMPTY_FILTERS }); close() }}>Show imported photos</button>
        </>}>
        <div className="report">
          {stats.map(([k, l, list]) => (
            <div key={k} className="stat" style={{ cursor: list.length ? 'pointer' : 'default', boxShadow: openList === k ? 'inset 0 0 0 1.5px var(--accent-ring)' : '' }} onClick={() => list.length && setOpenList(openList === k ? null : k)}>
              <b>{list.length}</b><span>{l}</span>
            </div>
          ))}
        </div>
        {openList && <div className="filelist">{stats.find((s) => s[0] === openList)![2].map((f, i) => <div key={i}>{f}</div>)}</div>}
      </Dialog>
    )
  }

  return (
    <Dialog title="Import Lightroom exports" onClose={close}
      sub="Choose the folder Lightroom exported JPEGs into. Files are only read; Legend never changes them."
      foot={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!folder} onClick={() => void run()}><Icon name="import" size={14} />Import</button>
      </>}>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFolder(bridge.pathForFile(f)) }}>
        <div className="label">Folder</div>
        <div className="row">
          <input className="field mono" value={folder} placeholder="Drop a folder here or browse" onChange={(e) => setFolder(e.target.value)} />
          <button className="btn" onClick={async () => { const f = await call<string | null>('chooseFolder'); if (f) setFolder(f) }}><Icon name="folder" size={14} />Browse…</button>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />Include subfolders</label>
      <div className="muted" style={{ fontSize: 12 }}>
        New photos start as Draft with their Lightroom title, caption, rating, keywords and GPS. Photos already in the library are recognised by their raw key and keep everything you have recorded.
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- new shoot

function ShootDialog({ close, ids }: { close: () => void; ids: number[] }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [touched, setTouched] = useState(false)
  const [free, setFree] = useState<boolean | null>(null)
  useEffect(() => {
    if (touched) return
    if (!name.trim()) { setCode(''); return }
    const t = setTimeout(() => void call<string>('proposeCode', name).then(setCode).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [name, touched])
  useEffect(() => {
    if (!/^[A-Z0-9]{4}$/.test(code)) { setFree(null); return }
    void call<boolean>('codeFree', code).then(setFree)
  }, [code])
  const ok = name.trim() && /^[A-Z0-9]{4}$/.test(code) && free
  const submit = async (): Promise<void> => { if (!ok) return; const r = await act('createShoot', name.trim(), code, ids); if (r?.ok) close() }
  return (
    <Dialog title="New shoot" onClose={close}
      sub={ids.length ? `${ids.length} selected photo${ids.length > 1 ? 's' : ''} will be put in it.` : 'No photos are selected; you can add them later by dragging.'}
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => void submit()}>Create shoot</button></>}>
      <div>
        <div className="label">Name</div>
        <input className="field" autoFocus value={name} placeholder="e.g. Maracas Lime" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
      <div>
        <div className="label">Code <span className={'hint' + (free === false ? ' over' : '')}>{code.length !== 4 ? 'four letters or digits' : free === null ? '' : free ? 'available' : 'already used — codes are never reused'}</span></div>
        <input className="field mono" style={{ width: 140, fontSize: 16, letterSpacing: '0.15em' }} value={code} maxLength={4}
          onChange={(e) => { setTouched(true); setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) }} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- new hierarchy

function HierarchyDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [touched, setTouched] = useState(false)
  const [multi, setMulti] = useState(true)
  const [levels, setLevels] = useState('')
  const [hasPosition, setHasPosition] = useState(false)
  useEffect(() => { if (!touched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }, [name, touched])
  const submit = async (): Promise<void> => {
    if (!name.trim() || !key) return
    const r = await act('createHierarchy', { key, name: name.trim(), multi, levels: levels.split(',').map((x) => x.trim()).filter(Boolean), hasPosition })
    if (r?.ok) close()
  }
  return (
    <Dialog title="New hierarchy" onClose={close} sub="For example Species, Story, Technique, Habitat or Event."
      foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!name.trim() || !key} onClick={() => void submit()}>Create</button></>}>
      <div className="row">
        <div className="grow"><div className="label">Name</div><input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ width: 170 }}><div className="label">Key (permanent)</div><input className="field mono" value={key} onChange={(e) => { setTouched(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }} /></div>
      </div>
      <div>
        <div className="label">Entries per photo</div>
        <div className="seg"><button className={!multi ? 'on' : ''} onClick={() => setMulti(false)}>One</button><button className={multi ? 'on' : ''} onClick={() => setMulti(true)}>Many</button></div>
      </div>
      <div><div className="label">Level names (optional, comma separated)</div><input className="field" value={levels} placeholder="e.g. Story, Chapter" onChange={(e) => setLevels(e.target.value)} /></div>
      <label className="check"><input type="checkbox" checked={hasPosition} onChange={(e) => setHasPosition(e.target.checked)} />Entries carry a map position</label>
    </Dialog>
  )
}

// ---------------------------------------------------------------- paste fields

const PASTE_FIELDS: [EditableField, string][] = [
  ['title', 'Title'], ['caption', 'Caption'], ['note', 'Note'], ['alt', 'Alt text'], ['rating', 'Rating'],
  ['creator', 'Creator'], ['copyright', 'Copyright'], ['licence', 'Licence'], ['credit', 'Credit line'],
  ['lat', 'Position'], ['elevation', 'Elevation'], ['precision', 'Publishing precision'], ['showElevation', 'Publish elevation'],
  ['noLocation', 'No location'], ['people', 'Shows people'], ['privatePlace', 'Private place']
]

function PasteDialog({ close }: { close: () => void }) {
  const allH = useStore((s) => s.hierarchies)
  const hs = useMemo(() => allH.filter((h) => !h.archived), [allH])
  const prev = useStore((s) => s.ui.pasteSpec)
  const src = useStore((s) => (s.clipboard ? s.byId.get(s.clipboard) : undefined))
  const n = useStore((s) => s.selected.size)
  const [fields, setFields] = useState<Set<EditableField>>(new Set(prev?.fields ?? ['title', 'caption', 'alt']))
  const [hier, setHier] = useState<Record<number, 'off' | 'add' | 'replace'>>(() => Object.fromEntries(hs.map((h) => [h.id, prev?.hierarchies.find((x) => x.id === h.id)?.mode ?? 'off'])))
  const [shoot, setShoot] = useState(prev?.shoot ?? false)
  const toggle = (f: EditableField): void => { const s = new Set(fields); if (s.has(f)) s.delete(f); else s.add(f); setFields(s) }
  const go = async (): Promise<void> => {
    const fl = [...fields]
    if (fl.includes('lat')) fl.push('lon')
    const spec: PasteSpec = { fields: fl, hierarchies: Object.entries(hier).filter(([, m]) => m !== 'off').map(([id, m]) => ({ id: Number(id), mode: m as 'add' | 'replace' })), shoot }
    useStore.getState().setUi({ pasteSpec: spec })
    await act('paste', src!.id, [...useStore.getState().selected], spec)
    close()
  }
  if (!src) return null
  return (
    <Dialog title="Paste fields" onClose={close} sub={<>From <span className="mono">{src.legendId ?? src.rawKey}</span> to {n} selected photo{n === 1 ? '' : 's'}. Your choice is remembered for “Paste again”.</>}
      foot={<>
        <div className="left row">
          <button className="btn small ghost" onClick={() => setFields(new Set(PASTE_FIELDS.map((f) => f[0])))}>All fields</button>
          <button className="btn small ghost" onClick={() => setFields(new Set())}>None</button>
        </div>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={() => void go()}>Paste</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        {PASTE_FIELDS.map(([f, l]) => <label key={f} className="check"><input type="checkbox" checked={fields.has(f)} onChange={() => toggle(f)} />{l}</label>)}
        <label className="check"><input type="checkbox" checked={shoot} onChange={(e) => setShoot(e.target.checked)} />Shoot and subgroup</label>
      </div>
      <div>
        <div className="label">Hierarchies</div>
        {hs.map((h) => (
          <div key={h.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>{h.name}</span>
            <div className="seg">
              {(['off', 'add', 'replace'] as const).map((m) => <button key={m} className={hier[h.id] === m ? 'on' : ''} onClick={() => setHier({ ...hier, [h.id]: m })}>{{ off: "Don't paste", add: 'Add', replace: 'Replace' }[m]}</button>)}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- settings

function SettingsDialog({ close }: { close: () => void }) {
  const settings = useStore((s) => s.settings)!
  const hierarchies = useStore((s) => s.hierarchies)
  const library = useStore((s) => s.library)!
  const version = useStore((s) => s.version)
  const focus = useStore((s) => (s.focusId ? s.byId.get(s.focusId) : s.photos[0]))
  const shoots = useStore((s) => s.shoots)
  const [s, setS] = useState<Settings>(structuredClone(settings))
  const [tab, setTab] = useState('defaults')
  const roots = Object.entries(s.keywordRoots)
  const up = (p: Partial<Settings>): void => setS({ ...s, ...p })

  const example = useMemo(() => {
    const p = focus ?? null
    if (!p) return ''
    const sh = shoots.find((x) => x.id === p.shootId) ?? { id: 0, code: 'MALM', name: 'Maracas Lime', description: '', coverPhotoId: null, timeZone: '', clockOffsetMin: 0, archived: false, nextNumber: 1 }
    return publishedName(s.nameTemplate, { ...p, legendId: p.legendId ?? `${sh.code}-00001` }, sh, null)
  }, [s.nameTemplate, focus, shoots])

  const keyExample = useMemo(() => {
    const sample = '20121227-GZ3A6486-Edit'
    if (!s.rawKeyPattern) return sample
    try { const m = sample.match(new RegExp(s.rawKeyPattern)); return m ? (m[1] ?? m[0]) : `${sample} (no match: file name used)` } catch { return 'invalid pattern' }
  }, [s.rawKeyPattern])

  const save = async (): Promise<void> => {
    const r = await act('saveSettings', s)
    if (r?.ok) close()
  }
  const tabs = [['defaults', 'Defaults'], ['import', 'Import'], ['names', 'Names'], ['map', 'Map'], ['library', 'Library']]
  return (
    <Dialog title="Settings" wide onClose={close}
      foot={<><span className="left muted" style={{ fontSize: 12 }}>Legend {version} · these settings are stored in the library</span><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save</button></>}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'defaults' && (
        <>
          <div className="muted" style={{ fontSize: 12 }}>Filled in on new photos when the embedded metadata has none.</div>
          <div className="row"><div className="grow"><div className="label">Creator</div><input className="field" value={s.creator} onChange={(e) => up({ creator: e.target.value })} /></div>
            <div className="grow"><div className="label">Copyright</div><input className="field" value={s.copyright} placeholder="© Your Name" onChange={(e) => up({ copyright: e.target.value })} /></div></div>
          <div className="row"><div className="grow"><div className="label">Licence</div><input className="field" value={s.licence} onChange={(e) => up({ licence: e.target.value })} /></div>
            <div className="grow"><div className="label">Credit line</div><input className="field" value={s.credit} onChange={(e) => up({ credit: e.target.value })} /></div></div>
          <div style={{ width: 200 }}><div className="label">Default time zone for new shoots</div><input className="field mono" value={s.defaultTimeZone} onChange={(e) => up({ defaultTimeZone: e.target.value })} /></div>
        </>
      )}
      {tab === 'import' && (
        <>
          <div>
            <div className="label">Raw key pattern <span className="hint">optional regular expression; the first group is the raw key</span></div>
            <input className="field mono" value={s.rawKeyPattern} placeholder="e.g. ^(.*?)(?:-Edit)?$" onChange={(e) => up({ rawKeyPattern: e.target.value })} />
            <div className="muted mono" style={{ fontSize: 11.5, marginTop: 5 }}>20121227-GZ3A6486-Edit.jpg → {keyExample}</div>
          </div>
          <div>
            <div className="label">Lightroom keyword roots <span className="hint">top-level keyword → hierarchy</span></div>
            {roots.map(([k, v], i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input className="field" value={k} onChange={(e) => { const r = [...roots]; r[i] = [e.target.value, v]; up({ keywordRoots: Object.fromEntries(r) }) }} />
                <Icon name="right" size={14} />
                <select className="select" value={hierarchies.some((h) => h.key === v) ? v : '__new'} onChange={(e) => { const r = [...roots]; r[i] = [k, e.target.value === '__new' ? v : e.target.value]; up({ keywordRoots: Object.fromEntries(r) }) }}>
                  {hierarchies.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
                  {!hierarchies.some((h) => h.key === v) && <option value="__new">{v} (created on import)</option>}
                </select>
                <button className="iconbtn" onClick={() => up({ keywordRoots: Object.fromEntries(roots.filter((_, j) => j !== i)) })}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button className="btn small ghost" onClick={() => up({ keywordRoots: { ...s.keywordRoots, '': 'keywords' } })}><Icon name="plus" size={13} />Add mapping</button>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Keywords under other roots go to Keywords with their full path. Flat keywords not in any path go to Keywords › Unsorted.</div>
          </div>
          <label className="check"><input type="checkbox" checked={s.seedLocationFromIptc} onChange={(e) => up({ seedLocationFromIptc: e.target.checked })} />Fill the Location hierarchy from Lightroom's Country, State, City and Location fields</label>
        </>
      )}
      {tab === 'names' && (
        <>
          <div>
            <div className="label">Published name template</div>
            <input className="field mono" value={s.nameTemplate} onChange={(e) => up({ nameTemplate: e.target.value })} />
            <div className="chips" style={{ marginTop: 8 }}>
              {TEMPLATE_SEGMENTS.map((t) => <button key={t.token} className="chip" style={{ border: 0, paddingRight: 9 }} onClick={() => up({ nameTemplate: s.nameTemplate + (s.nameTemplate && !s.nameTemplate.endsWith('-') ? '-' : '') + t.token })}>{t.label}</button>)}
            </div>
          </div>
          <div className="hsec"><div className="label">Example</div><div className="mono">{example || '—'}</div></div>
          <div className="muted" style={{ fontSize: 12 }}>A published name is frozen when a photo is first exported. Until then, changing the template updates the names of named photos.</div>
        </>
      )}
      {tab === 'map' && (
        <>
          {(['street', 'satellite'] as const).map((k) => (
            <div key={k} className="hsec col" style={{ gap: 8 }}>
              <div className="hname" style={{ marginBottom: 0 }}>{k === 'street' ? 'Street map' : 'Satellite'}</div>
              <input className="field mono" value={s.tiles[k].url} onChange={(e) => up({ tiles: { ...s.tiles, [k]: { ...s.tiles[k], url: e.target.value } } })} />
              <input className="field" value={s.tiles[k].attribution} placeholder="Attribution" onChange={(e) => up({ tiles: { ...s.tiles, [k]: { ...s.tiles[k], attribution: e.target.value } } })} />
            </div>
          ))}
          <div className="row">
            <div className="grow"><div className="label">Default centre (lat, lon)</div><input className="field mono" value={`${s.mapCenter.lat}, ${s.mapCenter.lon}`} onChange={(e) => { const m = e.target.value.split(',').map((x) => Number(x.trim())); if (m.length === 2 && m.every(Number.isFinite)) up({ mapCenter: { ...s.mapCenter, lat: m[0], lon: m[1] } }) }} /></div>
            <div style={{ width: 120 }}><div className="label">Zoom</div><input className="field" type="number" value={s.mapCenter.zoom} onChange={(e) => up({ mapCenter: { ...s.mapCenter, zoom: Number(e.target.value) } })} /></div>
            <div style={{ width: 170 }}><div className="label">Suggest within (m)</div><input className="field" type="number" value={s.suggestDistanceM} onChange={(e) => up({ suggestDistanceM: Number(e.target.value) })} /></div>
          </div>
        </>
      )}
      {tab === 'library' && (
        <>
          <div className="kv"><div>Library</div><div className="mono">{library.path}</div></div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => { const p = await call<string | null>('exportBackup'); if (p) useStore.getState().toast(`Backup written to ${p}`) }}><Icon name="save" size={14} />Export library backup (JSON)…</button>
            <button className="btn ghost" onClick={async () => { close(); try { if (await call('openLibrary')) await loadLibrary() } catch (e) { useStore.getState().toast((e as Error).message, 'error') } }}><Icon name="folder" size={14} />Open another library…</button>
            <button className="btn ghost" onClick={async () => { close(); try { if (await call('createLibrary')) await loadLibrary() } catch (e) { useStore.getState().toast((e as Error).message, 'error') } }}><Icon name="plus" size={14} />New library…</button>
            <button className="btn ghost" onClick={async () => { if (await confirm('Close this library?', 'Everything is already saved.', 'Close library')) { close(); await call('closeLibrary'); await loadLibrary() } }}>Close library</button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Every change is saved the moment you make it. The library keeps a daily backup, a backup before any upgrade, and one before any change to more than 500 photos (last 30 are kept in its backups folder).</div>
        </>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsDialog({ close }: { close: () => void }) {
  const rows: [string, string][] = [
    ['G / T / E', 'Grid, table, single view (Space toggles single)'],
    ['Arrow keys', 'Move; Shift extends the selection'],
    ['Click, Shift-click, Ctrl-click', 'Select, select a range, add or remove'],
    ['Ctrl+A / Ctrl+D', 'Select all shown / select none'],
    ['0 – 5', 'Set the rating'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy fields / paste fields'],
    ['Ctrl+Alt+V', 'Paste again with the last choices'],
    ['Ctrl+N', 'New shoot from selection'],
    ['Ctrl+G', 'New subgroup from selection'],
    ['Ctrl+I', 'Import a folder'],
    ['Ctrl+F', 'Search'],
    ['F', 'Show or hide filter columns'],
    ['Tab', 'Hide or show side panels'],
    ['Enter', 'Open the focused photo in single view'],
    ['Esc', 'Back to grid / clear selection'],
    ['Ctrl+Enter', 'Save a multi-line text field'],
    ['Drag photos', 'Onto a shoot, subgroup, set or hierarchy entry to assign']
  ]
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="kv" style={{ gridTemplateColumns: '210px 1fr', fontSize: 12.5 }}>
        {rows.flatMap(([k, v]) => [<div key={k}><span className="kbd">{k}</span></div>, <div key={k + 'v'}>{v}</div>])}
      </div>
    </Dialog>
  )
}
