// Catalogue operations: reading photos, editing, hierarchies, shoots, subgroups, sets, naming.
import type {
  Delta,
  FieldEdit,
  HNode,
  Hierarchy,
  HistoryEntry,
  ImportRecord,
  PasteSpec,
  PhotoRow,
  PhotoSet,
  Settings,
  Shoot,
  Snapshot,
  Subgroup
} from '@shared/types'
import { PHOTO_FIELDS } from '@shared/types'
import { Library, Tx, nowIso, type ActionOutcome } from '../db/library'
import { publishedName } from '@shared/naming'

const b = (v: unknown): boolean => v === 1 || v === true

// ---------------------------------------------------------------- reading

export function mapPhoto(r: Record<string, unknown>, nodes: number[], sets: number[]): PhotoRow {
  return {
    id: r.id as number,
    rawKey: r.raw_key as string,
    variantNo: r.variant_no as number,
    legendId: (r.legend_id as string) ?? null,
    publishedName: (r.published_name as string) ?? null,
    status: r.status as PhotoRow['status'],
    title: r.title as string,
    caption: r.caption as string,
    note: r.note as string,
    alt: r.alt as string,
    rating: r.rating as number,
    creator: r.creator as string,
    copyright: r.copyright as string,
    licence: r.licence as string,
    credit: r.credit as string,
    shootId: (r.shoot_id as number) ?? null,
    subgroupId: (r.subgroup_id as number) ?? null,
    lat: (r.lat as number) ?? null,
    lon: (r.lon as number) ?? null,
    elevation: (r.elevation as number) ?? null,
    camLat: (r.cam_lat as number) ?? null,
    camLon: (r.cam_lon as number) ?? null,
    camEle: (r.cam_ele as number) ?? null,
    posSource: r.pos_source as PhotoRow['posSource'],
    showElevation: b(r.show_elevation),
    precision: r.precision as PhotoRow['precision'],
    noLocation: b(r.no_location),
    people: b(r.people),
    privatePlace: b(r.private_place),
    captured: (r.captured as string) ?? null,
    width: r.width as number,
    height: r.height as number,
    cameraBody: r.camera_body as string,
    lens: r.lens as string,
    focal: (r.focal as number) ?? null,
    aperture: (r.aperture as number) ?? null,
    shutter: r.shutter as string,
    iso: (r.iso as number) ?? null,
    filePath: r.file_path as string,
    fileOffline: b(r.file_offline),
    thumbVer: r.thumb_ver as number,
    importedAt: r.imported_at as string,
    modifiedAt: r.modified_at as string,
    exportedAt: (r.exported_at as string) ?? null,
    nodes,
    sets
  }
}

function groupLinks(lib: Library, sql: string, ids?: number[]): Map<number, number[]> {
  const m = new Map<number, number[]>()
  const rows = (
    ids ? lib.db.prepare(sql + ` AND photo_id IN (${ids.join(',')})`).all() : lib.db.prepare(sql).all()
  ) as { photo_id: number; v: number }[]
  for (const r of rows) {
    let a = m.get(r.photo_id)
    if (!a) m.set(r.photo_id, (a = []))
    a.push(r.v)
  }
  return m
}

export function readPhotos(lib: Library, ids?: number[]): PhotoRow[] {
  if (ids && ids.length === 0) return []
  const out: PhotoRow[] = []
  const chunks: (number[] | undefined)[] = []
  if (ids) for (let i = 0; i < ids.length; i += 5000) chunks.push(ids.slice(i, i + 5000))
  else chunks.push(undefined)
  for (const chunk of chunks) {
    const where = chunk ? `WHERE retired = 0 AND id IN (${chunk.join(',')})` : 'WHERE retired = 0'
    const rows = lib.db.prepare(`SELECT * FROM photos ${where}`).all() as Record<string, unknown>[]
    const nodes = groupLinks(lib, 'SELECT photo_id, node_id AS v FROM photo_nodes WHERE 1=1', chunk)
    const sets = groupLinks(lib, 'SELECT photo_id, set_id AS v FROM set_members WHERE 1=1', chunk)
    for (const r of rows) out.push(mapPhoto(r, nodes.get(r.id as number) ?? [], sets.get(r.id as number) ?? []))
  }
  return out
}

export function readHierarchies(lib: Library): Hierarchy[] {
  return (lib.db.prepare('SELECT * FROM hierarchies ORDER BY sort_order, id').all() as Record<string, unknown>[]).map(
    (r) => ({
      id: r.id as number,
      key: r.key as string,
      name: r.name as string,
      multi: b(r.multi),
      levels: JSON.parse(r.levels as string),
      hasPosition: b(r.has_position),
      required: b(r.required),
      sortOrder: r.sort_order as number,
      archived: b(r.archived),
      alphabetical: b(r.alphabetical)
    })
  )
}

export function readNodes(lib: Library): HNode[] {
  return (lib.db.prepare('SELECT * FROM nodes').all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    hierarchyId: r.hierarchy_id as number,
    parentId: (r.parent_id as number) ?? null,
    publicId: r.public_id as string,
    label: r.label as string,
    altNames: JSON.parse(r.alt_names as string),
    description: r.description as string,
    coverPhotoId: (r.cover_photo_id as number) ?? null,
    sortOrder: r.sort_order as number,
    refs: JSON.parse(r.refs as string),
    lat: (r.lat as number) ?? null,
    lon: (r.lon as number) ?? null,
    zoom: (r.zoom as number) ?? null,
    retired: b(r.retired)
  }))
}

