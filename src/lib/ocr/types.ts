export interface Pt {
  x: number
  y: number
}

/** Corners in reading order: top-left, top-right, bottom-right, bottom-left (text runs tl -> tr). */
export type Quad = [Pt, Pt, Pt, Pt]

/** Straight (non-premultiplied) RGBA pixels, row-major. */
export interface RawImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface TextRegion {
  quad: Quad
  text: string
  /** Recognition confidence 0..1 */
  score: number
}

export type ScanMode = 'fast' | 'thorough'

export type Stage = 'loading' | 'detecting' | 'reading' | 'matching' | 'barcodes' | 'done'
