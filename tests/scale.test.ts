// Speed targets from the specification, measured on a generated library of 100,000 photos.
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library, nowIso } from '../src/main/db/library'
import * as C from '../src/main/services/catalog'
import { filterPhotos, sortPhotos, groupPhotos, type Ctx } from '../src/renderer/src/logic'
import { EMPTY_FILTERS } from '../src/renderer/src/store'
import { freshDir } from './helpers'

const N = 100_000
let lib: Library
let dir: string

beforeAll(() => {
  dir = path.join(freshDir('scale'), 'Scale.legendlib')
  lib = Library.create(dir)
  C.ensureDefaultHierarchies(lib)
  const kw = C.readHierarchies(lib).find((h) => h.key === 'keywords')!
  const nodeIds: number[] = []
  lib.action('nodes', (tx) => {
    for (let a = 0; a < 10; a++) {
      const top = C.createNode(tx, lib, kw.id, null, `Topic ${a}`)
      for (let b = 0; b < 20; b++) nodeIds.push(C.createNode(tx, lib, kw.id, top, `Sub ${a}.${b}`))
    }
  })
  C.rebuildClosure(lib)
  const t = nowIso()
  const ins = lib.db.prepare(
    `INSERT INTO photos (raw_key, title, caption, rating, captured, file_path, imported_at, modified_at, lat, lon) VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  const link = lib.db.prepare('INSERT INTO photo_nodes (photo_id, node_id) VALUES (?, ?)')
  lib.db.transaction(() => {
    for (let i = 0; i < N; i++) {
      const info = ins.run(`IMG_${i}`, i % 3 ? `Title ${i}` : '', `Caption ${i}`, i % 6, `2013-0${1 + (i % 9)}-1${i % 10}T1${i % 10}:00:00`, `/x/IMG_${i}.jpg`, t, t, 10 + (i % 100) / 1000, -61 - (i % 100) / 1000)
      const id = Number(info.lastInsertRowid)
      link.run(id, nodeIds[i % nodeIds.length])
      if (i % 4 === 0 && (i * 7) % nodeIds.length !== i % nodeIds.length) link.run(id, nodeIds[(i * 7) % nodeIds.length])
    }
  })()
  lib.close()
}, 300000)

afterAll(() => lib?.close())

describe('100,000 photos', () => {
  let ctx: Ctx
  it('opens and loads every photo in under 3 seconds', () => {
    const t0 = performance.now()
    lib = Library.open(dir)
    const snap = C.snapshot(lib)
    const ms = performance.now() - t0
    console.log(`open + load: ${ms.toFixed(0)} ms`)
    expect(snap.photos.length).toBe(N)
    expect(ms).toBeLessThan(3000)
    ctx = {
      nodeById: new Map(snap.nodes.map((n) => [n.id, n])),
      children: new Map(),
      hierarchies: snap.hierarchies,
      hByKey: new Map(snap.hierarchies.map((h) => [h.key, h])),
      shoots: new Map(),
      subgroups: new Map()
    }
    for (const n of snap.nodes) {
      const k = `${n.hierarchyId}:${n.parentId ?? 0}`
      ctx.children.set(k, [...(ctx.children.get(k) ?? []), n])
    }
    ;(globalThis as Record<string, unknown>).__photos = snap.photos
  })

  it('filters, sorts and groups in under half a second', () => {
    const photos = (globalThis as Record<string, unknown>).__photos as ReturnType<typeof C.readPhotos>
    const top = [...ctx.nodeById.values()].find((n) => n.label === 'Topic 3')!
    const t0 = performance.now()
    const f1 = filterPhotos(photos, { kind: 'node', id: top.id }, { ...EMPTY_FILTERS, minRating: 2 }, ctx)
    const t1 = performance.now()
    const f2 = filterPhotos(photos, { kind: 'all' }, { ...EMPTY_FILTERS, text: 'title 99' }, ctx)
    const t2 = performance.now()
    const s = sortPhotos(photos, 'title', 1, ctx)
    const t3 = performance.now()
    const g = groupPhotos(s, 'month', ctx)
    const t4 = performance.now()
    console.log(`node filter ${(t1 - t0).toFixed(0)} ms, text search ${(t2 - t1).toFixed(0)} ms, sort ${(t3 - t2).toFixed(0)} ms, group ${(t4 - t3).toFixed(0)} ms`)
    expect(f1.length).toBeGreaterThan(0)
    expect(f2.length).toBeGreaterThan(0)
    expect(g.length).toBe(9)
    for (const ms of [t1 - t0, t2 - t1, t3 - t2, t4 - t3]) expect(ms).toBeLessThan(500)
  })

  it('bulk-edits 5,000 photos in under 2 seconds as one undo step', () => {
    const ids = Array.from({ length: 5000 }, (_, i) => i + 1)
    lib.saveSettings({}) // no-op
    const t0 = performance.now()
    const out = lib.action('Caption', (tx) => C.applyEdits(tx, ids, [{ field: 'caption', value: 'Shared' }]), { bulkCount: ids.length })
    const d = C.deltaFor(lib, out)
    const ms = performance.now() - t0
    console.log(`bulk edit 5000: ${ms.toFixed(0)} ms (includes the backup taken before a bulk action)`)
    expect(d.photos!.length).toBe(5000)
    expect(ms).toBeLessThan(2000)
    lib.undo()
    expect(C.readPhotos(lib, [1])[0].caption).toBe('Caption 0')
  })
})
