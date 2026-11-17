// Reads embedded metadata with ExifTool (bundled, runs in batch mode). Never writes.
import { ExifTool, type Tags } from 'exiftool-vendored'
import os from 'os'

let et: ExifTool | null = null

function tool(): ExifTool {
  if (!et) et = new ExifTool({ maxProcs: Math.max(2, Math.min(6, os.cpus().length)), taskTimeoutMillis: 60000 })
  return et
}

export async function endExifTool(): Promise<void> {
  if (et) await et.end()
  et = null
}

export interface ExifData {
  title: string
  headline: string
  description: string
  alt: string
  rating: number
  creator: string
  rights: string
  hierarchical: string[]
  subjects: string[]
  iptc: { country: string; state: string; city: string; sublocation: string }
  lat: number | null
  lon: number | null
  ele: number | null
  captured: string | null
  width: number
  height: number
  cameraBody: string
  lens: string
  focal: number | null
  aperture: number | null
  shutter: string
  iso: number | null
  preservedName: string
}

const str = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join('; ')
  if (typeof v === 'object' && v !== null && 'value' in (v as Record<string, unknown>))
    return str((v as Record<string, unknown>).value)
  return String(v).trim()
}
const list = (v: unknown): string[] => {
  if (v === undefined || v === null) return []
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  return String(v)
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

function capturedOf(t: Tags): string | null {
  const raw = (t.DateTimeOriginal ?? t.CreateDate) as unknown
  if (!raw) return null
  const s =
    typeof raw === 'string' ? raw : ((raw as { rawValue?: string; toString(): string }).rawValue ?? raw.toString())
  const m = s.match(/(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null
}

function gps(v: unknown, ref: unknown, negRef: string): number | null {
  const n = num(v)
  if (n === null) return null
  const r = str(ref).toUpperCase()
  if (n > 0 && r.startsWith(negRef)) return -n
  return n
}

export async function readExif(file: string): Promise<ExifData> {
  const t = (await tool().read(file)) as Tags & Record<string, unknown>
  const orientation = num(t.Orientation) ?? 1
  let width = num(t.ImageWidth) ?? num(t.ExifImageWidth) ?? 0
  let height = num(t.ImageHeight) ?? num(t.ExifImageHeight) ?? 0
  if (orientation >= 5 && orientation <= 8) [width, height] = [height, width]
  const exposure = t.ExposureTime as unknown
  return {
    title: str(t.Title ?? t.ObjectName),
    headline: str(t.Headline),
    description: str(t.Description ?? t['Caption-Abstract'] ?? t.ImageDescription),
    alt: str(t.AltTextAccessibility),
    rating: Math.max(0, Math.min(5, Math.round(num(t.Rating) ?? 0))),
    creator: str(t.Creator ?? t.Artist ?? t['By-line']),
    rights: str(t.Rights ?? t.Copyright ?? t.CopyrightNotice),
    hierarchical: list(t.HierarchicalSubject),
    subjects: list(t.Subject ?? t.Keywords),
    iptc: {
      country: str(t.Country ?? t['Country-PrimaryLocationName']),
      state: str(t.State ?? t['Province-State']),
      city: str(t.City),
      sublocation: str(t.Location ?? t['Sub-location'])
    },
    lat: gps(t.GPSLatitude, t.GPSLatitudeRef, 'S'),
    lon: gps(t.GPSLongitude, t.GPSLongitudeRef, 'W'),
    ele: (() => {
      const e = num(t.GPSAltitude)
      if (e === null) return null
      return Number(t.GPSAltitudeRef) === 1 || /below/i.test(str(t.GPSAltitudeRef)) ? -e : e
    })(),
    captured: capturedOf(t),
    width,
    height,
    cameraBody: str(t.Model),
    lens: str(t.LensModel ?? t.LensID ?? t.Lens),
    focal: num(t.FocalLength),
    aperture: num(t.FNumber ?? t.Aperture),
    shutter: typeof exposure === 'number' ? (exposure >= 1 ? String(exposure) : `1/${Math.round(1 / exposure)}`) : str(exposure),
    iso: num(t.ISO),
    preservedName: str(t.PreservedFileName ?? t.RawFileName)
  }
}
