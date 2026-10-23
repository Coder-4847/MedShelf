import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'
import { interpretBarcode } from '../gs1/parse'
import { crop } from '../ocr/image'
import { tileOrigins } from '../ocr/engine'
import type { Pt, RawImage, ScanMode } from '../ocr/types'
import type { BarcodeHit } from '../scan/types'

/**
 * Must be called once before scanning. The WASM is always supplied by the caller so
 * zxing-wasm never falls back to its default CDN URL (the app makes no external requests).
 */
export function initBarcodeReader(wasmBinary: ArrayBuffer | Uint8Array) {
  prepareZXingModule({
    overrides: {
      wasmBinary:
        wasmBinary instanceof Uint8Array
          ? wasmBinary.buffer.slice(
              wasmBinary.byteOffset,
              wasmBinary.byteOffset + wasmBinary.byteLength,
            )
          : wasmBinary,
    } as never,
    fireImmediately: false,
  })
}

const OPTIONS: ReaderOptions = {
  formats: ['DataMatrix', 'Code128', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 24,
  textMode: 'Plain',
}

interface RawHit {
  format: string
  text: string
  symbologyIdentifier: string
  polygon: Pt[]
}

async function readOne(img: RawImage, dx = 0, dy = 0): Promise<RawHit[]> {
  const results = await readBarcodes(
    {
      data: img.data as Uint8ClampedArray,
      width: img.width,
      height: img.height,
      colorSpace: 'srgb',
    } as ImageData,
    OPTIONS,
  )
  return results
    .filter((r) => r.isValid)
    .map((r) => {
      // Raw bytes keep the GS (0x1D) group separators that GS1 parsing depends on.
      const text = r.bytes?.length ? String.fromCharCode(...r.bytes) : r.text
      const p = r.position
      return {
        format: r.format,
        text,
        symbologyIdentifier: r.symbologyIdentifier,
        polygon: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => ({
          x: q.x + dx,
          y: q.y + dy,
        })),
      }
    })
}

function center(poly: Pt[]): Pt {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  }
}

function size(poly: Pt[]): number {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

/**
 * Finds DataMatrix / linear barcodes in a (preferably high-resolution) photo. In thorough
 * mode the photo is also scanned in overlapping tiles at native resolution, so small codes
 * are not lost to downscaling. Returned coordinates are in `img` pixels.
 */
export async function scanBarcodes(
  img: RawImage,
  mode: ScanMode,
  onProgress?: (done: number, total: number) => void,
): Promise<BarcodeHit[]> {
  const raw: RawHit[] = []
  const tiles = mode === 'thorough' ? tileOrigins(img.width, img.height, 1100, 0.3) : []
  const total = 1 + (tiles.length > 1 ? tiles.length : 0)
  let done = 0
  raw.push(...(await readOne(img)))
  onProgress?.(++done, total)
  if (tiles.length > 1) {
    for (const t of tiles) {
      raw.push(...(await readOne(crop(img, t.x, t.y, t.w, t.h), t.x, t.y)))
      onProgress?.(++done, total)
    }
  }

  // De-duplicate hits of the same symbol seen by the full pass and by tiles.
  const unique: RawHit[] = []
  for (const h of raw) {
    const c = center(h.polygon)
    const s = size(h.polygon)
    if (
      unique.some(
        (u) =>
          u.text === h.text &&
          Math.hypot(center(u.polygon).x - c.x, center(u.polygon).y - c.y) <
            Math.max(s, size(u.polygon)),
      )
    )
      continue
    unique.push(h)
  }

  const hits: BarcodeHit[] = []
  for (const h of unique) {
    const parsed = interpretBarcode({
      format: h.format,
      text: h.text,
      symbologyIdentifier: h.symbologyIdentifier,
    })
    if (!parsed) continue // e.g. an unrelated QR code
    hits.push({
      id: hits.length,
      format: h.format,
      text: h.text,
      polygon: h.polygon,
      gtin: parsed.gtin,
      gtinValid: parsed.gtinValid,
      expiryDate: parsed.expiryDate,
      batch: parsed.batch,
      serial: parsed.serial,
    })
  }
  return hits
}
