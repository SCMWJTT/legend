import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '../src/main/db/library'
import { runImport } from '../src/main/services/importer'
import { endExifTool } from '../src/main/services/exif'
import * as C from '../src/main/services/catalog'
import { freshDir, makeJpeg } from './helpers'

let lib: Library
let photos: string
let libDir: string

const mtimes = (dir: string) =>
  Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]))

beforeAll(async () => {
  photos = freshDir('photos')
  libDir = path.join(freshDir('lib'), 'Test.legendlib')
  await makeJpeg(path.join(photos, '20121227-GZ3A6486.jpg'), {
    Title: 'Tyrico at last light',
    Headline: 'The bay empties as the light goes.',
    Description: 'First paragraph.\n\nSecond paragraph.',
    Rating: 4,
    HierarchicalSubject: ['Gallery', 'Gallery|Landscapes', 'Gallery|Landscapes|Coast', 'Stories|Maracas', 'Fieldcraft|Dusk'],
    Subject: ['Landscapes', 'Coast', 'Maracas', 'Dusk', 'sunset'],
    GPSLatitude: 10.75412,
    GPSLongitude: -61.43087,
    DateTimeOriginal: '2012:12:27 17:48:00',
    Country: 'Trinidad and Tobago',
    State: 'Trinidad',
    City: 'Maracas'
  })
  for (let i = 0; i < 4; i++) {
    await makeJpeg(path.join(photos, `20121227-GZ3A65${10 + i}.jpg`), {
      Title: `Photo ${i}`,
      DateTimeOriginal: `2012:12:27 1${i}:00:00`,
      HierarchicalSubject: ['Gallery|Birds'],
      Subject: ['Birds']
    }, { r: 20 * i, g: 60, b: 80 })
  }
  fs.writeFileSync(path.join(photos, 'notes.txt'), 'not an image')
  lib = Library.create(libDir)
  C.ensureDefaultHierarchies(lib)
})

afterAll(async () => {
  lib?.close()
  await endExifTool()
})

describe('import', () => {
  it('imports new photos and seeds fields from embedded metadata', async () => {
    const before = mtimes(photos)
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.added.length).toBe(5)
    expect(r.report.skipped.length).toBe(1)
    const all = C.readPhotos(lib)
    const p = all.find((x) => x.rawKey === '20121227-GZ3A6486')!
    expect(p.title).toBe('Tyrico at last light')
    expect(p.caption).toBe('The bay empties as the light goes.')
    expect(p.note).toContain('Second paragraph')
    expect(p.rating).toBe(4)
    expect(p.lat).toBeCloseTo(10.75412, 4)
    expect(p.lon).toBeCloseTo(-61.43087, 4)
    expect(p.captured).toBe('2012-12-27T17:48:00')
    const nodes = C.readNodes(lib)
    const labels = p.nodes.map((id) => nodes.find((n) => n.id === id)!.label).sort()
    expect(labels).toEqual(['Coast', 'Dusk', 'Maracas', 'Maracas', 'sunset'].sort())
    const hs = C.readHierarchies(lib).map((h) => h.key)
    expect(hs).toContain('story')
    expect(hs).toContain('technique')
    expect(mtimes(photos)).toEqual(before)
  })

  it('re-importing the same folder changes nothing', async () => {
    const strip = () => JSON.stringify(C.readPhotos(lib).map((p) => ({ ...p, modifiedAt: '', sets: [] })))
    const snap = strip()
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.known.length).toBe(5)
    expect(r.report.added.length + r.report.changed.length).toBe(0)
    expect(strip()).toBe(snap)
  })

  it('a re-exported file keeps its catalogue fields', async () => {
    const id = C.readPhotos(lib).find((x) => x.rawKey === '20121227-GZ3A6510')!.id
    lib.action('t', (tx) => C.applyEdits(tx, [id], [{ field: 'title', value: 'Kept title' }]))
    await makeJpeg(path.join(photos, '20121227-GZ3A6510.jpg'), { Title: 'New LR title' }, { r: 200, g: 10, b: 10 })
    const r = await runImport(lib, { folder: photos, recursive: false })
    if ('needsChoice' in r) throw new Error('unexpected choice')
    expect(r.report.changed.length).toBe(1)
    const p = C.readPhotos(lib, [id])[0]
    expect(p.title).toBe('Kept title')
    expect(p.thumbVer).toBeLessThanOrEqual(0)
  })

  it('asks before treating two files with one raw key as variants', async () => {
    const dir = freshDir('variants')
    await makeJpeg(path.join(dir, 'IMG_1.jpg'), { Title: 'colour' })
    await makeJpeg(path.join(dir, 'IMG_1-Edit.jpg'), { Title: 'mono' }, { r: 128, g: 128, b: 128 })
    lib.saveSettings({ rawKeyPattern: '^(.*?)(?:-Edit)?$' })
    const r1 = await runImport(lib, { folder: dir, recursive: false })
    expect('needsChoice' in r1).toBe(true)
    const r2 = await runImport(lib, { folder: dir, recursive: false, choices: { img_1: 'variant', IMG_1: 'variant' } })
    if ('needsChoice' in r2) throw new Error('unexpected choice')
    const v = C.readPhotos(lib).filter((p) => p.rawKey === 'IMG_1')
    expect(v.map((p) => p.variantNo).sort()).toEqual([0, 1])
    const r3 = await runImport(lib, { folder: dir, recursive: false })
    if ('needsChoice' in r3) throw new Error('unexpected choice on re-import')
    expect(r3.report.known.length).toBe(2)
    lib.saveSettings({ rawKeyPattern: '' })
  })
})

