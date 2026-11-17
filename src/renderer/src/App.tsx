import { useEffect } from 'react'
import { bridge, call } from './api'
import { useStore } from './store'
import type { Delta, Snapshot } from '@shared/types'
import { Icon } from './components/Icon'
import { AskHost, MenuHost, Splitter, Toasts } from './components/ui'
import { Welcome } from './components/Welcome'
import { Navigator } from './components/Navigator'
import { LibraryView } from './components/LibraryView'
import { Inspector } from './components/Inspector'
import { Explorer } from './components/Explorer'
import { Registry } from './components/Registry'
import { Dialogs } from './components/Dialogs'
import { StatusBar } from './components/StatusBar'
import * as cmd from './commands'
import { useVisible } from './logic'

export async function loadLibrary(): Promise<void> {
  const state = await call<{ library: { path: string; name: string } | null; recent: string[]; version: string }>('state')
  useStore.getState().setLibraryState(state)
  if (state.library) useStore.getState().loadSnapshot(await call<Snapshot>('snapshot'))
}

export function App() {
  const library = useStore((s) => s.library)
  const workspace = useStore((s) => s.workspace)

  useEffect(() => {
    void loadLibrary()
    const offs = [
      bridge.on('progress', (p) => {
        const e = p as { task: string; done: number; total: number; label: string }
        const s = useStore.getState()
        s.set({ progress: { ...s.progress, importDone: e.done, importTotal: e.total, importLabel: e.label } })
      }),
      bridge.on('thumbs', (p) => {
        const e = p as { updates: { id: number; ver: number }[]; done: number; total: number; paused: boolean }
        const s = useStore.getState()
        s.setThumbs(e.updates)
        s.set({ progress: { ...s.progress, thumbDone: e.done, thumbTotal: e.total, thumbPaused: e.paused } })
      }),
      bridge.on('delta', (d) => useStore.getState().applyDelta(d as Delta))
    ]
    return () => offs.forEach((o) => o())
  }, [])

  if (!library) return <><Welcome /><Toasts /><AskHost /></>

  return (
    <div className="app">
      <TitleBar />
      {workspace === 'library' && <LibraryWorkspace />}
      {workspace === 'hierarchies' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Explorer /></div></div>}
      {workspace === 'registry' && <div className="main"><div className="grow" style={{ minWidth: 0 }}><Registry /></div></div>}
      <StatusBar />
      <Dialogs />
      <MenuHost />
      <AskHost />
      <Toasts />
    </div>
  )
}

function TitleBar() {
  const library = useStore((s) => s.library)!
  const workspace = useStore((s) => s.workspace)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.openDialog)
  return (
    <div className="titlebar">
      <div className="brand">
        <Icon name="logo" size={17} fill stroke={0} />
        Legend <span className="lib">{library.name}</span>
      </div>
      <div className="tabs">
        <button className={workspace === 'library' ? 'on' : ''} onClick={() => set({ workspace: 'library' })}>Library</button>
        <button className={workspace === 'hierarchies' ? 'on' : ''} onClick={() => set({ workspace: 'hierarchies' })}>Hierarchies</button>
        <button className={workspace === 'registry' ? 'on' : ''} onClick={() => set({ workspace: 'registry' })}>Name registry</button>
      </div>
      <div className="spacer" />
      <div className="tb-actions">
        <button className="iconbtn" title={canUndo ? `Undo ${canUndo} (Ctrl+Z)` : 'Nothing to undo'} disabled={!canUndo} onClick={() => void cmd.undo()}><Icon name="undo" /></button>
        <button className="iconbtn" title={canRedo ? `Redo ${canRedo} (Ctrl+Y)` : 'Nothing to redo'} disabled={!canRedo} onClick={() => void cmd.redo()}><Icon name="redo" /></button>
        <button className="btn small primary" style={{ marginLeft: 8 }} onClick={() => open('import')}><Icon name="import" size={14} />Import</button>
        <button className="iconbtn" title="Settings" onClick={() => open('settings')}><Icon name="settings" /></button>
      </div>
    </div>
  )
}

function LibraryWorkspace() {
  const ui = useStore((s) => s.ui)
  const setUi = useStore((s) => s.setUi)
  const visible = useVisible()
  useKeys(visible.list.map((p) => p.id))
  return (
    <div className="main">
      {ui.navOpen && (
        <>
          <div className="panel nav" style={{ width: ui.navWidth }}>
            <Navigator />
          </div>
          <Splitter side="l" onDrag={(dx) => setUi({ navWidth: Math.max(190, Math.min(480, useStore.getState().ui.navWidth + dx)) })} />
        </>
      )}
      <div className="center">
        <LibraryView visible={visible} />
      </div>
      {ui.inspOpen && (
        <>
          <Splitter side="r" onDrag={(dx) => setUi({ inspWidth: Math.max(290, Math.min(560, useStore.getState().ui.inspWidth + dx)) })} />
          <div className="panel insp" style={{ width: ui.inspWidth }}>
            <Inspector />
          </div>
        </>
      )}
    </div>
  )
}

/** Library keyboard shortcuts. Arrow keys are handled by the grid itself. */
function useKeys(order: number[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (s.dialog) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && !e.shiftKey && k === 'z' && !typing) { e.preventDefault(); void cmd.undo(); return }
      if (ctrl && (k === 'y' || (e.shiftKey && k === 'z')) && !typing) { e.preventDefault(); void cmd.redo(); return }
      if (ctrl && k === 'f') { e.preventDefault(); (document.querySelector('.search input') as HTMLInputElement)?.focus(); return }
      if (ctrl && k === 'i') { e.preventDefault(); s.openDialog('import'); return }
      if (typing) return
      if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); cmd.copyFields(); return }
      if (ctrl && e.shiftKey && k === 'v') { e.preventDefault(); cmd.pasteFields(false); return }
      if (ctrl && e.altKey && k === 'v') { e.preventDefault(); cmd.pasteFields(true); return }
      if (ctrl && k === 'a') { e.preventDefault(); s.select(order, s.focusId ?? order[0] ?? null); return }
      if (ctrl && k === 'd') { e.preventDefault(); s.select([]); return }
      if (ctrl && k === 'n') { e.preventDefault(); cmd.newShoot(); return }
      if (ctrl && k === 'g') { e.preventDefault(); void cmd.newSubgroup(); return }
      if (ctrl || e.altKey) return
      if (/^[0-5]$/.test(e.key)) { cmd.setRating(Number(e.key)); return }
      if (k === 'g') s.set({ view: 'grid' })
      else if (k === 'e' || k === ' ') { e.preventDefault(); s.set({ view: s.view === 'single' ? 'grid' : 'single' }) }
      else if (k === 't') s.set({ view: 'table' })
      else if (k === 'tab') { e.preventDefault(); s.setUi({ navOpen: !(s.ui.navOpen && s.ui.inspOpen), inspOpen: !(s.ui.navOpen && s.ui.inspOpen) }) }
      else if (k === 'f') s.setUi({ showFacets: !s.ui.showFacets })
      else if (k === '?') s.openDialog('shortcuts')
      else if (k === 'escape') {
        if (s.view === 'single') s.set({ view: 'grid' })
        else if (s.selected.size) s.select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order])
}
