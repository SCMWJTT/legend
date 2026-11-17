// Every request from the interface arrives here. Mutating calls run as one action and return a delta.
import { BrowserWindow, dialog, shell, app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ActionResult, DuplicateChoice, FieldEdit, HNode, Hierarchy, PasteSpec, Settings, Shoot, Subgroup } from '@shared/types'
import { Library, type ActionOutcome, type Tx } from './db/library'
import * as C from './services/catalog'
import { runImport } from './services/importer'
import { ThumbQueue } from './services/thumbs'
import { endExifTool } from './services/exif'

interface Prefs {
  recent: string[]
  bounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

const prefsFile = (): string => path.join(app.getPath('userData'), 'prefs.json')
export function loadPrefs(): Prefs {
  try {
    return { recent: [], ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }
  } catch {
    return { recent: [] }
  }
}
export function savePrefs(p: Prefs): void {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true })
  fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2))
}

export class Api {
  lib: Library | null = null
  thumbs: ThumbQueue | null = null
  private busy = false

  constructor(private win: () => BrowserWindow | null) {}

  private send(channel: string, payload: unknown): void {
    this.win()?.webContents.send(channel, payload)
  }

  private need(): Library {
    if (!this.lib) throw new Error('No library is open.')
    return this.lib
  }

  /** Run a mutation as one undoable action and build the reply. */
  private act<T>(label: string, fn: (tx: Tx, lib: Library) => T, msg: (v: T, n: number) => string, bulk = 0): ActionResult {
    const lib = this.need()
    const out: ActionOutcome<T> = lib.action(label, (tx) => fn(tx, lib), { bulkCount: bulk })
    const message = msg(out.value, out.touchedPhotos.size)
    return { ok: true, message, delta: C.deltaFor(lib, out, message), data: out.value }
  }

  // ------------------------------------------------ library

  state() {
    const prefs = loadPrefs()
    return {
      library: this.lib ? this.info() : null,
      recent: prefs.recent.filter((p) => fs.existsSync(path.join(p, 'library.sqlite'))),
      version: app.getVersion()
    }
  }

