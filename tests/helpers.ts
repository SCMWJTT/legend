import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { ExifTool } from 'exiftool-vendored'

export const TMP = path.resolve(__dirname, 'tmp')

export function freshDir(name: string): string {
  const d = path.join(TMP, name)
  fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** Make a small JPEG with Lightroom-like embedded metadata (test fixtures only). */
export async function makeJpeg(file: string, tags: Record<string, unknown>, color = { r: 40, g: 90, b: 140 }): Promise<void> {
  await sharp({ create: { width: 640, height: 427, channels: 3, background: color } }).jpeg().toFile(file)
  const et = new ExifTool({ maxProcs: 1 })
  try {
    await et.write(file, tags as never, ['-overwrite_original'])
  } finally {
    await et.end()
  }
}
