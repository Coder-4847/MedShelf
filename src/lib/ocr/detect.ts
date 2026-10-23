import { expandRect, minAreaRect, rectToQuad, scaleQuad, type RotRect } from './geometry'
import { resize, toBgrTensor } from './image'
import type { Ort, Session } from './ort'
import type { Pt, Quad, RawImage } from './types'

export interface DetectOptions {
  /** Longest side fed to the network (image is only ever shrunk to this, never enlarged). */
  limitSide: number
  /** Probability threshold for the binary map. */
  thresh: number
  /** Minimum mean probability inside a box. */
  boxThresh: number
  /** DB unclip ratio: how far to grow shrunken text kernels back out. */
  unclipRatio: number
}

export const DEFAULT_DETECT: DetectOptions = {
  limitSide: 960,
  thresh: 0.3,
  boxThresh: 0.55,
  unclipRatio: 1.7,
}

export interface DetBox {
  quad: Quad
  score: number
}

/**
 * DB post-processing: threshold the probability map, label 8-connected components,
 * fit a minimum-area rectangle to each, score it, and grow it back out ("unclip").
 * Coordinates are in map pixels.
 */
export function dbPostprocess(
  prob: Float32Array,
  w: number,
  h: number,
  opts: Pick<DetectOptions, 'thresh' | 'boxThresh' | 'unclipRatio'>,
): { rect: RotRect; score: number }[] {
  const visited = new Uint8Array(w * h)
  const results: { rect: RotRect; score: number }[] = []
  const stack = new Int32Array(w * h)
  const isFg = (i: number) => prob[i] > opts.thresh

  for (let start = 0; start < w * h; start++) {
    if (visited[start] || !isFg(start)) continue
    // Flood fill (8-connectivity) collecting stats and boundary pixels.
    let sp = 0
    stack[sp++] = start
    visited[start] = 1
    let count = 0
    let sum = 0
    const boundary: Pt[] = []
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w
      const y = (i / w) | 0
      count++
      sum += prob[i]
      let edge = false
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            edge = true
            continue
          }
          const ni = ny * w + nx
          if (!isFg(ni)) {
            if (dx === 0 || dy === 0) edge = true
            continue
          }
          if (!visited[ni]) {
            visited[ni] = 1
            stack[sp++] = ni
          }
        }
      }
      if (edge) boundary.push({ x: x + 0.5, y: y + 0.5 })
    }
    if (count < 10) continue
    const score = sum / count
    if (score < opts.boxThresh) continue
    const rect = minAreaRect(boundary)
    if (rect.h < 3) continue
    const d = (rect.w * rect.h * opts.unclipRatio) / (2 * (rect.w + rect.h))
    const grown = expandRect(rect, d)
    if (grown.h < 5) continue
    results.push({ rect: grown, score })
  }
  return results
}

/** Runs the detector on `img`, returning boxes in the coordinates of `img`. */
export async function detectBoxes(
  ort: Ort,
  session: Session,
  img: RawImage,
  opts: DetectOptions = DEFAULT_DETECT,
): Promise<DetBox[]> {
  const scale = Math.min(1, opts.limitSide / Math.max(img.width, img.height))
  const nw = Math.max(32, Math.round((img.width * scale) / 32) * 32)
  const nh = Math.max(32, Math.round((img.height * scale) / 32) * 32)
  const resized = nw === img.width && nh === img.height ? img : resize(img, nw, nh)
  const data = toBgrTensor(resized, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
  const input = new ort.Tensor('float32', data, [1, 3, nh, nw])
  const feeds: Record<string, typeof input> = { [session.inputNames[0]]: input }
  const out = await session.run(feeds)
  const map = out[session.outputNames[0]]
  const prob = map.data as Float32Array
  const mh = map.dims[map.dims.length - 2]
  const mw = map.dims[map.dims.length - 1]
  const found = dbPostprocess(prob, mw, mh, opts)
  const sx = img.width / mw
  const sy = img.height / mh
  return found.map(({ rect, score }) => ({ quad: scaleQuad(rectToQuad(rect), sx, sy), score }))
}