export function readShoots(lib: Library): Shoot[] {
  return (lib.db.prepare('SELECT * FROM shoots WHERE retired = 0 ORDER BY code').all() as Record<string, unknown>[]).map(
    (r) => ({
      id: r.id as number,
      code: r.code as string,
      name: r.name as string,
      description: r.description as string,
      coverPhotoId: (r.cover_photo_id as number) ?? null,
      timeZone: r.time_zone as string,
      clockOffsetMin: r.clock_offset_min as number,
      archived: b(r.archived),
      nextNumber: r.next_number as number
    })
  )
}

export function readSubgroups(lib: Library): Subgroup[] {
  return (
    lib.db.prepare('SELECT * FROM subgroups WHERE retired = 0 ORDER BY shoot_id, sort_order, id').all() as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    id: r.id as number,
    shootId: r.shoot_id as number,
    heading: r.heading as string,
    description: r.description as string,
    coverPhotoId: (r.cover_photo_id as number) ?? null,
    anchorLat: (r.anchor_lat as number) ?? null,
    anchorLon: (r.anchor_lon as number) ?? null,
    anchorSet: b(r.anchor_set),
    featured: JSON.parse(r.featured as string),
    writeup: r.writeup as string,
    sortOrder: r.sort_order as number
  }))
}

export function readSets(lib: Library): PhotoSet[] {
  return (
    lib.db.prepare('SELECT * FROM sets WHERE retired = 0 ORDER BY created_at DESC').all() as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as number,
    name: r.name as string,
    kind: r.kind as PhotoSet['kind'],
    createdAt: r.created_at as string
  }))
}

export function readImports(lib: Library): ImportRecord[] {
  return (lib.db.prepare('SELECT * FROM imports ORDER BY id DESC').all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    at: r.at as string,
    folder: r.folder as string,
    scanned: r.scanned as number,
    added: r.added as number,
    known: r.known as number,
    changed: r.changed as number,
    variants: r.variants as number,
    skipped: r.skipped as number,
    setId: (r.set_id as number) ?? null,
    report: JSON.parse(r.report as string)
  }))
}

export function snapshot(lib: Library): Snapshot {
  return {
    photos: readPhotos(lib),
    hierarchies: readHierarchies(lib),
    nodes: readNodes(lib),
    shoots: readShoots(lib),
    subgroups: readSubgroups(lib),
    sets: readSets(lib),
    imports: readImports(lib),
    settings: lib.getSettings(),
    canUndo: lib.undoLabel(),
    canRedo: lib.redoLabel()
  }
}

/** Build the update the interface needs after an action. */
export function deltaFor(lib: Library, out: Pick<ActionOutcome<unknown>, 'touchedPhotos' | 'touchedTables'>, message?: string): Delta {
  const t = out.touchedTables
  const d: Delta = { canUndo: lib.undoLabel(), canRedo: lib.redoLabel(), message }
  if (t.has('nodes') || t.has('hierarchies')) {
    rebuildClosure(lib)
    d.nodes = readNodes(lib)
    d.hierarchies = readHierarchies(lib)
  }
  if (t.has('shoots') || t.has('id_registry')) d.shoots = readShoots(lib)
  if (t.has('subgroups')) d.subgroups = readSubgroups(lib)
  if (t.has('sets')) d.sets = readSets(lib)
  if (out.touchedPhotos.size) {
    const ids = [...out.touchedPhotos]
    d.photos = readPhotos(lib, ids)
    const live = new Set(d.photos.map((p) => p.id))
    d.removedPhotos = ids.filter((id) => !live.has(id))
  }
  return d
}

// ---------------------------------------------------------------- editing photo fields

export function applyEdits(tx: Tx, ids: number[], edits: FieldEdit[]): number {
  const changed = new Set<number>()
  const lib = tx.lib
  for (const e of edits) {
    const col = PHOTO_FIELDS[e.field]
    if (!col) throw new Error(`Unknown field ${e.field}`)
    for (const id of ids) {
      let v = e.value
      if (e.mode && e.mode !== 'replace' && typeof v === 'string') {
        const cur = (lib.db.prepare(`SELECT ${col} AS v FROM photos WHERE id = ?`).get(id) as { v: string }).v ?? ''
        if (e.mode === 'prepend') v = joinText(v, cur)
        else if (e.mode === 'append') v = joinText(cur, v)
        else if (e.mode === 'findReplace') v = e.find ? cur.split(e.find).join(v) : cur
      }
      if (e.field === 'rating') v = Math.max(0, Math.min(5, Math.round(Number(v) || 0)))
      if (tx.set('photos', id, col, v)) changed.add(id)
      if (e.field === 'privatePlace' && v) tx.set('photos', id, 'precision', 'hidden')
    }
  }
  return changed.size
}

function joinText(a: string, c: string): string {
  if (!a) return c
  if (!c) return a
  return /\s$/.test(a) || /^\s/.test(c) ? a + c : a + ' ' + c
}

export function setPosition(tx: Tx, ids: number[], lat: number | null, lon: number | null): number {
  let n = 0
  for (const id of ids) {
    const a = tx.set('photos', id, 'lat', lat)
    const c = tx.set('photos', id, 'lon', lon)
    tx.set('photos', id, 'pos_source', lat === null ? 'none' : 'hand')
    if (a || c) n++
  }
  return n
}

