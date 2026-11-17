import { create } from 'zustand'
import type { Delta, HNode, Hierarchy, ImportRecord, PasteSpec, PhotoRow, PhotoSet, Settings, Shoot, Snapshot, Subgroup } from '@shared/types'

export type Source =
  | { kind: 'all' }
  | { kind: 'set'; id: number }
  | { kind: 'shoot'; id: number }
  | { kind: 'subgroup'; id: number }
  | { kind: 'noShoot' }
  | { kind: 'node'; id: number }
  | { kind: 'saved'; name: string }

export type View = 'grid' | 'table' | 'single'
export type Workspace = 'library' | 'hierarchies' | 'registry'
export type SortKey = string // captured | rawKey | legendId | title | rating | status | importedAt | modifiedAt | shoot | h:<id>

export interface Filters {
  text: string
  facets: Record<string, string[]> // dimension -> selected values
  missing: string[]
  flags: string[] // offline, people, private, variant, changed, noPosition
  minRating: number
}

export interface SavedFilter {
  name: string
  source: Source
  filters: Filters
}

export interface UiPrefs {
  thumbSize: number // 0..6
  overlays: string[]
  facetColumns: string[]
  showFacets: boolean
  tableColumns: string[]
  navWidth: number
  inspWidth: number
  navOpen: boolean
  inspOpen: boolean
  sort: { key: SortKey; dir: 1 | -1 }
  groupBy: string
  inspTab: string
  mapLayer: 'street' | 'satellite'
  pasteSpec: PasteSpec | null
  savedFilters: Record<string, SavedFilter[]> // by library path
  navCollapsed: Record<string, boolean>
}

const DEFAULT_PREFS: UiPrefs = {
  thumbSize: 3,
  overlays: ['title', 'legendId', 'rating', 'missing', 'badges'],
  facetColumns: ['h:location', 'h:keywords', 'shoot', 'rating'],
  showFacets: false,
  tableColumns: ['thumb', 'rawKey', 'legendId', 'title', 'caption', 'rating', 'captured', 'shoot', 'h:location', 'status'],
  navWidth: 260,
  inspWidth: 340,
  navOpen: true,
  inspOpen: true,
  sort: { key: 'captured', dir: 1 },
  groupBy: 'none',
  inspTab: 'describe',
  mapLayer: 'street',
  pasteSpec: null,
  savedFilters: {},
  navCollapsed: {}
}

function loadPrefs(): UiPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('legend.ui') ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

export const EMPTY_FILTERS: Filters = { text: '', facets: {}, missing: [], flags: [], minRating: 0 }

export interface Toast {
  id: number
  text: string
  kind: 'ok' | 'warn' | 'error'
}

export interface Progress {
  importDone: number
  importTotal: number
  importLabel: string
  thumbDone: number
  thumbTotal: number
  thumbPaused: boolean
}

export interface LibState {
  library: { path: string; name: string } | null
  recent: string[]
  version: string
  photos: PhotoRow[]
  byId: Map<number, PhotoRow>
  hierarchies: Hierarchy[]
  nodes: HNode[]
  nodeById: Map<number, HNode>
  children: Map<string, HNode[]> // key `${hierarchyId}:${parentId ?? 0}`
  shoots: Shoot[]
  subgroups: Subgroup[]
  sets: PhotoSet[]
  imports: ImportRecord[]
  settings: Settings | null
  canUndo: string | null
  canRedo: string | null
  rev: number // bumps on any photo change

  workspace: Workspace
  view: View
  source: Source
  filters: Filters
  selected: Set<number>
  focusId: number | null
  anchorId: number | null
  ui: UiPrefs
  toasts: Toast[]
  progress: Progress
  clipboard: number | null
  dialog: { kind: string; props?: Record<string, unknown> } | null
  explorerNode: number | null
  explorerHierarchy: number | null

  setLibraryState: (s: { library: { path: string; name: string } | null; recent: string[]; version: string }) => void
  loadSnapshot: (s: Snapshot) => void
  applyDelta: (d: Delta) => void
  setThumbs: (ups: { id: number; ver: number }[]) => void
  set: (p: Partial<LibState>) => void
  setUi: (p: Partial<UiPrefs>) => void
  setFilters: (p: Partial<Filters>) => void
  setSource: (s: Source) => void
  select: (ids: Iterable<number>, focus?: number | null) => void
  toast: (text: string, kind?: Toast['kind']) => void
  openDialog: (kind: string, props?: Record<string, unknown>) => void
  closeDialog: () => void
}