describe('editing and undo', () => {
  it('a bulk edit is one undo step and leaves untouched fields alone', () => {
    const all = C.readPhotos(lib)
    const ids = all.map((p) => p.id)
    const titles = Object.fromEntries(all.map((p) => [p.id, p.title]))
    lib.action('Caption', (tx) => C.applyEdits(tx, ids, [{ field: 'caption', value: 'Shared caption' }]))
    const after = C.readPhotos(lib)
    expect(after.every((p) => p.caption === 'Shared caption')).toBe(true)
    expect(after.every((p) => p.title === titles[p.id])).toBe(true)
    lib.undo()
    expect(C.readPhotos(lib).some((p) => p.caption === 'Shared caption')).toBe(false)
    lib.redo()
    expect(C.readPhotos(lib).every((p) => p.caption === 'Shared caption')).toBe(true)
    expect(C.photoHistory(lib, ids[0]).some((h) => h.field === 'caption')).toBe(true)
  })
})

describe('hierarchies', () => {
  it('rename, move and merge keep photo entries', () => {
    const kw = C.readHierarchies(lib).find((h) => h.key === 'keywords')!
    const birds = C.readNodes(lib).find((n) => n.label === 'Birds')!
    const users = C.readPhotos(lib).filter((p) => p.nodes.includes(birds.id)).map((p) => p.id)
    expect(users.length).toBe(4)
    let wildlife = 0
    const out = lib.action('n', (tx) => {
      C.updateNode(tx, birds.id, { label: 'Birds of Trinidad' })
      wildlife = C.createNode(tx, lib, kw.id, null, 'Wildlife')
      C.moveNode(tx, lib, birds.id, wildlife)
    })
    C.deltaFor(lib, out)
    expect(C.readPhotos(lib).filter((p) => p.nodes.includes(birds.id)).length).toBe(4)
    const closure = lib.db.prepare('SELECT 1 FROM node_closure WHERE ancestor = ? AND descendant = ?').get(wildlife, birds.id)
    expect(closure).toBeTruthy()
    let avian = 0
    lib.action('m', (tx) => {
      avian = C.createNode(tx, lib, kw.id, wildlife, 'Avian')
      C.mergeNodes(tx, lib, birds.id, avian)
    })
    expect(C.readPhotos(lib).filter((p) => p.nodes.includes(avian)).length).toBe(4)
    expect(() => lib.action('d', (tx) => C.deleteNode(tx, lib, avian))).toThrow()
  })
})

describe('shoots and names', () => {
  it('never issues a code or ID twice', () => {
    const ids = C.readPhotos(lib).filter((p) => p.rawKey.startsWith('2012')).map((p) => p.id)
    let shootId = 0
    lib.action('s', (tx) => {
      shootId = C.createShoot(tx, lib, 'Maracas Lime', 'MALM', ids)
    })
    expect(() => lib.action('s2', (tx) => C.createShoot(tx, lib, 'Other', 'MALM', []))).toThrow()
    lib.action('n', (tx) => C.assignNames(tx, lib, ids))
    const named = C.readPhotos(lib, ids).map((p) => p.legendId).sort()
    expect(named[0]).toBe('MALM-00001')
    const first = C.readPhotos(lib, ids).find((p) => p.legendId === 'MALM-00001')!
    expect(first.publishedName).toMatch(/^2012-12-27-maracas-lime-MALM-00001$/)
    // Withdraw then rename: the old number is not reused.
    lib.action('w', (tx) => C.withdrawNames(tx, lib, [first.id]))
    lib.action('n2', (tx) => C.assignNames(tx, lib, [first.id]))
    const again = C.readPhotos(lib, [first.id])[0]
    expect(again.legendId).not.toBe('MALM-00001')
    const reg = C.readRegistry(lib)
    expect(reg.ids.find((r) => r.legendId === 'MALM-00001')!.state).toBe('retired')
    // Undoing a shoot creation keeps its code reserved.
    lib.action('s3', (tx) => C.createShoot(tx, lib, 'Temp', 'TEMP', []))
    lib.undo()
    expect(C.codeIsFree(lib, 'TEMP')).toBe(false)
    expect(shootId).toBeGreaterThan(0)
  })
})

describe('library safety', () => {
  it('re-opens with all data and refuses a second opener', () => {
    const n = C.readPhotos(lib).length
    lib.close()
    lib = Library.open(libDir)
    expect(C.readPhotos(lib).length).toBe(n)
    expect(fs.readdirSync(path.join(libDir, 'backups')).length).toBeGreaterThan(0)
  })
})