export function resetToCamera(tx: Tx, lib: Library, ids: number[]): number {
  let n = 0
  for (const id of ids) {
    const r = lib.db.prepare('SELECT cam_lat, cam_lon, cam_ele FROM photos WHERE id = ?').get(id) as {
      cam_lat: number | null
      cam_lon: number | null
      cam_ele: number | null
    }
    const a = tx.set('photos', id, 'lat', r.cam_lat)
    const c = tx.set('photos', id, 'lon', r.cam_lon)
    tx.set('photos', id, 'elevation', r.cam_ele)
    tx.set('photos', id, 'pos_source', r.cam_lat === null ? 'none' : 'camera')
    if (a || c) n++
  }
  return n
}

export function useNodePosition(tx: Tx, lib: Library, ids: number[]): number {
  let n = 0
  for (const id of ids) {
    const r = lib.db
      .prepare(
        `SELECT n.lat, n.lon FROM photo_nodes pn JOIN nodes n ON n.id = pn.node_id
         JOIN hierarchies h ON h.id = n.hierarchy_id
         WHERE pn.photo_id = ? AND h.has_position = 1 AND n.lat IS NOT NULL LIMIT 1`
      )
      .get(id) as { lat: number; lon: number } | undefined
    if (!r) continue
    tx.set('photos', id, 'lat', r.lat)
    tx.set('photos', id, 'lon', r.lon)
    tx.set('photos', id, 'pos_source', 'node')
    n++
  }
  return n
}

export function pasteFields(tx: Tx, lib: Library, sourceId: number, ids: number[], spec: PasteSpec): number {
  const src = readPhotos(lib, [sourceId])[0]
  if (!src) throw new Error('The copied photo no longer exists.')
  const targets = ids.filter((i) => i !== sourceId)
  const before = tx.touchedPhotos.size
  if (spec.fields.length) {
    applyEdits(
      tx,
      targets,
      spec.fields.map((f) => ({ field: f, value: (src as unknown as Record<string, unknown>)[f] }))
    )
  }
  if (spec.fields.includes('lat')) {
    for (const id of targets) tx.set('photos', id, 'pos_source', src.posSource)
  }
  const nodeH = new Map<number, number>()
  for (const n of readNodes(lib)) nodeH.set(n.id, n.hierarchyId)
  for (const h of spec.hierarchies) {
    const srcNodes = src.nodes.filter((n) => nodeH.get(n) === h.id)
    if (h.mode === 'replace') clearHierarchy(tx, lib, targets, h.id)
    for (const n of srcNodes) assignNode(tx, lib, targets, n)
  }
  if (spec.shoot && src.shootId) {
    setShoot(tx, lib, targets, src.shootId)
    if (src.subgroupId) setSubgroup(tx, lib, targets, src.subgroupId)
  }
  return Math.max(tx.touchedPhotos.size - before, 0) || tx.touchedPhotos.size
}

// ---------------------------------------------------------------- hierarchies

const PREFIXES: Record<string, string> = { keywords: 'kw', location: 'loc', activity: 'act' }

export function createHierarchy(
  tx: Tx,
  lib: Library,
  h: { key: string; name: string; multi: boolean; levels?: string[]; hasPosition?: boolean }
): number {
  const key = h.key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!key) throw new Error('A hierarchy needs a key.')
  if (lib.db.prepare('SELECT 1 FROM hierarchies WHERE key = ?').get(key)) throw new Error(`The key "${key}" is already used.`)
  let prefix = PREFIXES[key] ?? key.replace(/-/g, '').slice(0, 4)
  let i = 2
  while (lib.db.prepare('SELECT 1 FROM hierarchies WHERE id_prefix = ?').get(prefix)) prefix = prefix.slice(0, 4) + i++
  const order = (lib.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM hierarchies').get() as { n: number }).n
  return tx.insert('hierarchies', {
    key,
    name: h.name,
    multi: h.multi,
    levels: JSON.stringify(h.levels ?? []),
    has_position: !!h.hasPosition,
    sort_order: order,
    id_prefix: prefix
  })
}

export function ensureDefaultHierarchies(lib: Library): void {
  const n = (lib.db.prepare('SELECT COUNT(*) AS n FROM hierarchies').get() as { n: number }).n
  if (n > 0) return
  lib.action(
    'Create default hierarchies',
    (tx) => {
      createHierarchy(tx, lib, { key: 'keywords', name: 'Keywords', multi: true })
      createHierarchy(tx, lib, {
        key: 'location',
        name: 'Location',
        multi: false,
        levels: ['Country', 'Island or Region', 'Location', 'Sublocation'],
        hasPosition: true
      })
      createHierarchy(tx, lib, { key: 'activity', name: 'Activity', multi: true })
    },
    { undoable: false }
  )
}

export function updateHierarchy(tx: Tx, id: number, patch: Partial<Hierarchy>): void {
  const map: Record<string, string> = {
    name: 'name',
    multi: 'multi',
    hasPosition: 'has_position',
    required: 'required',
    archived: 'archived',
    alphabetical: 'alphabetical',
    sortOrder: 'sort_order'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'levels') tx.set('hierarchies', id, 'levels', JSON.stringify(v))
    else if (map[k]) tx.set('hierarchies', id, map[k], v)
  }
}

function nextPublicId(lib: Library, hierarchyId: number): string {
  const h = lib.db.prepare('SELECT id_prefix, next_public FROM hierarchies WHERE id = ?').get(hierarchyId) as {
    id_prefix: string
    next_public: number
  }
  // Updated outside the undo log on purpose: public ids are never reused.
  lib.db.prepare('UPDATE hierarchies SET next_public = next_public + 1 WHERE id = ?').run(hierarchyId)
  return `${h.id_prefix}-${String(h.next_public).padStart(4, '0')}`
}

