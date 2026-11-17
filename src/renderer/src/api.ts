import type { ActionResult } from '@shared/types'
import { useStore } from './store'

interface Bridge {
  call: (method: string, ...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }>
  on: (channel: string, cb: (payload: unknown) => void) => () => void
  window: (cmd: string) => void
  pathForFile: (f: File) => string
  platform: string
}

export const bridge = (window as unknown as { legend: Bridge }).legend

/** Call the main process; throws with a readable message on failure. */
export async function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const r = await bridge.call(method, ...args)
  if (!r.ok) throw new Error(r.error ?? 'Something went wrong')
  return r.value as T
}

/** Call a mutating method, apply its delta and show its confirmation. */
export async function act(method: string, ...args: unknown[]): Promise<ActionResult | null> {
  try {
    const r = await call<ActionResult | null>(method, ...args)
    if (!r) return null
    if (r.delta) useStore.getState().applyDelta(r.delta)
    useStore.getState().toast(r.message, r.ok ? 'ok' : 'warn')
    return r
  } catch (e) {
    useStore.getState().toast((e as Error).message, 'error')
    return null
  }
}

export const thumbUrl = (id: number, ver: number, kind: 'g' | 'p' = 'g'): string | null =>
  ver === 0 ? null : `legend-thumb://${kind}/${id}?v=${Math.abs(ver)}`
