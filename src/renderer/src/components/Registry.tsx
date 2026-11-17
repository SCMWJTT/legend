import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useStore, EMPTY_FILTERS } from '../store'
import { Icon } from './Icon'

interface Reg {
  codes: { code: string; name: string; archived: boolean; issued: number }[]
  ids: { legendId: string; shootCode: string; number: number; rawKey: string; state: string; issuedAt: string; publishedName: string | null }[]
}

function csv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n')
}

function download(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Registry() {
  const [reg, setReg] = useState<Reg | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'legendId', d: 1 })
  const rev = useStore((s) => s.shoots)
  const photos = useStore((s) => s.photos)
  useEffect(() => { void call<Reg>('registry').then(setReg) }, [rev, photos])

  const ids = useMemo(() => {
    if (!reg) return []
    const query = q.trim().toLowerCase()
    const list = reg.ids.filter((r) => !query || [r.legendId, r.rawKey, r.publishedName ?? ''].some((s) => s.toLowerCase().includes(query)))
    const key = sort.k as keyof Reg['ids'][number]
    return list.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * sort.d)
  }, [reg, q, sort])
  const codes = useMemo(() => (reg?.codes ?? []).filter((c) => !q.trim() || c.code.toLowerCase().includes(q.trim().toLowerCase()) || c.name.toLowerCase().includes(q.trim().toLowerCase())), [reg, q])

  if (!reg) return null
  const th = (k: string, l: string) => <th onClick={() => setSort({ k, d: sort.k === k ? (sort.d === 1 ? -1 : 1) : 1 })}>{l}{sort.k === k ? (sort.d === 1 ? ' ↑' : ' ↓') : ''}</th>
  const byRaw = new Map(photos.map((p) => [p.legendId, p]))
  return (
    <div className="explorer" style={{ gridTemplateColumns: '360px 1fr' }}>
      <section>
        <div className="ex-head"><h3>Shoot codes</h3><span className="muted">{reg.codes.length}</span></div>
        <div className="reg">
          <table>
            <thead><tr><th>Code</th><th>Shoot</th><th style={{ textAlign: 'right' }}>IDs</th></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{c.code}</td>
                  <td>{c.name}{c.archived && <span className="tag" style={{ marginLeft: 6 }}>archived</span>}</td>
                  <td style={{ textAlign: 'right' }}>{c.issued}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!codes.length && <div className="empty">No shoot codes yet.</div>}
        </div>
      </section>
      <section>
        <div className="ex-head">
          <h3>Legend IDs</h3>
          <span className="muted">{reg.ids.length} issued · {reg.ids.filter((r) => r.state === 'retired').length} retired</span>
          <div className="search" style={{ width: 280, maxWidth: 'none' }}>
            <Icon name="search" size={15} />
            <input className="field" placeholder="Find by ID, raw key or published name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn small" onClick={() => download('legend-ids.csv', csv([['Legend ID', 'Shoot code', 'Number', 'Raw key', 'Published name', 'State', 'Issued'], ...reg.ids.map((r) => [r.legendId, r.shootCode, r.number, r.rawKey, r.publishedName, r.state, r.issuedAt])]))}>
            <Icon name="save" size={13} />CSV
          </button>
        </div>
        <div className="reg">
          <table>
            <thead><tr>{th('legendId', 'Legend ID')}{th('rawKey', 'Raw key')}{th('publishedName', 'Published name')}{th('state', 'State')}{th('issuedAt', 'Issued')}</tr></thead>
            <tbody>
              {ids.slice(0, 3000).map((r) => {
                const p = byRaw.get(r.legendId)
                return (
                  <tr key={r.legendId} style={{ cursor: p ? 'pointer' : 'default' }} onDoubleClick={() => {
                    if (!p) return
                    const s = useStore.getState()
                    s.setSource({ kind: 'all' })
                    s.set({ filters: { ...EMPTY_FILTERS, text: r.legendId } })
                    s.select([p.id], p.id)
                  }}>
                    <td className={'mono' + (r.state === 'retired' ? ' retired' : '')}>{r.legendId}</td>
                    <td className="mono">{r.rawKey}</td>
                    <td className="mono">{r.publishedName ?? '—'}</td>
                    <td><span className={'tag ' + (r.state === 'active' ? 'ok' : 'warn')}>{r.state}</span></td>
                    <td>{new Date(r.issuedAt).toLocaleDateString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!ids.length && <div className="empty">{reg.ids.length ? 'Nothing matches.' : 'No IDs issued yet. Put photos in a shoot and use Assign names.'}</div>}
        </div>
      </section>
    </div>
  )
}