export function createNode(tx: Tx, lib: Library, hierarchyId: number, parentId: number | null, label: string): number {
  const clean = label.trim()
  if (!clean) throw new Error('A node needs a label.')
  const order = (
    lib.db
      .prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM nodes WHERE hierarchy_id = ? AND parent_id IS ?')
      .get(hierarchyId, parentId) as { n: number }
  ).n
  const id = tx.insert('nodes', {
    hierarchy_id: hierarchyId,
    parent_id: parentId,
    public_id: nextPublicId(lib, hierarchyId),
    label: clean,
    sort_order: order
  })
  // Keep the derived ancestor table current so later steps in the same action can use it.
  lib.db.prepare('INSERT OR IGNORE INTO node_closure VALUES (?, ?, 0)').run(id, id)
  if (parentId !== null)
    lib.db
      .prepare('INSERT OR IGNORE INTO node_closure SELECT ancestor, ?, depth + 1 FROM node_closure WHERE descendant = ?')
      .run(id, parentId)
  return id
}

/** Find a node by label path under a hierarchy, creating missing nodes. */
export function findOrCreatePath(tx: Tx, lib: Library, hierarchyId: number, labels: string[]): number | null {
  let parent: number | null = null
  for (const raw of labels) {
    const label = raw.trim()
    if (!label) continue
    const found = lib.db
      .prepare('SELECT id FROM nodes WHERE hierarchy_id = ? AND parent_id IS ? AND label = ? COLLATE NOCASE LIMIT 1')
      .get(hierarchyId, parent, label) as { id: number } | undefined
    parent = found ? found.id : createNode(tx, lib, hierarchyId, parent, label)
  }
  return parent
}

export function updateNode(tx: Tx, id: number, patch: Partial<HNode>): void {
  const map: Record<string, string> = {
    label: 'label',
    description: 'description',
    coverPhotoId: 'cover_photo_id',
    sortOrder: 'sort_order',
    lat: 'lat',
    lon: 'lon',
    zoom: 'zoom',
    retired: 'retired'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'altNames') tx.set('nodes', id, 'alt_names', JSON.stringify(v))
    else if (k === 'refs') tx.set('nodes', id, 'refs', JSON.stringify(v))
    else if (map[k]) tx.set('nodes', id, map[k], k === 'label' ? String(v).trim() : v)
  }
}

export function moveNode(tx: Tx, lib: Library, id: number, newParent: number | null, beforeId?: number | null): void {
  if (newParent !== null) {
    const cyc = lib.db.prepare('SELECT 1 FROM node_closure WHERE ancestor = ? AND descendant = ?').get(id, newParent)
    if (cyc || newParent === id) throw new Error('A node cannot be moved inside itself.')
    const ph = lib.db.prepare('SELECT hierarchy_id FROM nodes WHERE id = ?').get(newParent) as { hierarchy_id: number }
    const me = lib.db.prepare('SELECT hierarchy_id FROM nodes WHERE id = ?').get(id) as { hierarchy_id: number }
    if (ph.hierarchy_id !== me.hierarchy_id) throw new Error('Nodes can only be moved within their own hierarchy.')
  }
  tx.set('nodes', id, 'parent_id', newParent)
  // Renumber siblings so the node sits before `beforeId` (or at the end).
  const hid = (lib.db.prepare('SELECT hierarchy_id FROM nodes WHERE id = ?').get(id) as { hierarchy_id: number })
    .hierarchy_id
  const sibs = (
    lib.db
      .prepare('SELECT id FROM nodes WHERE hierarchy_id = ? AND parent_id IS ? AND id != ? ORDER BY sort_order, id')
      .all(hid, newParent, id) as { id: number }[]
  ).map((r) => r.id)
  const at = beforeId ? sibs.indexOf(beforeId) : -1
  if (at >= 0) sibs.splice(at, 0, id)
  else sibs.push(id)
  sibs.forEach((sid, i) => tx.set('nodes', sid, 'sort_order', i + 1))
}

export function nodeHasUse(lib: Library, id: number): boolean {
  return !!(
    lib.db.prepare('SELECT 1 FROM photo_nodes WHERE node_id = ? LIMIT 1').get(id) ||
    lib.db.prepare('SELECT 1 FROM nodes WHERE parent_id = ? LIMIT 1').get(id) ||
    lib.db.prepare('SELECT 1 FROM changes WHERE tbl = ? AND op = ? AND json_extract(new_value, ?) = ? LIMIT 1')
      .get('photo_nodes', 'insert', '$.node_id', id)
  )
}

export function deleteNode(tx: Tx, lib: Library, id: number): void {
  if (nodeHasUse(lib, id)) throw new Error('This node has been used, so it can only be retired, not deleted.')
  tx.delete('nodes', id)
}

