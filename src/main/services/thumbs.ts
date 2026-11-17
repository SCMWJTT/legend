// Thumbnail cache: a grid thumbnail and a large preview per photo, made once in the background.
// sharp does its work off the JavaScript thread, so the window stays responsive.
import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import type { Library } from '../db/library'

export const GRID_PX = 480
export const PREVIEW_PX = 2000

export function thumbPath(libDir: string, id: number, kind: 'g' | 'p'): string {
  const bucket = (id % 256).toString(16).padStart(2, '0')
  return path.join(libDir, 'thumbs', bucket, `${id}-${kind}.webp`)
}

export async function makeThumbs(libDir: string, id: number, file: string): Promise<void> {
  const prev = thumbPath(libDir, id, 'p')
  const grid = thumbPath(libDir, id, 'g')
  fs.mkdirSync(path.dirname(prev), { recursive: true })
  // Read the image (read-only), orient it, and make the large preview first.
  const input = await fs.promises.readFile(file)
  const pBuf = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  const gBuf = await sharp(pBuf).resize(GRID_PX, GRID_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
  await fs.promises.writeFile(prev + '.tmp', pBuf)
  await fs.promises.writeFile(grid + '.tmp', gBuf)
  await fs.promises.rename(prev + '.tmp', prev)
  await fs.promises.rename(grid + '.tmp', grid)
}

type Notify = (updates: { id: number; ver: number }[], done: number, total: number, paused: boolean) => void

/** Background queue. thumb_ver: 0 = none, > 0 = current, < 0 = outdated (old image still shown). */
export class ThumbQueue {
  private queue: number[] = []
  private queued = new Set<number>()
  private running = 0
  private paused = false
  private done = 0
  private total = 0
  private pending: { id: number; ver: number }[] = []
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  readonly concurrency = Math.max(2, Math.min(6, os.cpus().length - 1))

  constructor(
    private lib: Library,
    private notify: Notify
  ) {}

  enqueueNeeded(): void {
    const rows = this.lib.db
      .prepare('SELECT id FROM photos WHERE retired = 0 AND thumb_ver <= 0 AND file_offline = 0 ORDER BY captured')
      .all() as { id: number }[]
    this.add(rows.map((r) => r.id))
  }

  add(ids: number[]): void {
    for (const id of ids) {
      if (this.queued.has(id)) continue
      this.queued.add(id)
      this.queue.push(id)
      this.total++
    }
    this.pump()
  }

  /** Move these photos to the front (e.g. the ones on screen). */
  prioritise(ids: number[]): void {
    const want = new Set(ids.filter((id) => this.queued.has(id)))
    if (!want.size) return
    this.queue = [...this.queue.filter((id) => want.has(id)), ...this.queue.filter((id) => !want.has(id))]
  }

  setPaused(p: boolean): void {
    this.paused = p
    this.flush()
    if (!p) this.pump()
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    if (this.timer) clearTimeout(this.timer)
  }

  private pump(): void {
    while (!this.stopped && !this.paused && this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!
      this.running++
      this.work(id).finally(() => {
        this.running--
        this.queued.delete(id)
        this.done++
        if (this.done >= this.total && !this.queue.length && this.running === 0) {
          this.done = 0
          this.total = 0
        }
        this.schedule()
        this.pump()
      })
    }
    this.schedule()
  }

  private async work(id: number): Promise<void> {
    if (this.stopped) return
    const r = this.lib.db.prepare('SELECT file_path, thumb_ver FROM photos WHERE id = ?').get(id) as
      | { file_path: string; thumb_ver: number }
      | undefined
    if (!r) return
    try {
      await makeThumbs(this.lib.dir, id, r.file_path)
      if (this.stopped) return
      const ver = Math.abs(r.thumb_ver) + 1
      this.lib.db.prepare('UPDATE photos SET thumb_ver = ? WHERE id = ?').run(ver, id)
      this.pending.push({ id, ver })
    } catch (e) {
      this.lib.log(`Thumbnail failed for photo ${id} (${r.file_path}): ${(e as Error).message}`)
    }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 400)
  }

  private flush(): void {
    if (this.stopped) return
    const ups = this.pending
    this.pending = []
    this.notify(ups, this.done, this.total, this.paused)
  }
}
