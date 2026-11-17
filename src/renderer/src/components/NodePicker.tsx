import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { HNode, Hierarchy } from '@shared/types'
import { useCtx, kidsOf, pathLabel } from '../logic'
import { Icon } from './Icon'

interface PickerReq {
  hierarchy: Hierarchy
  anchor: DOMRect
  onPick: (nodeId: number) => void
  onCreate: (labels: string[]) => void
}

const usePicker = create<{ req: PickerReq | null }>(() => ({ req: null }))
const RECENT_KEY = 'legend.recentNodes'

export function openPicker(el: HTMLElement, hierarchy: Hierarchy, onPick: (id: number) => void, onCreate: (labels: string[]) => void): void {
  usePicker.setState({ req: { hierarchy, anchor: el.getBoundingClientRect(), onPick, onCreate } })
}

function recentFor(hid: number): number[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}')[hid] ?? []) as number[]
  } catch {
    return []
  }
}
function pushRecent(hid: number, id: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}')
    all[hid] = [id, ...((all[hid] ?? []) as number[]).filter((x) => x !== id)].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

type Opt = { kind: 'node'; n: HNode; depth?: number } | { kind: 'new'; labels: string[] }

export function PickerHost() {
  const req = usePicker((s) => s.req)
  if (!req) return null
  return <Picker req={req} close={() => usePicker.setState({ req: null })} />
}

function Picker({ req, close }: { req: PickerReq; close: () => void }) {
  const ctx = useCtx()
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: req.anchor.left, top: req.anchor.bottom + 6 })
  const h = req.hierarchy

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = Math.min(req.anchor.left, window.innerWidth - r.width - 10)
    let top = req.anchor.bottom + 6
    if (top + r.height > window.innerHeight - 10) top = Math.max(10, req.anchor.top - r.height - 6)
    left = Math.max(10, left)
    setPos({ left, top })
  }, [req])

  const all = useMemo(() => [...ctx.nodeById.values()].filter((n) => n.hierarchyId === h.id && !n.retired), [ctx, h.id])

  const opts: Opt[] = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) {
      const out: Opt[] = []
      const walk = (parent: number | null, depth: number): void => {
        for (const n of kidsOf(ctx, h.id, parent)) {
          if (n.retired) continue
          out.push({ kind: 'node', n, depth })
          if (open.has(n.id)) walk(n.id, depth + 1)
        }
      }
      walk(null, 0)
      return out
    }
    const parts = q.split(/\s*(?:›|>|\/)\s*/).filter(Boolean)
    const last = parts[parts.length - 1].toLowerCase()
    const scored = all
      .map((n) => {
        const l = n.label.toLowerCase()
        const alts = n.altNames.map((a) => a.toLowerCase())
        let score = -1
        if (l === last) score = 100
        else if (l.startsWith(last)) score = 80
        else if (alts.some((a) => a.startsWith(last))) score = 70
        else if (l.includes(last)) score = 50
        else if (alts.some((a) => a.includes(last))) score = 40
        if (score >= 0 && parts.length > 1) {
          const path = pathLabel(n.id, ctx.nodeById).toLowerCase()
          if (!parts.slice(0, -1).every((p) => path.includes(p.toLowerCase()))) score = -1
        }
        return { n, score }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.n.label.localeCompare(b.n.label))
      .slice(0, 40)
      .map((x): Opt => ({ kind: 'node', n: x.n }))
    const exact = scored.some((o) => o.kind === 'node' && o.n.label.toLowerCase() === last && (parts.length === 1 || pathLabel(o.n.id, ctx.nodeById).toLowerCase().endsWith(parts.map((p) => p.toLowerCase()).join(' › '))))
    if (!exact) scored.push({ kind: 'new', labels: parts })
    return scored
  }, [q, all, ctx, h.id, open])

  useEffect(() => setHl(0), [q])

  const recent = !q.trim() ? recentFor(h.id).map((id) => ctx.nodeById.get(id)).filter((n): n is HNode => !!n && !n.retired) : []

  const choose = (o: Opt): void => {
    if (o.kind === 'node') {
      pushRecent(h.id, o.n.id)
      req.onPick(o.n.id)
    } else req.onCreate(o.labels)
    close()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(opts.length - 1, hl + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(0, hl - 1)) }
    else if (e.key === 'Enter' && opts[hl]) { e.preventDefault(); choose(opts[hl]) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowRight' && !q && opts[hl]?.kind === 'node') { const n = (opts[hl] as { n: HNode }).n; setOpen(new Set([...open, n.id])) }
    else if (e.key === 'ArrowLeft' && !q && opts[hl]?.kind === 'node') { const n = (opts[hl] as { n: HNode }).n; const s = new Set(open); s.delete(n.id); setOpen(s) }
  }

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="picker" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()}>
        <div className="top">
          <input className="field" autoFocus placeholder={`Find or create a ${h.name} entry…  (use > for a path)`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        </div>
        <div className={'list' + (q.trim() ? '' : ' tree')}>
          {recent.length > 0 && (
            <>
              <div className="sec">Recent</div>
              {recent.map((n) => (
                <div key={'r' + n.id} className="opt" style={{ '--d': 0 } as React.CSSProperties} onClick={() => choose({ kind: 'node', n })}>
                  <span className="lab">{n.label}</span>
                  <span className="p">{pathLabel(n.id, ctx.nodeById).split(' › ').slice(0, -1).join(' › ')}</span>
                </div>
              ))}
              <div className="sec">All</div>
            </>
          )}
          {opts.length === 0 && <div className="muted" style={{ padding: 12 }}>No entries yet. Type a name to create one.</div>}
          {opts.map((o, i) =>
            o.kind === 'new' ? (
              <div key="new" className={'opt new' + (i === hl ? ' hl' : '')} onMouseEnter={() => setHl(i)} onClick={() => choose(o)}>
                <Icon name="plus" size={14} />
                Create “{o.labels.join(' › ')}”
              </div>
            ) : (
              <div key={o.n.id} className={'opt' + (i === hl ? ' hl' : '')} style={{ '--d': o.depth ?? 0 } as React.CSSProperties} onMouseEnter={() => setHl(i)} onClick={() => choose(o)}>
                {o.depth !== undefined && (
                  <span style={{ width: 12, display: 'grid', placeItems: 'center', color: 'var(--text4)' }}
                    onClick={(e) => { e.stopPropagation(); const s = new Set(open); if (s.has(o.n.id)) s.delete(o.n.id); else s.add(o.n.id); setOpen(s) }}>
                    {kidsOf(ctx, h.id, o.n.id).length > 0 && <Icon name={open.has(o.n.id) ? 'down' : 'right'} size={10} stroke={2.2} />}
                  </span>
                )}
                <span className="lab">{o.n.label}</span>
                {o.depth === undefined && <span className="p">{pathLabel(o.n.id, ctx.nodeById).split(' › ').slice(0, -1).join(' › ')}</span>}
                {o.n.altNames.length > 0 && o.depth === undefined && <span className="alt">({o.n.altNames.join(', ')})</span>}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