export function mergeNodes(tx: Tx, lib: Library, fromId: number, intoId: number): number {
  if (fromId === intoId) throw new Error('Choose two different nodes.')
  const a = lib.db.prepare('SELECT hierarchy_id FROM nodes WHERE id = ?').get(fromId) as { hierarchy_id: number }
  const c = lib.db.prepare('SELECT hierarchy_id FROM nodes WHERE id = ?').get(intoId) as { hierarchy_id: number }
  if (a.hierarchy_id !== c.hierarchy_id) throw new Error('Only nodes in the same hierarchy can be merged.')
  if (lib.db.prepare('SELECT 1 FROM node_closure WHERE ancestor = ? AND descendant = ?').get(fromId, intoId))
    throw new Error('A node cannot be merged into one of its own children.')
  const links = lib.db.prepare('SELECT id, photo_id FROM photo_nodes WHERE node_id = ?').all(fromId) as {
    id: number
    photo_id: number
  }[]
  for (const l of links) {
    tx.delete('photo_nodes', l.id)
    if (!lib.db.prepare('SELECT 1 FROM photo_nodes WHERE photo_id = ? AND node_id = ?').get(l.photo_id, intoId))
      tx.insert('photo_nodes', { photo_id: l.photo_id, node_id: intoId })
  }
  const kids = lib.db.prepare('SELECT id FROM nodes WHERE parent_id = ?').all(fromId) as { id: number }[]
  for (const k of kids) tx.set('nodes', k.id, 'parent_id', intoId)
  const alts = new Set<string>([
    ...JSON.parse((lib.db.prepare('SELECT alt_names FROM nodes WHERE id = ?').get(intoId) as { alt_names: string }).alt_names),
    (lib.db.prepare('SELECT label FROM nodes WHERE id = ?').get(fromId) as { label: string }).label
  ])
  tx.set('nodes', intoId, 'alt_names', JSON.stringify([...alts]))
  tx.set('nodes', fromId, 'retired', 1)
  return links.length
}

/** Rebuild the ancestor table from parent links. Derived data, not part of undo. */
export function rebuildClosure(lib: Library): void {
  lib.db.transaction(() => {
    lib.db.exec('DELETE FROM node_closure')
    lib.db.exec(`
      WITH RECURSIVE c(ancestor, descendant, depth) AS (
        SELECT id, id, 0 FROM nodes
        UNION ALL
        SELECT n.parent_id, c.descendant, c.depth + 1 FROM c JOIN nodes n ON n.id = c.ancestor
        WHERE n.parent_id IS NOT NULL
      )
      INSERT OR IGNORE INTO node_closure SELECT ancestor, descendant, depth FROM c;
    `)
  })()
}

function hierarchyOf(lib: Library, nodeId: number): { id: number; multi: boolean } {
  const r = lib.db
    .prepare('SELECT h.id, h.multi FROM nodes n JOIN hierarchies h ON h.id = n.hierarchy_id WHERE n.id = ?')
    .get(nodeId) as { id: number; multi: number } | undefined
  if (!r) throw new Error('That node no longer exists.')
  return { id: r.id, multi: r.multi === 1 }
}

/** Assign a node to photos. Single-entry hierarchies replace the photo's existing entry. */
export function assignNode(tx: Tx, lib: Library, ids: number[], nodeId: number): number {
  const h = hierarchyOf(lib, nodeId)
  const existing = lib.db.prepare(
    `SELECT pn.id, pn.node_id FROM photo_nodes pn JOIN nodes n ON n.id = pn.node_id
     WHERE pn.photo_id = ? AND n.hierarchy_id = ?`
  )
  const isAncestor = lib.db.prepare('SELECT 1 FROM node_closure WHERE ancestor = ? AND descendant = ? AND depth > 0')
  let n = 0
  for (const id of ids) {
    const cur = existing.all(id, h.id) as { id: number; node_id: number }[]
    if (cur.some((c) => c.node_id === nodeId)) continue
    if (h.multi && cur.some((c) => isAncestor.get(nodeId, c.node_id))) continue // a more specific entry already exists
    for (const c of cur) {
      if (!h.multi || isAncestor.get(c.node_id, nodeId)) tx.delete('photo_nodes', c.id)
    }
    tx.insert('photo_nodes', { photo_id: id, node_id: nodeId })
    n++
  }
  return n
}

export function removeNode(tx: Tx, lib: Library, ids: number[], nodeId: number): number {
  let n = 0
  const st = lib.db.prepare('SELECT id FROM photo_nodes WHERE photo_id = ? AND node_id = ?')
  for (const id of ids) {
    const r = st.get(id, nodeId) as { id: number } | undefined
    if (r && tx.delete('photo_nodes', r.id)) n++
  }
  return n
}

export function clearHierarchy(tx: Tx, lib: Library, ids: number[], hierarchyId: number): void {
  const st = lib.db.prepare(
    'SELECT pn.id FROM photo_nodes pn JOIN nodes n ON n.id = pn.node_id WHERE pn.photo_id = ? AND n.hierarchy_id = ?'
  )
  for (const id of ids) for (const r of st.all(id, hierarchyId) as { id: number }[]) tx.delete('photo_nodes', r.id)
}

/** Tab-indented outline, one node per line. */
export function exportOutline(lib: Library, hierarchyId: number): string {
  const nodes = readNodes(lib).filter((n) => n.hierarchyId === hierarchyId && !n.retired)
  const kids = new Map<number | null, HNode[]>()
  for (const n of nodes) {
    const a = kids.get(n.parentId) ?? []
    a.push(n)
    kids.set(n.parentId, a)
  }
  const lines: string[] = []
  const walk = (p: number | null, d: number): void => {
    for (const n of (kids.get(p) ?? []).sort((x, y) => x.sortOrder - y.sortOrder || x.label.localeCompare(y.label))) {
      lines.push('\t'.repeat(d) + n.label + (n.altNames.length ? ` {${n.altNames.join(', ')}}` : ''))
      walk(n.id, d + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n') + '\n'
}

/** Import a tab-indented outline (also reads Lightroom's keyword export: [bracketed] labels and {synonyms}). */
export function importOutline(tx: Tx, lib: Library, hierarchyId: number, text: string): number {
  const stack: { depth: number; id: number }[] = []
  let created = 0
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const depth = (rawLine.match(/^\t*/) as RegExpMatchArray)[0].length
    let label = rawLine.trim()
    const alts: string[] = []
    label = label.replace(/\{([^}]*)\}/g, (_m, s: string) => {
      alts.push(...s.split(',').map((x) => x.trim()).filter(Boolean))
      return ''
    })
    label = label.replace(/^\[(.*)\]$/, '$1').trim()
    if (!label) continue
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].id : null
    const found = lib.db
      .prepare('SELECT id FROM nodes WHERE hierarchy_id = ? AND parent_id IS ? AND label = ? COLLATE NOCASE')
      .get(hierarchyId, parent, label) as { id: number } | undefined
    const id = found ? found.id : createNode(tx, lib, hierarchyId, parent, label)
    if (!found) created++
    if (alts.length) tx.set('nodes', id, 'alt_names', JSON.stringify(alts))
    stack.push({ depth, id })
  }
  return created
}