function indexNodes(nodes: HNode[]) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, HNode[]>()
  for (const n of nodes) {
    const k = `${n.hierarchyId}:${n.parentId ?? 0}`
    const a = children.get(k) ?? []
    a.push(n)
    children.set(k, a)
  }
  for (const a of children.values()) a.sort((x, y) => x.sortOrder - y.sortOrder || x.label.localeCompare(y.label))
  return { nodeById, children }
}

let toastId = 0

export const useStore = create<LibState>((set, get) => ({
  library: null,
  recent: [],
  version: '',
  photos: [],
  byId: new Map(),
  hierarchies: [],
  nodes: [],
  nodeById: new Map(),
  children: new Map(),
  shoots: [],
  subgroups: [],
  sets: [],
  imports: [],
  settings: null,
  canUndo: null,
  canRedo: null,
  rev: 0,

  workspace: 'library',
  view: 'grid',
  source: { kind: 'all' },
  filters: EMPTY_FILTERS,
  selected: new Set(),
  focusId: null,
  anchorId: null,
  ui: loadPrefs(),
  toasts: [],
  progress: { importDone: 0, importTotal: 0, importLabel: '', thumbDone: 0, thumbTotal: 0, thumbPaused: false },
  clipboard: null,
  dialog: null,
  explorerNode: null,
  explorerHierarchy: null,

  setLibraryState: (s) => set({ library: s.library, recent: s.recent, version: s.version }),

  loadSnapshot: (s) => {
    const { nodeById, children } = indexNodes(s.nodes)
    set({
      photos: s.photos,
      byId: new Map(s.photos.map((p) => [p.id, p])),
      hierarchies: s.hierarchies,
      nodes: s.nodes,
      nodeById,
      children,
      shoots: s.shoots,
      subgroups: s.subgroups,
      sets: s.sets,
      imports: s.imports,
      settings: s.settings,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      selected: new Set(),
      focusId: null,
      anchorId: null,
      source: { kind: 'all' },
      filters: EMPTY_FILTERS,
      rev: get().rev + 1
    })
  },

  applyDelta: (d) => {
    const st = get()
    const patch: Partial<LibState> = { canUndo: d.canUndo, canRedo: d.canRedo }
    if (d.photos || d.removedPhotos) {
      const byId = new Map(st.byId)
      for (const p of d.photos ?? []) byId.set(p.id, p)
      for (const id of d.removedPhotos ?? []) byId.delete(id)
      patch.byId = byId
      patch.photos = [...byId.values()]
      patch.rev = st.rev + 1
    }
    if (d.nodes) {
      Object.assign(patch, { nodes: d.nodes, ...indexNodes(d.nodes) })
      patch.rev = (patch.rev ?? st.rev) + 1
    }
    if (d.hierarchies) patch.hierarchies = d.hierarchies
    if (d.shoots) patch.shoots = d.shoots
    if (d.subgroups) patch.subgroups = d.subgroups
    if (d.sets) patch.sets = d.sets
    if (d.imports) patch.imports = d.imports
    if (d.settings) patch.settings = d.settings
    set(patch)
  },

  setThumbs: (ups) => {
    if (!ups.length) return
    const st = get()
    const byId = new Map(st.byId)
    for (const u of ups) {
      const p = byId.get(u.id)
      if (p) byId.set(u.id, { ...p, thumbVer: u.ver })
    }
    set({ byId, photos: [...byId.values()], rev: st.rev + 1 })
  },

  set: (p) => set(p),

  setUi: (p) => {
    const ui = { ...get().ui, ...p }
    localStorage.setItem('legend.ui', JSON.stringify(ui))
    set({ ui })
  },

  setFilters: (p) => set({ filters: { ...get().filters, ...p } }),

  setSource: (source) => set({ source, workspace: 'library' }),

  select: (ids, focus) => {
    const s = new Set(ids)
    const f = focus === undefined ? (s.size ? [...s][s.size - 1] : null) : focus
    set({ selected: s, focusId: f, anchorId: f })
  },

  toast: (text, kind = 'ok') => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3200)
  },

  openDialog: (kind, props) => set({ dialog: { kind, props } }),
  closeDialog: () => set({ dialog: null })
}))

export const sel = (): number[] => [...useStore.getState().selected]
