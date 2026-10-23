import { savePhoto, decodeImage } from '../image/compress'
import { db } from '../../db'
import { createMatcher } from '../match/drugs'
import { reader } from '../ocr/client'
import { runTesseract } from '../ocr/tesseract'
import { scaleQuad } from '../ocr/geometry'
import type { RawImage, ScanMode, TextRegion } from '../ocr/types'
import { analyze } from './pipeline'
import type { Candidate, ScanResult } from './types'

export type ScanStage =
  'preparing' | 'loading' | 'finding' | 'reading' | 'barcodes' | 'matching' | 'done'

export interface ScanProgress {
  stage: ScanStage
  label: string
  /** 0..1 overall */
  fraction: number
}

const LABEL: Record<ScanStage, string> = {
  preparing: 'Preparing photo',
  loading: 'Downloading reader (one time)',
  finding: 'Finding labels',
  reading: 'Reading text',
  barcodes: 'Reading barcodes',
  matching: 'Matching names',
  done: 'Done',
}

function toRaw(bitmap: ImageBitmap, longEdge: number): { raw: RawImage; scale: number } {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  return { raw: { data: d.data, width: w, height: h }, scale }
}

export interface ScannedPhoto {
  blob: Blob
  width: number
  height: number
  result: ScanResult
}

/**
 * Full pipeline for one photo: decode (EXIF-corrected) -> working copies -> text + barcode
 * readers in parallel -> grouping/matching. Falls back to Tesseract if the main reader fails.
 */
export async function scanPhoto(
  file: Blob,
  photoIndex: number,
  mode: ScanMode,
  onProgress: (p: ScanProgress) => void,
): Promise<ScannedPhoto> {
  const t0 = performance.now()
  const report = (stage: ScanStage, fraction: number) =>
    onProgress({ stage, label: LABEL[stage], fraction })
  report('preparing', 0.02)

  const bitmap = await decodeImage(file)
  const work = toRaw(bitmap, mode === 'thorough' ? 2000 : 1600)
  // Barcodes need native resolution: a DataMatrix is only a few millimetres wide.
  const bar = toRaw(bitmap, mode === 'thorough' ? 4000 : 3000)
  const previewCanvas = new OffscreenCanvas(work.raw.width, work.raw.height)
  previewCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, work.raw.width, work.raw.height)
  const preview = await previewCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  bitmap.close()

  const matcherPromise = createMatcher()
  const barcodePromise = reader.runBarcodes(bar.raw, mode).catch(() => []) // barcodes are a bonus: never block the scan
  barcodePromise.then(() => report('barcodes', 0.9))

  let regions: TextRegion[]
  let engine: ScanResult['engine'] = 'paddleocr'
  let detectMs: number | undefined
  let readMs: number | undefined
  const unsub = reader.subscribe((s) => {
    if (s.status === 'downloading') report('loading', 0.05 + 0.4 * (s.loaded / s.total))
    else if (s.status === 'starting') report('loading', 0.45)
  })
  try {
    const out = await reader.runOcr(work.raw, mode, (stage, done, total) => {
      if (stage === 'detecting') report('finding', 0.5 + 0.15 * (done / total))
      else report('reading', 0.65 + 0.25 * (done / total))
    })
    regions = out.regions
    detectMs = out.timings.detectMs
    readMs = out.timings.readMs
  } catch {
    // The ONNX reader could not load or run (old browser, blocked WASM, low memory).
    engine = 'tesseract'
    report('reading', 0.55)
    regions = await runTesseract(work.raw, mode === 'thorough', (d, t) =>
      report('reading', 0.55 + 0.35 * (d / t)),
    )
  } finally {
    unsub()
  }

  report('matching', 0.93)
  const codes = (await barcodePromise).map((c) => ({
    ...c,
    // Barcode hits are in the high-resolution copy; bring them into working-image coordinates.
    polygon: c.polygon.map((p) => ({
      x: (p.x / bar.raw.width) * work.raw.width,
      y: (p.y / bar.raw.height) * work.raw.height,
    })),
  }))
  const matcher = await matcherPromise
  const known = new Map<string, { canonical: string }>()
  for (const a of await db.aliases.where('key').startsWith('gtin:').toArray())
    known.set(a.key.slice(5), { canonical: a.canonical })
  const { candidates, unlinkedCodes } = analyze(regions, codes, matcher, photoIndex, known)
  report('done', 1)

  return {
    blob: preview,
    width: work.raw.width,
    height: work.raw.height,
    result: {
      candidates,
      unlinkedCodes,
      barcodes: codes,
      engine,
      timings: { totalMs: performance.now() - t0, detectMs, readMs },
      width: work.raw.width,
      height: work.raw.height,
    },
  }
}

/** OCR a user-drawn region of a photo ("Missed one?"). Returns a candidate or null. */
export async function readRegion(
  photo: Blob,
  region: { x: number; y: number; w: number; h: number },
  photoIndex: number,
): Promise<Candidate | null> {
  const bmp = await decodeImage(photo)
  const pad = 6
  const x = Math.max(0, Math.floor(region.x - pad))
  const y = Math.max(0, Math.floor(region.y - pad))
  const w = Math.min(bmp.width - x, Math.ceil(region.w + 2 * pad))
  const h = Math.min(bmp.height - y, Math.ceil(region.h + 2 * pad))
  const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h)
  bmp.close()
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const raw: RawImage = { data: d.data, width: canvas.width, height: canvas.height }
  let regions: TextRegion[]
  try {
    regions = (await reader.runOcr(raw, 'thorough')).regions
  } catch {
    regions = await runTesseract(raw, false)
  }
  const matcher = await createMatcher()
  const { candidates } = analyze(regions, [], matcher, photoIndex)
  // Everything the user boxed is one package: merge whatever came back into the best candidate.
  const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0]
  if (!best) return null
  best.quad = scaleQuad(
    [
      { x: region.x, y: region.y },
      { x: region.x + region.w, y: region.y },
      { x: region.x + region.w, y: region.y + region.h },
      { x: region.x, y: region.y + region.h },
    ],
    1,
  )
  best.source = 'manual'
  best.needsCheck = true
  return best
}

/** Stores a cropped photo of one package and returns its photo id. */
export async function saveCrop(photo: Blob, quad: Candidate['quad']): Promise<number | undefined> {
  try {
    const bmp = await decodeImage(photo)
    const xs = quad.map((p) => p.x)
    const ys = quad.map((p) => p.y)
    const pad = 12
    const x = Math.max(0, Math.floor(Math.min(...xs) - pad))
    const y = Math.max(0, Math.floor(Math.min(...ys) - pad))
    const w = Math.min(bmp.width - x, Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * pad))
    const h = Math.min(bmp.height - y, Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * pad))
    const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h))
    canvas.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h)
    bmp.close()
    return await savePhoto(canvas)
  } catch {
    return undefined // a missing thumbnail must never block adding the medicine
  }
}