// ---------------------------------------------------------------- shoots and subgroups

export function codeIsFree(lib: Library, code: string): boolean {
  if (lib.db.prepare('SELECT 1 FROM shoots WHERE code = ?').get(code)) return false
  if (lib.db.prepare('SELECT 1 FROM id_registry WHERE shoot_code = ? LIMIT 1').get(code)) return false
  // Codes of shoots removed by undo stay reserved.
  if (
    lib.db
      .prepare("SELECT 1 FROM changes WHERE tbl = 'shoots' AND op = 'insert' AND json_extract(new_value, '$.code') = ? LIMIT 1")
      .get(code)
  )
    return false
  return true
}

export function proposeCode(lib: Library, name: string): string {
  const words = name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  let base = ''
  if (words.length === 0) base = 'SHOT'
  else if (words.length === 1) base = words[0].slice(0, 4)
  else if (words.length === 2) base = words[0].slice(0, 2) + words[1].slice(0, 2)
  else if (words.length === 3) base = words[0].slice(0, 2) + words[1][0] + words[2][0]
  else base = words.slice(0, 4).map((w) => w[0]).join('')
  base = (base + 'XXXX').slice(0, 4)
  if (codeIsFree(lib, base)) return base
  const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (const ch of alnum) {
    const c = base.slice(0, 3) + ch
    if (codeIsFree(lib, c)) return c
  }
  for (const a of alnum)
    for (const ch of alnum) {
      const c = base.slice(0, 2) + a + ch
      if (codeIsFree(lib, c)) return c
    }
  throw new Error('No free code found; type one in.')
}

export function createShoot(tx: Tx, lib: Library, name: string, code: string, ids: number[]): number {
  const c = code.toUpperCase().trim()
  if (!/^[A-Z0-9]{4}$/.test(c)) throw new Error('A shoot code is exactly four capital letters or digits.')
  if (!codeIsFree(lib, c)) throw new Error(`The code ${c} has already been used.`)
  if (!name.trim()) throw new Error('A shoot needs a name.')
  const id = tx.insert('shoots', {
    code: c,
    name: name.trim(),
    time_zone: lib.getSettings().defaultTimeZone,
    created_at: nowIso()
  })
  if (ids.length) setShoot(tx, lib, ids, id)
  return id
}

export function updateShoot(tx: Tx, lib: Library, id: number, patch: Partial<Shoot>): void {
  const map: Record<string, string> = {
    name: 'name',
    description: 'description',
    coverPhotoId: 'cover_photo_id',
    timeZone: 'time_zone',
    clockOffsetMin: 'clock_offset_min',
    archived: 'archived'
  }
  for (const [k, v] of Object.entries(patch)) if (map[k]) tx.set('shoots', id, map[k], v)
  if ('name' in patch) refreshPublishedNames(tx, lib, { shootId: id })
}

/** Put photos in a shoot. Named photos cannot change shoot until their ID is withdrawn. */
export function setShoot(tx: Tx, lib: Library, ids: number[], shootId: number | null): { moved: number; refused: number } {
  let moved = 0
  let refused = 0
  const st = lib.db.prepare('SELECT shoot_id, subgroup_id, legend_id FROM photos WHERE id = ?')
  for (const id of ids) {
    const r = st.get(id) as { shoot_id: number | null; subgroup_id: number | null; legend_id: string | null }
    if (r.shoot_id === shootId) continue
    if (r.legend_id) {
      refused++
      continue
    }
    tx.set('photos', id, 'shoot_id', shootId)
    tx.set('photos', id, 'subgroup_id', null)
    moved++
  }
  return { moved, refused }
}

export function createSubgroup(tx: Tx, lib: Library, shootId: number, heading: string, ids: number[]): number {
  if (!heading.trim()) throw new Error('A subgroup needs a heading.')
  const order = (
    lib.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM subgroups WHERE shoot_id = ?').get(shootId) as {
      n: number
    }
  ).n
  const id = tx.insert('subgroups', { shoot_id: shootId, heading: heading.trim(), sort_order: order })
  if (ids.length) setSubgroup(tx, lib, ids, id)
  return id
}

export function setSubgroup(tx: Tx, lib: Library, ids: number[], subgroupId: number | null): { moved: number; refused: number } {
  if (subgroupId === null) {
    let moved = 0
    for (const id of ids) if (tx.set('photos', id, 'subgroup_id', null)) moved++
    return { moved, refused: 0 }
  }
  const sg = lib.db.prepare('SELECT shoot_id FROM subgroups WHERE id = ?').get(subgroupId) as { shoot_id: number }
  const res = setShoot(tx, lib, ids, sg.shoot_id)
  let moved = 0
  const st = lib.db.prepare('SELECT shoot_id FROM photos WHERE id = ?')
  for (const id of ids) {
    const r = st.get(id) as { shoot_id: number | null }
    if (r.shoot_id !== sg.shoot_id) continue
    if (tx.set('photos', id, 'subgroup_id', subgroupId)) moved++
  }
  return { moved, refused: res.refused }
}

