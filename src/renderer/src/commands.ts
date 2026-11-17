import { act, call } from './api'
import { sel, useStore } from './store'
import { prompt, type MenuItem } from './components/ui'
import type { PhotoRow } from '@shared/types'

const st = () => useStore.getState()

export function need(min = 1): number[] | null {
  const ids = sel()
  if (ids.length < min) {
    st().toast(min === 1 ? 'Select one or more photos first' : `Select at least ${min} photos`, 'warn')
    return null
  }
  return ids
}

export const undo = () => act('undo')
export const redo = () => act('redo')

export function setRating(n: number): void {
  const ids = need()
  if (ids) void act('editFields', ids, [{ field: 'rating', value: n }], `Rating ${n}`)
}

export function copyFields(): void {
  const f = st().focusId
  if (!f) return st().toast('Select a photo to copy from', 'warn')
  st().set({ clipboard: f })
  const p = st().byId.get(f)
  st().toast(`Fields copied from ${p?.legendId ?? p?.rawKey}`)
}

export function pasteFields(again = false): void {
  const src = st().clipboard
  if (!src) return st().toast('Copy fields from a photo first (Ctrl+Shift+C)', 'warn')
  const ids = need()
  if (!ids) return
  const spec = st().ui.pasteSpec
  if (again && spec) void act('paste', src, ids, spec)
  else st().openDialog('paste')
}

export function newShoot(): void {
  st().openDialog('shoot', { ids: sel() })
}

export async function newSubgroup(shootId?: number): Promise<void> {
  const ids = sel()
  const photos = ids.map((id) => st().byId.get(id)!).filter(Boolean)
  const shoots = new Set(photos.map((p) => p.shootId))
  const sid = shootId ?? (shoots.size === 1 ? [...shoots][0] : null)
  if (!sid) return st().toast('Put the photos in one shoot first, or choose a shoot', 'warn')
  const heading = await prompt('New subgroup', '', 'A heading for this visit, e.g. "Late Evening Tyrico Beach Visit".', 'Create')
  if (heading) void act('createSubgroup', sid, heading, ids)
}

export function assignNames(): void {
  const ids = need()
  if (ids) void act('assignNames', ids)
}

export async function newSet(): Promise<void> {
  const ids = sel()
  const name = await prompt('New set', '', ids.length ? `The ${ids.length} selected photos will be added.` : undefined, 'Create')
  if (name) void act('createSet', name, ids)
}

export function revealFile(p?: PhotoRow): void {
  const photo = p ?? (st().focusId ? st().byId.get(st().focusId!) : undefined)
  if (photo) void call('revealFile', photo.filePath)
}

/** Context menu for photos (grid, table, single). */
export function photoMenu(): MenuItem[] {
  const n = st().selected.size
  const s = st()
  const items: MenuItem[] = [
    { head: n === 1 ? '1 photo' : `${n} photos` },
    { label: 'New shoot from selection…', icon: 'shoot', onClick: newShoot },
    { label: 'New subgroup from selection…', icon: 'layers', onClick: () => void newSubgroup() },
    { label: 'Assign names', icon: 'hash', onClick: assignNames },
    { sep: true },
    { label: 'Copy fields', icon: 'copy', key: 'Ctrl+Shift+C', onClick: copyFields, disabled: n !== 1 && !s.focusId },
    { label: 'Paste fields…', icon: 'paste', key: 'Ctrl+Shift+V', onClick: () => pasteFields(false), disabled: !s.clipboard },
    { label: 'Paste again', key: 'Ctrl+Alt+V', onClick: () => pasteFields(true), disabled: !s.clipboard || !s.ui.pasteSpec },
    { sep: true },
    { label: 'New set from selection…', icon: 'list', onClick: () => void newSet() },
    ...s.sets
      .filter((x) => x.kind === 'manual')
      .slice(0, 8)
      .map((x) => ({ label: `Add to "${x.name}"`, onClick: () => void act('addToSet', x.id, sel()) })),
    ...(s.source.kind === 'set'
      ? [{ label: 'Remove from this set', icon: 'x', onClick: () => void act('removeFromSet', (s.source as { id: number }).id, sel()) }]
      : []),
    { sep: true },
    { label: 'Reset to camera position', icon: 'reset', onClick: () => void act('resetToCamera', sel()) },
    { label: 'Show in Explorer', icon: 'folder', onClick: () => revealFile(), disabled: n !== 1 && !s.focusId }
  ]
  return items
}
