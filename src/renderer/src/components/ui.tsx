import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import { Icon } from './Icon'

// ---------------------------------------------------------------- menus

export interface MenuItem {
  label?: string
  icon?: string
  key?: string
  disabled?: boolean
  onClick?: () => void
  sep?: boolean
  head?: string
}

const useMenu = create<{ x: number; y: number; items: MenuItem[] } | { items: null }>(() => ({ items: null }))

export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]): void {
  e.preventDefault?.()
  useMenu.setState({ x: e.clientX, y: e.clientY, items })
}

export function openMenuAt(el: HTMLElement, items: MenuItem[]): void {
  const r = el.getBoundingClientRect()
  useMenu.setState({ x: r.left, y: r.bottom + 4, items })
}

export function MenuHost() {
  const m = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!m.items || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.min((m as { x: number }).x, window.innerWidth - r.width - 8)
    const y = Math.min((m as { y: number }).y, window.innerHeight - r.height - 8)
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [m])
  if (!m.items) return null
  const close = (): void => useMenu.setState({ items: null })
  return (
    <div className="overlay" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close() }}>
      <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {m.items.map((it, i) =>
          it.sep ? (
            <div key={i} className="sep" />
          ) : it.head ? (
            <div key={i} className="mh">{it.head}</div>
          ) : (
            <div
              key={i}
              className={'mi' + (it.disabled ? ' dis' : '')}
              onClick={() => {
                close()
                it.onClick?.()
              }}
            >
              {it.icon ? <Icon name={it.icon} size={15} /> : <span style={{ width: 15 }} />}
              {it.label}
              {it.key && <span className="k">{it.key}</span>}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- toasts

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <Icon name={t.kind === 'ok' ? 'check' : 'alert'} size={15} />
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- dialogs

export function Dialog({
  title,
  sub,
  children,
  foot,
  wide,
  onClose
}: {
  title: string
  sub?: ReactNode
  children: ReactNode
  foot?: ReactNode
  wide?: boolean
  onClose: () => void
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog">
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
        <div className="body">{children}</div>
        {foot && <div className="foot">{foot}</div>}
      </div>
    </div>
  )
}

// Simple promise-based prompt and confirm.
interface Ask {
  kind: 'prompt' | 'confirm'
  title: string
  text?: string
  value?: string
  okLabel?: string
  danger?: boolean
  resolve: (v: string | boolean | null) => void
}
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }))

export function prompt(title: string, value = '', text?: string, okLabel = 'OK'): Promise<string | null> {
  return new Promise((resolve) =>
    useAsk.setState({ ask: { kind: 'prompt', title, value, text, okLabel, resolve: (v) => resolve(v as string | null) } })
  )
}
export function confirm(title: string, text?: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) =>
    useAsk.setState({ ask: { kind: 'confirm', title, text, okLabel, danger, resolve: (v) => resolve(!!v) } })
  )
}

export function AskHost() {
  const ask = useAsk((s) => s.ask)
  const [v, setV] = useState('')
  useEffect(() => setV(ask?.value ?? ''), [ask])
  if (!ask) return null
  const done = (val: string | boolean | null): void => {
    useAsk.setState({ ask: null })
    ask.resolve(val)
  }
  return (
    <Dialog
      title={ask.title}
      onClose={() => done(null)}
      foot={
        <>
          <button className="btn ghost" onClick={() => done(null)}>Cancel</button>
          <button
            className={'btn ' + (ask.danger ? 'danger' : 'primary')}
            onClick={() => done(ask.kind === 'prompt' ? v.trim() || null : true)}
          >
            {ask.okLabel}
          </button>
        </>
      }
    >
      {ask.text && <div className="muted">{ask.text}</div>}
      {ask.kind === 'prompt' && (
        <input
          className="field"
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && done(v.trim() || null)}
        />
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- splitter

export function Splitter({ onDrag, side }: { onDrag: (dx: number) => void; side: 'l' | 'r' }) {
  const [drag, setDrag] = useState(false)
  return (
    <div
      className={'splitter' + (drag ? ' drag' : '')}
      onMouseDown={(e) => {
        e.preventDefault()
        setDrag(true)
        let last = e.clientX
        const mv = (ev: MouseEvent): void => {
          onDrag(side === 'l' ? ev.clientX - last : last - ev.clientX)
          last = ev.clientX
        }
        const up = (): void => {
          setDrag(false)
          window.removeEventListener('mousemove', mv)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', mv)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

export function Stars({ value, onChange, size = 15 }: { value: number | null; onChange: (n: number) => void; size?: number }) {
  return (
    <div className="ratingbar">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={'star' + (value !== null && n <= value ? ' on' : '')} onClick={() => onChange(value === n ? 0 : n)} title={`${n} star${n > 1 ? 's' : ''}`}>
          <Icon name="logo" size={size} fill={value !== null && n <= value} stroke={value !== null && n <= value ? 0 : 1.5} />
        </button>
      ))}
    </div>
  )
}