export function updateSubgroup(tx: Tx, id: number, patch: Partial<Subgroup>): void {
  const map: Record<string, string> = {
    heading: 'heading',
    description: 'description',
    coverPhotoId: 'cover_photo_id',
    anchorLat: 'anchor_lat',
    anchorLon: 'anchor_lon',
    anchorSet: 'anchor_set',
    writeup: 'writeup',
    sortOrder: 'sort_order'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'featured') tx.set('subgroups', id, 'featured', JSON.stringify(v))
    else if (map[k]) tx.set('subgroups', id, map[k], v)
  }
}

export function deleteSubgroup(tx: Tx, lib: Library, id: number): number {
  const ids = (lib.db.prepare('SELECT id FROM photos WHERE subgroup_id = ?').all(id) as { id: number }[]).map((r) => r.id)
  for (const p of ids) tx.set('photos', p, 'subgroup_id', null)
  tx.set('subgroups', id, 'retired', 1)
  return ids.length
}

/** Propose subgroups from pauses in capture time. Nothing is written. */
export function splitByTimeGap(lib: Library, ids: number[], gapMinutes: number): number[][] {
  const rows = readPhotos(lib, ids)
    .filter((p) => p.captured)
    .sort((a, b2) => (a.captured! < b2.captured! ? -1 : 1))
  const groups: number[][] = []
  let last = 0
  for (const p of rows) {
    const t = Date.parse(p.captured! + 'Z')
    if (!groups.length || t - last > gapMinutes * 60000) groups.push([])
    groups[groups.length - 1].push(p.id)
    last = t
  }
  return groups
}

// ---------------------------------------------------------------- naming

export function refreshPublishedNames(tx: Tx, lib: Library, scope: { shootId?: number; ids?: number[] }): void {
  const settings = lib.getSettings()
  const where = scope.ids
    ? `id IN (${scope.ids.join(',') || '0'})`
    : `shoot_id = ${Number(scope.shootId)}`
  const rows = lib.db
    .prepare(`SELECT id FROM photos WHERE legend_id IS NOT NULL AND exported_at IS NULL AND ${where}`)
    .all() as { id: number }[]
  if (!rows.length) return
  const photos = readPhotos(lib, rows.map((r) => r.id))
  const shoots = new Map(readShoots(lib).map((s) => [s.id, s]))
  const subgroups = new Map(readSubgroups(lib).map((s) => [s.id, s]))
  for (const p of photos) {
    const name = publishedName(settings.nameTemplate, p, shoots.get(p.shootId!) ?? null, subgroups.get(p.subgroupId!) ?? null)
    tx.set('photos', p.id, 'published_name', name)
  }
}

/** Issue Legend IDs to unnamed photos of one shoot, in capture order. */
export function assignNames(tx: Tx, lib: Library, ids: number[]): { named: number; skipped: number } {
  const photos = readPhotos(lib, ids)
  const shootIds = new Set(photos.map((p) => p.shootId))
  if (shootIds.has(null)) throw new Error('Every photo must belong to a shoot before it can be named.')
  if (shootIds.size > 1) throw new Error('Assign names works on photos of one shoot at a time.')
  const todo = photos
    .filter((p) => !p.legendId)
    .sort((a, c) => (a.captured ?? '').localeCompare(c.captured ?? '') || a.rawKey.localeCompare(c.rawKey) || a.variantNo - c.variantNo)
  if (!todo.length) return { named: 0, skipped: photos.length }
  const shootId = todo[0].shootId!
  const shoot = lib.db.prepare('SELECT code, next_number FROM shoots WHERE id = ?').get(shootId) as {
    code: string
    next_number: number
  }
  let num = shoot.next_number
  const reg = lib.db.prepare(
    "INSERT INTO id_registry (legend_id, shoot_code, number, photo_id, raw_key, state, issued_at) VALUES (?,?,?,?,?,'active',?)"
  )
  for (const p of todo) {
    let lid = `${shoot.code}-${String(num).padStart(5, '0')}`
    while (lib.db.prepare('SELECT 1 FROM id_registry WHERE legend_id = ?').get(lid)) {
      num++
      lid = `${shoot.code}-${String(num).padStart(5, '0')}`
    }
    // The registry and the counter are written outside the undo log: an ID, once issued, is never issued again.
    reg.run(lid, shoot.code, num, p.id, p.rawKey, nowIso())
    tx.set('photos', p.id, 'legend_id', lid)
    num++
  }
  lib.db.prepare('UPDATE shoots SET next_number = ? WHERE id = ?').run(num, shootId)
  tx.touchedTables.add('id_registry')
  refreshPublishedNames(tx, lib, { ids: todo.map((p) => p.id) })
  return { named: todo.length, skipped: photos.length - todo.length }
}

/** Withdraw IDs from photos never exported. The numbers are retired for ever. */
export function withdrawNames(tx: Tx, lib: Library, ids: number[]): { withdrawn: number; refused: number } {
  let withdrawn = 0
  let refused = 0
  for (const p of readPhotos(lib, ids)) {
    if (!p.legendId) continue
    if (p.exportedAt) {
      refused++
      continue
    }
    tx.set('photos', p.id, 'legend_id', null)
    tx.set('photos', p.id, 'published_name', null)
    withdrawn++
  }
  reconcileRegistry(lib)
  tx.touchedTables.add('id_registry')
  return { withdrawn, refused }
}