  private info() {
    const lib = this.need()
    return {
      path: lib.dir,
      name: path.basename(lib.dir).replace(/\.legendlib$/i, ''),
      schemaVersion: lib.schemaVersion,
      photoCount: (lib.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE retired = 0').get() as { n: number }).n
    }
  }

  async createLibrary() {
    const r = await dialog.showSaveDialog(this.win()!, {
      title: 'Create a Legend library',
      defaultPath: path.join(app.getPath('pictures'), 'Photos.legendlib'),
      buttonLabel: 'Create library',
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (r.canceled || !r.filePath) return null
    const dir = /\.legendlib$/i.test(r.filePath) ? r.filePath : r.filePath + '.legendlib'
    this.closeLibrary()
    this.attach(Library.create(dir))
    return this.state()
  }

  async openLibrary(dir?: string) {
    if (!dir) {
      const r = await dialog.showOpenDialog(this.win()!, {
        title: 'Open a Legend library',
        properties: ['openDirectory'],
        buttonLabel: 'Open library'
      })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    this.closeLibrary()
    this.attach(Library.open(dir))
    return this.state()
  }

  tryOpenLast(): void {
    // LEGEND_LIBRARY opens (or creates) a given library; used for testing.
    const forced = process.env.LEGEND_LIBRARY
    if (forced) {
      this.attach(fs.existsSync(path.join(forced, 'library.sqlite')) ? Library.open(forced) : Library.create(forced))
      return
    }
    const last = loadPrefs().recent[0]
    if (!last) return
    try {
      this.attach(Library.open(last))
    } catch {
      /* ignore */
    }
  }

  private attach(lib: Library): void {
    this.lib = lib
    C.ensureDefaultHierarchies(lib)
    C.rebuildClosure(lib)
    const prefs = loadPrefs()
    prefs.recent = [lib.dir, ...prefs.recent.filter((p) => p !== lib.dir)].slice(0, 8)
    savePrefs(prefs)
    this.thumbs = new ThumbQueue(lib, (updates, done, total, paused) => {
      this.send('thumbs', { updates, done, total, paused })
    })
    setTimeout(() => {
      this.thumbs?.enqueueNeeded()
      void this.checkOffline()
    }, 500)
  }

  closeLibrary(): void {
    this.thumbs?.stop()
    this.thumbs = null
    this.lib?.close()
    this.lib = null
  }

  async shutdown(): Promise<void> {
    this.closeLibrary()
    await endExifTool()
  }

  /** Mark photos whose image file is missing (for example an unplugged drive). */
  private async checkOffline(): Promise<void> {
    const lib = this.lib
    if (!lib) return
    const rows = lib.db.prepare('SELECT id, file_path, file_offline FROM photos WHERE retired = 0').all() as {
      id: number
      file_path: string
      file_offline: number
    }[]
    const flips: { id: number; off: number }[] = []
    for (let i = 0; i < rows.length; i += 200) {
      await Promise.all(
        rows.slice(i, i + 200).map(async (r) => {
          const exists = await fs.promises
            .access(r.file_path, fs.constants.R_OK)
            .then(() => true)
            .catch(() => false)
          const off = exists ? 0 : 1
          if (off !== r.file_offline) flips.push({ id: r.id, off })
        })
      )
      if (this.lib !== lib) return
    }
    if (!flips.length) return
    const st = lib.db.prepare('UPDATE photos SET file_offline = ? WHERE id = ?')
    lib.db.transaction(() => flips.forEach((f) => st.run(f.off, f.id)))()
    this.send('delta', { photos: C.readPhotos(lib, flips.map((f) => f.id)), canUndo: lib.undoLabel(), canRedo: lib.redoLabel() })
    if (flips.some((f) => f.off === 0)) this.thumbs?.enqueueNeeded()
  }

  snapshot() {
    return C.snapshot(this.need())
  }

  revealFile(p: string): void {
    shell.showItemInFolder(p)
  }

  // ------------------------------------------------ import

  async chooseFolder(): Promise<string | null> {
    const r = await dialog.showOpenDialog(this.win()!, { title: 'Choose a folder of exported JPEGs', properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }

  async runImport(folder: string, recursive: boolean, choices?: Record<string, DuplicateChoice>) {
    const lib = this.need()
    if (this.busy) throw new Error('An import is already running.')
    this.busy = true
    try {
      const out = await runImport(lib, {
        folder,
        recursive,
        choices,
        onProgress: (done, total, label) => this.send('progress', { task: 'import', done, total, label })
      })
      this.send('progress', { task: 'import', done: 0, total: 0, label: '' })
      if ('needsChoice' in out) return out
      this.thumbs?.add([...out.newIds, ...out.changedIds])
      const delta = C.deltaFor(lib, { touchedPhotos: new Set(out.allIds), touchedTables: new Set(['nodes', 'sets', 'hierarchies']) })
      delta.imports = C.readImports(lib)
      return { ...out, delta }
    } finally {
      this.busy = false
    }
  }

  pauseThumbs(p: boolean): void {
    this.thumbs?.setPaused(p)
  }
  prioritiseThumbs(ids: number[]): void {
    this.thumbs?.prioritise(ids)
  }

  // ------------------------------------------------ editing

  editFields(ids: number[], edits: FieldEdit[], label?: string): ActionResult {
    const name = label ?? `Edit ${edits.map((e) => e.field).join(', ')}`
    return this.act(name, (tx) => C.applyEdits(tx, ids, edits), (n) => `${fieldLabel(edits)} set on ${n} photo${n === 1 ? '' : 's'}`, ids.length)
  }

  setPosition(ids: number[], lat: number | null, lon: number | null): ActionResult {
    return this.act('Set position', (tx) => C.setPosition(tx, ids, lat, lon), (n) => `Position set on ${n} photo${n === 1 ? '' : 's'}`, ids.length)
  }

  resetToCamera(ids: number[]): ActionResult {
    return this.act('Reset to camera position', (tx, lib) => C.resetToCamera(tx, lib, ids), (n) => `Camera position restored on ${n} photos`, ids.length)
  }

  useNodePosition(ids: number[]): ActionResult {
    return this.act('Use location position', (tx, lib) => C.useNodePosition(tx, lib, ids), (n) => `${n} photos placed at their location's position`, ids.length)
  }

  paste(sourceId: number, ids: number[], spec: PasteSpec): ActionResult {
    return this.act('Paste fields', (tx, lib) => C.pasteFields(tx, lib, sourceId, ids, spec), (_v, n) => `Fields pasted on ${n} photos`, ids.length)
  }

  // ------------------------------------------------ hierarchies

  assignNode(ids: number[], nodeId: number): ActionResult {
    return this.act('Assign entry', (tx, lib) => C.assignNode(tx, lib, ids, nodeId), (n) => `${this.nodeLabel(nodeId)} added to ${n} photos`, ids.length)
  }
  removeNode(ids: number[], nodeId: number): ActionResult {
    return this.act('Remove entry', (tx, lib) => C.removeNode(tx, lib, ids, nodeId), (n) => `${this.nodeLabel(nodeId)} removed from ${n} photos`, ids.length)
  }
  replaceEntries(ids: number[], hierarchyId: number, nodeIds: number[]): ActionResult {
    return this.act(
      'Replace entries',
      (tx, lib) => {
        C.clearHierarchy(tx, lib, ids, hierarchyId)
        for (const n of nodeIds) C.assignNode(tx, lib, ids, n)
      },
      (_v, n) => `Entries replaced on ${n} photos`,
      ids.length
    )
  }
  createNode(hierarchyId: number, parentId: number | null, label: string, assignTo: number[] = []): ActionResult {
    return this.act(
      'New node',
      (tx, lib) => {
        const id = C.createNode(tx, lib, hierarchyId, parentId, label)
        if (assignTo.length) C.assignNode(tx, lib, assignTo, id)
        return id
      },
      () => `Created "${label}"${assignTo.length ? ` and added it to ${assignTo.length} photos` : ''}`
    )
  }
  createPath(hierarchyId: number, labels: string[], assignTo: number[] = []): ActionResult {
    return this.act(
      'New entry',
      (tx, lib) => {
        const id = C.findOrCreatePath(tx, lib, hierarchyId, labels)
        if (id && assignTo.length) C.assignNode(tx, lib, assignTo, id)
        return id
      },
      () => `"${labels.join(' › ')}" ${assignTo.length ? `added to ${assignTo.length} photos` : 'created'}`,
      assignTo.length
    )
  }
  updateNode(id: number, patch: Partial<HNode>): ActionResult {
    return this.act('Edit node', (tx) => C.updateNode(tx, id, patch), () => 'Node updated')
  }
  moveNode(id: number, parentId: number | null, beforeId: number | null): ActionResult {
    return this.act('Move node', (tx, lib) => C.moveNode(tx, lib, id, parentId, beforeId), () => `Moved ${this.nodeLabel(id)}`)
  }
  mergeNodes(fromId: number, intoId: number): ActionResult {
    const a = this.nodeLabel(fromId)
    return this.act('Merge nodes', (tx, lib) => C.mergeNodes(tx, lib, fromId, intoId), (n) => `Merged ${a} into ${this.nodeLabel(intoId)}; ${n} photos moved`)
  }
  deleteNode(id: number): ActionResult {
    const a = this.nodeLabel(id)
    return this.act('Delete node', (tx, lib) => C.deleteNode(tx, lib, id), () => `Deleted ${a}`)
  }
  nodeInUse(id: number): boolean {
    return C.nodeHasUse(this.need(), id)
  }
  createHierarchy(h: { key: string; name: string; multi: boolean; levels?: string[]; hasPosition?: boolean }): ActionResult {
    return this.act('New hierarchy', (tx, lib) => C.createHierarchy(tx, lib, h), () => `Hierarchy ${h.name} created`)
  }
  updateHierarchy(id: number, patch: Partial<Hierarchy>): ActionResult {
    return this.act('Edit hierarchy', (tx) => C.updateHierarchy(tx, id, patch), () => 'Hierarchy updated')
  }
  async exportOutline(id: number): Promise<string | null> {
    const lib = this.need()
    const h = C.readHierarchies(lib).find((x) => x.id === id)!
    const r = await dialog.showSaveDialog(this.win()!, { defaultPath: `${h.key}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, C.exportOutline(lib, id), 'utf8')
    return r.filePath
  }
  async importOutline(id: number): Promise<ActionResult | null> {
    const r = await dialog.showOpenDialog(this.win()!, { properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const text = fs.readFileSync(r.filePaths[0], 'utf8').replace(/^﻿/, '')
    return this.act('Import outline', (tx, lib) => C.importOutline(tx, lib, id, text), (n) => `${n} nodes created from the outline`)
  }
  private nodeLabel(id: number): string {
    const r = this.need().db.prepare('SELECT label FROM nodes WHERE id = ?').get(id) as { label: string } | undefined
    return r ? `"${r.label}"` : 'Node'
  }

  // ------------------------------------------------ shoots, subgroups, names

  proposeCode(name: string): string {
    return C.proposeCode(this.need(), name)
  }
  codeFree(code: string): boolean {
    return C.codeIsFree(this.need(), code.toUpperCase())
  }
  createShoot(name: string, code: string, ids: number[]): ActionResult {
    return this.act('New shoot', (tx, lib) => C.createShoot(tx, lib, name, code, ids), () => `Shoot ${code.toUpperCase()} created${ids.length ? ` with ${ids.length} photos` : ''}`, ids.length)
  }
  updateShoot(id: number, patch: Partial<Shoot>): ActionResult {
    return this.act('Edit shoot', (tx, lib) => C.updateShoot(tx, lib, id, patch), () => 'Shoot updated')
  }
  setShoot(ids: number[], shootId: number | null): ActionResult {
    return this.act('Set shoot', (tx, lib) => C.setShoot(tx, lib, ids, shootId), (r) =>
      `${r.moved} photos moved${r.refused ? `; ${r.refused} named photos kept their shoot (withdraw their IDs first)` : ''}`, ids.length)
  }
  createSubgroup(shootId: number, heading: string, ids: number[]): ActionResult {
    return this.act('New subgroup', (tx, lib) => C.createSubgroup(tx, lib, shootId, heading, ids), () => `Subgroup "${heading}" created`, ids.length)
  }
  updateSubgroup(id: number, patch: Partial<Subgroup>): ActionResult {
    return this.act('Edit subgroup', (tx) => C.updateSubgroup(tx, id, patch), () => 'Subgroup updated')
  }
  setSubgroup(ids: number[], subgroupId: number | null): ActionResult {
    return this.act('Set subgroup', (tx, lib) => C.setSubgroup(tx, lib, ids, subgroupId), (r) =>
      `${r.moved} photos placed${r.refused ? `; ${r.refused} named photos belong to another shoot` : ''}`, ids.length)
  }
  deleteSubgroup(id: number): ActionResult {
    return this.act('Delete subgroup', (tx, lib) => C.deleteSubgroup(tx, lib, id), (n) => `Subgroup removed; ${n} photos returned to the shoot`)
  }
  splitByGap(ids: number[], minutes: number): number[][] {
    return C.splitByTimeGap(this.need(), ids, minutes)
  }
  applySplit(shootId: number, groups: { heading: string; ids: number[] }[]): ActionResult {
    return this.act(
      'Split by time gap',
      (tx, lib) => groups.forEach((g) => C.createSubgroup(tx, lib, shootId, g.heading, g.ids)),
      () => `${groups.length} subgroups created`
    )
  }
  assignNames(ids: number[]): ActionResult {
    return this.act('Assign names', (tx, lib) => C.assignNames(tx, lib, ids), (r) =>
      `${r.named} photos named${r.skipped ? `; ${r.skipped} already had names` : ''}`, ids.length)
  }
  withdrawNames(ids: number[]): ActionResult {
    return this.act('Withdraw names', (tx, lib) => C.withdrawNames(tx, lib, ids), (r) =>
      `${r.withdrawn} IDs withdrawn and retired${r.refused ? `; ${r.refused} already published and kept` : ''}`)
  }
  registry() {
    return C.readRegistry(this.need())
  }

  // ------------------------------------------------ sets

  createSet(name: string, ids: number[]): ActionResult {
    return this.act('New set', (tx) => C.createSet(tx, name, ids), () => `Set "${name}" created with ${ids.length} photos`)
  }
  addToSet(setId: number, ids: number[]): ActionResult {
    return this.act('Add to set', (tx, lib) => C.addToSet(tx, lib, setId, ids), (n) => `${n} photos added to the set`)
  }
  removeFromSet(setId: number, ids: number[]): ActionResult {
    return this.act('Remove from set', (tx, lib) => C.removeFromSet(tx, lib, setId, ids), (n) => `${n} photos removed from the set`)
  }
  renameSet(setId: number, name: string): ActionResult {
    return this.act('Rename set', (tx) => tx.set('sets', setId, 'name', name), () => 'Set renamed')
  }
  deleteSet(setId: number): ActionResult {
    return this.act('Remove set', (tx) => tx.set('sets', setId, 'retired', 1), () => 'Set removed (photos are not affected)')
  }

  // ------------------------------------------------ history, undo, settings, backup

  history(photoId: number) {
    return C.photoHistory(this.need(), photoId)
  }

  undo(): ActionResult {
    const lib = this.need()
    const out = lib.undo()
    if (!out) return { ok: false, message: 'Nothing to undo' }
    C.reconcileRegistry(lib)
    out.touchedTables.add('nodes')
    out.touchedTables.add('shoots')
    out.touchedTables.add('subgroups')
    out.touchedTables.add('sets')
    const message = `Undone: ${out.value}`
    return { ok: true, message, delta: C.deltaFor(lib, out, message) }
  }

  redo(): ActionResult {
    const lib = this.need()
    const out = lib.redo()
    if (!out) return { ok: false, message: 'Nothing to redo' }
    C.reconcileRegistry(lib)
    out.touchedTables.add('nodes')
    out.touchedTables.add('shoots')
    out.touchedTables.add('subgroups')
    out.touchedTables.add('sets')
    const message = `Redone: ${out.value}`
    return { ok: true, message, delta: C.deltaFor(lib, out, message) }
  }

  saveSettings(patch: Partial<Settings>): ActionResult {
    const lib = this.need()
    const settings = lib.saveSettings(patch)
    if ('nameTemplate' in patch) {
      const ids = (lib.db.prepare('SELECT id FROM photos WHERE legend_id IS NOT NULL AND exported_at IS NULL').all() as { id: number }[]).map((r) => r.id)
      if (ids.length) {
        const out = lib.action('Apply name template', (tx) => C.refreshPublishedNames(tx, lib, { ids }), { undoable: false })
        const d = C.deltaFor(lib, out, 'Settings saved')
        return { ok: true, message: 'Settings saved', delta: { ...d, settings } }
      }
    }
    return { ok: true, message: 'Settings saved', delta: { settings, canUndo: lib.undoLabel(), canRedo: lib.redoLabel() } }
  }

  async exportBackup(): Promise<string | null> {
    const lib = this.need()
    const r = await dialog.showSaveDialog(this.win()!, {
      defaultPath: `legend-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    const tables = (lib.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('node_closure')").all() as { name: string }[]).map((t) => t.name)
    const out: Record<string, unknown> = { format: 'legend-backup/1', schemaVersion: lib.schemaVersion, exportedAt: new Date().toISOString(), tables: {} }
    for (const t of tables) (out.tables as Record<string, unknown>)[t] = lib.db.prepare(`SELECT * FROM ${t}`).all()
    fs.writeFileSync(r.filePath, JSON.stringify(out))
    return r.filePath
  }
}

function fieldLabel(edits: FieldEdit[]): string {
  const names: Record<string, string> = { alt: 'Alt text', noLocation: 'No location', privatePlace: 'Private place', showElevation: 'Show elevation' }
  const list = edits.map((e) => names[e.field] ?? e.field.charAt(0).toUpperCase() + e.field.slice(1))
  return list.join(', ')
}
