import { call } from '../api'
import { useStore } from '../store'
import { create } from 'zustand'

export const useShown = create<{ n: number }>(() => ({ n: 0 }))

export function StatusBar() {
  const total = useStore((s) => s.photos.length)
  const selected = useStore((s) => s.selected.size)
  const p = useStore((s) => s.progress)
  const workspace = useStore((s) => s.workspace)
  const open = useStore((s) => s.openDialog)
  return (
    <div className="statusbar">
      {workspace === 'library' ? <Shown /> : <span>{total.toLocaleString()} photos</span>}
      <span>{selected ? `${selected.toLocaleString()} selected` : ''}</span>
      <span className="grow" />
      {p.importTotal > 0 && (
        <span className="task">Importing {p.importDone}/{p.importTotal}<span className="bar"><i style={{ width: `${(100 * p.importDone) / p.importTotal}%` }} /></span></span>
      )}
      {p.thumbTotal > 0 && (
        <span className="task">
          {p.thumbPaused ? 'Thumbnails paused' : 'Making thumbnails'} {p.thumbDone}/{p.thumbTotal}
          <span className="bar"><i style={{ width: `${(100 * p.thumbDone) / Math.max(1, p.thumbTotal)}%` }} /></span>
          <button className="linkbtn" onClick={() => void call('pauseThumbs', !p.thumbPaused)}>{p.thumbPaused ? 'Resume' : 'Pause'}</button>
        </span>
      )}
      <button className="linkbtn" onClick={() => open('shortcuts')}>Shortcuts ?</button>
    </div>
  )
}

function Shown() {
  const n = useShown((s) => s.n)
  const total = useStore((s) => s.photos.length)
  const list = { length: n }
  return <span>{list.length === total ? `${total.toLocaleString()} photos` : `${list.length.toLocaleString()} of ${total.toLocaleString()} photos shown`}</span>
}