/** Keep the registry state in line with photos (after withdraw, undo or redo). */
export function reconcileRegistry(lib: Library): void {
  lib.db
    .prepare(
      `UPDATE id_registry SET state = 'retired', retired_at = COALESCE(retired_at, ?)
       WHERE state = 'active' AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.legend_id = id_registry.legend_id AND p.id = id_registry.photo_id)`
    )
    .run(nowIso())
  lib.db
    .prepare(
      `UPDATE id_registry SET state = 'active', retired_at = NULL
       WHERE state = 'retired' AND EXISTS (SELECT 1 FROM photos p WHERE p.legend_id = id_registry.legend_id AND p.id = id_registry.photo_id)`
    )
    .run()
}

export interface RegistryRow {
  legendId: string
  shootCode: string
  number: number
  rawKey: string
  state: string
  issuedAt: string
  publishedName: string | null
}
export function readRegistry(lib: Library): { codes: { code: string; name: string; archived: boolean; issued: number }[]; ids: RegistryRow[] } {
  const codes = lib.db
    .prepare(
      `SELECT s.code, s.name, s.archived, (SELECT COUNT(*) FROM id_registry r WHERE r.shoot_code = s.code) AS issued
       FROM shoots s ORDER BY s.code`
    )
    .all() as { code: string; name: string; archived: number; issued: number }[]
  const ids = lib.db
    .prepare(
      `SELECT r.legend_id, r.shoot_code, r.number, r.raw_key, r.state, r.issued_at, p.published_name
       FROM id_registry r LEFT JOIN photos p ON p.id = r.photo_id AND p.legend_id = r.legend_id ORDER BY r.legend_id`
    )
    .all() as Record<string, unknown>[]
  return {
    codes: codes.map((c) => ({ ...c, archived: c.archived === 1 })),
    ids: ids.map((r) => ({
      legendId: r.legend_id as string,
      shootCode: r.shoot_code as string,
      number: r.number as number,
      rawKey: r.raw_key as string,
      state: r.state as string,
      issuedAt: r.issued_at as string,
      publishedName: (r.published_name as string) ?? null
    }))
  }
}

// ---------------------------------------------------------------- sets

export function createSet(tx: Tx, name: string, ids: number[], kind: 'manual' | 'import' = 'manual'): number {
  const id = tx.insert('sets', { name: name.trim() || 'Untitled set', kind, created_at: nowIso() })
  for (const p of ids) tx.insert('set_members', { set_id: id, photo_id: p })
  return id
}

export function addToSet(tx: Tx, lib: Library, setId: number, ids: number[]): number {
  let n = 0
  const ex = lib.db.prepare('SELECT 1 FROM set_members WHERE set_id = ? AND photo_id = ?')
  for (const p of ids) {
    if (ex.get(setId, p)) continue
    tx.insert('set_members', { set_id: setId, photo_id: p })
    n++
  }
  return n
}

export function removeFromSet(tx: Tx, lib: Library, setId: number, ids: number[]): number {
  let n = 0
  const ex = lib.db.prepare('SELECT id FROM set_members WHERE set_id = ? AND photo_id = ?')
  for (const p of ids) {
    const r = ex.get(setId, p) as { id: number } | undefined
    if (r && tx.delete('set_members', r.id)) n++
  }
  return n
}

// ---------------------------------------------------------------- history

export function photoHistory(lib: Library, photoId: number): HistoryEntry[] {
  const rows = lib.db
    .prepare(
      `SELECT c.op, c.tbl, c.field, c.old_value, c.new_value, a.at, a.label, a.undone
       FROM changes c JOIN actions a ON a.id = c.action_id
       WHERE c.photo_id = ? ORDER BY c.id DESC LIMIT 500`
    )
    .all(photoId) as Record<string, unknown>[]
  const labels = new Map(readNodes(lib).map((n) => [n.id, n.label]))
  const sets = new Map((lib.db.prepare('SELECT id, name FROM sets').all() as { id: number; name: string }[]).map((s) => [s.id, s.name]))
  const fieldName = Object.fromEntries(Object.entries(PHOTO_FIELDS).map(([k, v]) => [v, k]))
  return rows.map((r) => {
    let field = (r.field as string) ?? ''
    let oldValue: unknown = r.old_value ? JSON.parse(r.old_value as string) : null
    let newValue: unknown = r.new_value ? JSON.parse(r.new_value as string) : null
    if (r.tbl === 'photo_nodes') {
      field = 'entry'
      const row = (newValue ?? oldValue) as { node_id: number }
      const label = labels.get(row.node_id) ?? `node ${row.node_id}`
      oldValue = r.op === 'delete' ? label : null
      newValue = r.op === 'insert' ? label : null
    } else if (r.tbl === 'set_members') {
      field = 'set'
      const row = (newValue ?? oldValue) as { set_id: number }
      const label = sets.get(row.set_id) ?? `set ${row.set_id}`
      oldValue = r.op === 'delete' ? label : null
      newValue = r.op === 'insert' ? label : null
    } else if (r.tbl === 'photos' && r.op === 'set') {
      field = fieldName[field] ?? field
    }
    return { at: r.at as string, label: r.label as string, field, oldValue, newValue, undone: r.undone === 1 }
  })
}

export type { Settings }
