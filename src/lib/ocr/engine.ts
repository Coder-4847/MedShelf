import { DEFAULT_DETECT, detectBoxes, type DetBox, type DetectOptions } from './detect'
import { overlap, quadToRect } from './geometry'
import { crop, resize, rotate180, rotate90, sampleQuad } from './image'
import type { Ort, Session } from './ort'
import {
  classifyCrop,
  recognizeCrop,
  REC_HEIGHT,
  type Dictionary,
  type Recognition,
} from './recognize'
import type { Quad, RawImage, ScanMode, TextRegion } from './types'

export interface EngineProgress {
  stage: 'detecting' | 'reading'
  done: number
  total: number
}

export interface OcrTimings {
  detectMs: number
  readMs: number
  boxes: number
  tiles: number
}

const TILE = 736
const TILE_OVERLAP = 0.25

export function tileOrigins(width: number, height: number, tile = TILE, overlap = TILE_OVERLAP) {
  const axis = (len: number) => {
    if (len <= tile) return [0]
    const stride = Math.round(tile * (1 - overlap))
    const out: number[] = []
    for (let p = 0; p + tile < len; p += stride) out.push(p)
    out.push(len - tile)
    return out
  }
  const xs = axis(width)
  const ys = axis(height)
  const tiles: { x: number; y: number; w: number; h: number }[] = []
  for (const y of ys)
    for (const x of xs) tiles.push({ x, y, w: Math.min(tile, width), h: Math.min(tile, height) })
  return tiles
}

/**
 * Removes duplicate detections coming from the full-image pass and overlapping tiles.
 * When two boxes cover the same text, the larger one wins (a box cut by a tile border
 * is always smaller than the whole line seen elsewhere).
 */
export function mergeBoxes(boxes: DetBox[]): DetBox[] {
  const sorted = [...boxes].sort((a, b) => area(b) - area(a))
  const kept: DetBox[] = []
  for (const b of sorted) {
    let dup = false
    for (const k of kept) {
      const o = overlap(b.quad, k.quad)
      if (o.iou > 0.35 || o.overA > 0.7) {
        dup = true
        break
      }
    }
    if (!dup) kept.push(b)
  }
  return kept
}

function area(b: DetBox) {
  const r = quadToRect(b.quad)
  return r.w * r.h
}

export class OcrEngine {
  constructor(
    private ort: Ort,
    private det: Session,
    private rec: Session,
    private cls: Session | null,
    private dict: Dictionary,
  ) {}

  async detect(
    img: RawImage,
    mode: ScanMode,
    onProgress?: (p: EngineProgress) => void,
    opts: Partial<DetectOptions> = {},
  ): Promise<{ boxes: DetBox[]; tiles: number }> {
    const base: DetectOptions = { ...DEFAULT_DETECT, ...opts }
    const tiles = mode === 'thorough' ? tileOrigins(img.width, img.height) : []
    const total = 1 + (tiles.length > 1 ? tiles.length : 0)
    let done = 0
    const all: DetBox[] = []
    const full = await detectBoxes(this.ort, this.det, img, {
      ...base,
      limitSide: mode === 'thorough' ? Math.max(base.limitSide, 1280) : base.limitSide,
    })
    all.push(...full)
    onProgress?.({ stage: 'detecting', done: ++done, total })
    if (tiles.length > 1) {
      for (const t of tiles) {
        const sub = crop(img, t.x, t.y, t.w, t.h)
        const boxes = await detectBoxes(this.ort, this.det, sub, { ...base, limitSide: TILE })
        for (const b of boxes) {
          all.push({ ...b, quad: b.quad.map((p) => ({ x: p.x + t.x, y: p.y + t.y })) as Quad })
        }
        onProgress?.({ stage: 'detecting', done: ++done, total })
      }
    }
    return { boxes: mergeBoxes(all), tiles: tiles.length }
  }

  /** Recognises text in one detected box, handling upside-down and sideways text. */
  async readBox(img: RawImage, quad: Quad): Promise<TextRegion | null> {
    const r = quadToRect(quad)
    if (r.h < 6 || r.w < 6) return null
    const outW = Math.max(16, Math.min(960, Math.round((REC_HEIGHT * r.w) / r.h)))
    let line = sampleQuad(img, quad, outW, REC_HEIGHT)

    let flipped = false
    if (this.cls) {
      const c = await classifyCrop(this.ort, this.cls, line)
      if (c.flip && c.score > 0.9) {
        line = rotate180(line)
        flipped = true
      }
    }
    let best: Recognition = await recognizeCrop(this.ort, this.rec, this.dict, line)

    // Low confidence: the classifier can be wrong on short strings. Try the other orientation(s).
    if (best.score < 0.85) {
      const candidates: { line: RawImage; flipped: boolean }[] = [
        { line: rotate180(line), flipped: !flipped },
      ]
      // Near-square boxes (single words like "mg", or text on its side) may be rotated by 90 degrees.
      if (r.w / r.h < 1.8) {
        const turned = rotate90(line)
        const side =
          turned.height === REC_HEIGHT
            ? turned
            : resize(
                turned,
                Math.max(16, Math.round((REC_HEIGHT * turned.width) / turned.height)),
                REC_HEIGHT,
              )
        candidates.push({ line: side, flipped }, { line: rotate180(side), flipped: !flipped })
      }
      for (const c of candidates) {
        const res = await recognizeCrop(this.ort, this.rec, this.dict, c.line)
        if (res.score > best.score + 0.02 && res.text.length >= best.text.length - 1) {
          best = res
          flipped = c.flipped
        }
      }
    }
    if (!best.text) return null
    const q: Quad = flipped ? [quad[2], quad[3], quad[0], quad[1]] : quad
    return { quad: q, text: best.text, score: best.score }
  }

  async read(
    img: RawImage,
    boxes: DetBox[],
    onProgress?: (p: EngineProgress) => void,
  ): Promise<TextRegion[]> {
    const out: TextRegion[] = []
    let done = 0
    for (const b of boxes) {
      const region = await this.readBox(img, b.quad)
      if (region) out.push(region)
      onProgress?.({ stage: 'reading', done: ++done, total: boxes.length })
    }
    return out
  }

  async run(
    img: RawImage,
    mode: ScanMode,
    onProgress?: (p: EngineProgress) => void,
  ): Promise<{ regions: TextRegion[]; timings: OcrTimings }> {
    const t0 = performance.now()
    const { boxes, tiles } = await this.detect(img, mode, onProgress)
    const t1 = performance.now()
    const regions = await this.read(img, boxes, onProgress)
    const t2 = performance.now()
    return { regions, timings: { detectMs: t1 - t0, readMs: t2 - t1, boxes: boxes.length, tiles } }
  }
}
