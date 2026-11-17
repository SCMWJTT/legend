// Types shared by the main process (database side) and the interface.

export type Status = 'draft' | 'ready' | 'published' | 'withdrawn'
export type Precision = 'exact' | 'rounded' | 'hidden'
export type PosSource = 'camera' | 'hand' | 'node' | 'none'

/** One photo as held in memory by the interface. */
export interface PhotoRow {
  id: number
  rawKey: string
  variantNo: number
  legendId: string | null
  publishedName: string | null
  status: Status
  title: string
  caption: string
  note: string
  alt: string
  rating: number
  creator: string
  copyright: string
  licence: string
  credit: string
  shootId: number | null
  subgroupId: number | null
  lat: number | null
  lon: number | null
  elevation: number | null
  camLat: number | null
  camLon: number | null
  camEle: number | null
  posSource: PosSource
  showElevation: boolean
  precision: Precision
  noLocation: boolean
  people: boolean
  privatePlace: boolean
  captured: string | null // local time as recorded by the camera, "YYYY-MM-DDTHH:mm:ss"
  width: number
  height: number
  cameraBody: string
  lens: string
  focal: number | null
  aperture: number | null
  shutter: string
  iso: number | null
  filePath: string
  fileOffline: boolean
  thumbVer: number // 0 = no thumbnail yet
  importedAt: string
  modifiedAt: string
  exportedAt: string | null
  nodes: number[] // node ids assigned (only the chosen nodes, not ancestors)
  sets: number[]
}

/** Editable photo fields and their database columns. */
export const PHOTO_FIELDS = {
  title: 'title',
  caption: 'caption',
  note: 'note',
  alt: 'alt',
  rating: 'rating',
  creator: 'creator',
  copyright: 'copyright',
  licence: 'licence',
  credit: 'credit',
  status: 'status',
  lat: 'lat',
  lon: 'lon',
  elevation: 'elevation',
  posSource: 'pos_source',
  showElevation: 'show_elevation',
  precision: 'precision',
  noLocation: 'no_location',
  people: 'people',
  privatePlace: 'private_place'
} as const
export type EditableField = keyof typeof PHOTO_FIELDS

export interface Hierarchy {
  id: number
  key: string
  name: string
  multi: boolean
  levels: string[]
  hasPosition: boolean
  required: boolean
  sortOrder: number
  archived: boolean
  alphabetical: boolean
}

export interface HNode {
  id: number
  hierarchyId: number
  parentId: number | null
  publicId: string
  label: string
  altNames: string[]
  description: string
  coverPhotoId: number | null
  sortOrder: number
  refs: Record<string, string>
  lat: number | null
  lon: number | null
  zoom: number | null
  retired: boolean
}

export interface Shoot {
  id: number
  code: string
  name: string
  description: string
  coverPhotoId: number | null
  timeZone: string
  clockOffsetMin: number
  archived: boolean
  nextNumber: number
}

export interface Subgroup {
  id: number
  shootId: number
  heading: string
  description: string
  coverPhotoId: number | null
  anchorLat: number | null
  anchorLon: number | null
  anchorSet: boolean
  featured: number[]
  writeup: string
  sortOrder: number
}

export interface PhotoSet {
  id: number
  name: string
  kind: 'import' | 'manual'
  createdAt: string
}

export interface ImportRecord {
  id: number
  at: string
  folder: string
  scanned: number
  added: number
  known: number
  changed: number
  variants: number
  skipped: number
  setId: number | null
  report: ImportReport
}

export interface ImportReport {
  added: string[]
  known: string[]
  changed: string[]
  variants: string[]
  replaced: string[]
  relinked: string[]
  skipped: { file: string; reason: string }[]
  flags: { file: string; message: string }[]
}

/** Two files in one import with the same raw key. */
export interface DuplicateGroup {
  rawKey: string
  files: string[]
}
export type DuplicateChoice = 'variant' | 'replace'

export interface Settings {
  creator: string
  copyright: string
  licence: string
  credit: string
  rawKeyPattern: string // regex with one capture group, or '' for the plain file name
  keywordRoots: Record<string, string> // Lightroom top-level keyword -> hierarchy key
  seedLocationFromIptc: boolean
  nameTemplate: string
  defaultTimeZone: string
  suggestDistanceM: number
  tiles: {
    street: { url: string; attribution: string }
    satellite: { url: string; attribution: string }
  }
  mapCenter: { lat: number; lon: number; zoom: number }
}

export interface LibraryInfo {
  path: string
  name: string
  schemaVersion: number
  photoCount: number
}

export interface Snapshot {
  photos: PhotoRow[]
  hierarchies: Hierarchy[]
  nodes: HNode[]
  shoots: Shoot[]
  subgroups: Subgroup[]
  sets: PhotoSet[]
  imports: ImportRecord[]
  settings: Settings
  canUndo: string | null
  canRedo: string | null
}

/** Partial update pushed to the interface after any change. */
export interface Delta {
  photos?: PhotoRow[]
  removedPhotos?: number[]
  hierarchies?: Hierarchy[]
  nodes?: HNode[]
  shoots?: Shoot[]
  subgroups?: Subgroup[]
  sets?: PhotoSet[]
  imports?: ImportRecord[]
  settings?: Settings
  full?: boolean // the interface should reload everything
  canUndo: string | null
  canRedo: string | null
  message?: string
}

export interface ActionResult {
  ok: boolean
  message: string
  delta?: Delta
  data?: unknown
}

export type TextMode = 'replace' | 'prepend' | 'append' | 'findReplace'

export interface FieldEdit {
  field: EditableField
  value: unknown
  mode?: TextMode
  find?: string
}

export interface HistoryEntry {
  at: string
  label: string
  field: string
  oldValue: unknown
  newValue: unknown
  undone: boolean
}

export interface ProgressEvent {
  task: 'import' | 'thumbs'
  done: number
  total: number
  label: string
  paused?: boolean
}

export interface PasteSpec {
  fields: EditableField[]
  hierarchies: { id: number; mode: 'add' | 'replace' }[]
  shoot: boolean
}
