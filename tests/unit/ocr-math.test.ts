import { describe, expect, it } from 'vitest'
import { dbPostprocess } from '../../src/lib/ocr/detect'
import {
  clipConvex,
  convexHull,
  minAreaRect,
  overlap,
  polyArea,
  polyDistance,
  rectToQuad,
  quadToRect,
} from '../../src/lib/ocr/geometry'
import { mergeBoxes, tileOrigins } from '../../src/lib/ocr/engine'
import { buildDictionary, ctcDecode } from '../../src/lib/ocr/recognize'
import { crop, resize, rotate180, rotate90, sampleQuad } from '../../src/lib/ocr/image'
import type { Quad, RawImage, TextRegion } from '../../src/lib/ocr/types'
import { clusterLines, toLines } from '../../src/lib/scan/group'
import { groupIntoCandidates } from '../../src/lib/scan/candidates'
import { DrugMatcher, type DrugEntry } from '../../src/lib/match/matcher'
import drugs from '../../src/data/drugs.json'

const rectQuad = (cx: number, cy: number, w: number, h: number, deg = 0): Quad =>
  rectToQuad({ cx, cy, w, h, angle: (deg * Math.PI) / 180 })
const region = (text: string, q: Quad, score = 0.95): TextRegion => ({ text, quad: q, score })

describe('geometry', () => {
  it('finds the minimum-area rectangle of a rotated box', () => {
    const q = rectQuad(100, 80, 60, 20, 30)
    const r = minAreaRect(convexHull(q))
    expect(r.w).toBeCloseTo(60, 3)
    expect(r.h).toBeCloseTo(20, 3)
    expect(r.angle).toBeCloseTo((30 * Math.PI) / 180, 3)
  })
  it('round-trips quads and rects', () => {
    const r = quadToRect(rectQuad(10, 20, 50, 10, -20))
    expect(r).toMatchObject({
      cx: expect.closeTo(10, 6),
      cy: expect.closeTo(20, 6),
      w: expect.closeTo(50, 6),
      h: expect.closeTo(10, 6),
    })
  })
  it('computes polygon overlap', () => {
    const a = rectQuad(0, 0, 10, 10)
    const b = rectQuad(5, 0, 10, 10)
    expect(overlap(a, b).iou).toBeCloseTo(1 / 3, 5)
    expect(polyArea(clipConvex(a, b))).toBeCloseTo(50, 5)
    expect(overlap(a, rectQuad(100, 100, 10, 10)).iou).toBe(0)
  })
  it('measures distance between boxes', () => {
    expect(polyDistance(rectQuad(0, 0, 10, 10), rectQuad(25, 0, 10, 10))).toBeCloseTo(15, 5)
    expect(polyDistance(rectQuad(0, 0, 10, 10), rectQuad(5, 0, 10, 10))).toBe(0)
  })
})

describe('DB post-processing', () => {
  it('turns a probability blob into a grown rotated box and drops weak ones', () => {
    const w = 200
    const h = 100
    const prob = new Float32Array(w * h)
    for (let y = 40; y < 52; y++) for (let x = 30; x < 130; x++) prob[y * w + x] = 0.9 // strong text line
    for (let y = 10; y < 20; y++) for (let x = 150; x < 190; x++) prob[y * w + x] = 0.35 // above threshold but low score
    const boxes = dbPostprocess(prob, w, h, { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.6 })
    expect(boxes).toHaveLength(1)
    const b = boxes[0].rect
    expect(b.w).toBeGreaterThan(100) // grown beyond the 100px kernel
    expect(b.cx).toBeCloseTo(80, 0)
    expect(b.cy).toBeCloseTo(46, 0)
  })
})

describe('CTC decoding', () => {
  const dict = buildDictionary('a\nb\nc\n中\n')
  it('adds blank and space classes and masks non-Latin characters', () => {
    expect(dict.chars).toEqual(['', 'a', 'b', 'c', '中', ' '])
    expect([...dict.allowed]).toEqual([1, 1, 1, 1, 0, 1])
  })
  it('collapses repeats, removes blanks and scores by mean probability', () => {
    const C = 6
    const step = (c: number, p = 0.9) => {
      const row = new Array<number>(C).fill((1 - p) / (C - 1))
      row[c] = p
      return row
    }
    // a a blank b b c  -> "abc"
    const logits = new Float32Array([
      ...step(1),
      ...step(1),
      ...step(0),
      ...step(2),
      ...step(2),
      ...step(3),
    ])
    const r = ctcDecode(logits, 6, C, dict)
    expect(r.text).toBe('abc')
    expect(r.score).toBeCloseTo(0.9, 5)
  })
  it('never emits a masked class even when it is the argmax', () => {
    const C = 6
    const row = new Array<number>(C).fill(0.01)
    row[4] = 0.9
    row[1] = 0.05
    expect(ctcDecode(new Float32Array(row), 1, C, dict).text).toBe('a')
  })
})

describe('image ops', () => {
  const img = (w: number, h: number, f: (x: number, y: number) => number): RawImage => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data.set([f(x, y), 0, 0, 255], (y * w + x) * 4)
    return { data, width: w, height: h }
  }
  it('rotates and crops', () => {
    const a = img(4, 2, (x, y) => x * 10 + y)
    expect(rotate180(a).data[0]).toBe(31)
    expect(rotate90(a)).toMatchObject({ width: 2, height: 4 })
    expect(crop(a, 1, 0, 2, 2).width).toBe(2)
    expect(resize(a, 8, 4)).toMatchObject({ width: 8, height: 4 })
  })
  it('deskews a rotated quad into an upright crop', () => {
    // A horizontal gradient rotated 90 degrees: sampling along the quad must recover it.
    const src = img(100, 100, (x) => (x < 50 ? 0 : 200))
    const out = sampleQuad(
      src,
      [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 40 },
        { x: 20, y: 40 },
      ],
      60,
      20,
    )
    expect(out.data[0]).toBe(0)
    expect(out.data[59 * 4]).toBe(200)
  })
})

describe('tiling and merging', () => {
  it('covers the whole image with overlapping tiles', () => {
    const tiles = tileOrigins(2000, 1500, 736, 0.25)
    expect(tiles.length).toBeGreaterThan(4)
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(2000)
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBe(1500)
    expect(tileOrigins(500, 400)).toHaveLength(1)
  })
  it('keeps the larger of two boxes covering the same text', () => {
    const whole = { quad: rectQuad(100, 50, 200, 30), score: 0.9 }
    const cut = { quad: rectQuad(60, 50, 100, 30), score: 0.9 }
    const other = { quad: rectQuad(400, 300, 100, 30), score: 0.9 }
    const merged = mergeBoxes([cut, whole, other])
    expect(merged).toHaveLength(2)
    expect(merged.some((m) => quadToRect(m.quad).w > 150)).toBe(true)
  })
})

describe('grouping into candidates', () => {
  const matcher = new DrugMatcher(drugs as DrugEntry[])
  it('groups a package, extracts details, and flags unknown names', () => {
    const regions = [
      region('Panadol', rectQuad(200, 100, 200, 60)),
      region('500mg', rectQuad(150, 170, 100, 36)),
      region('24 tablets', rectQuad(150, 210, 110, 24)),
      region('Zentora', rectQuad(900, 600, 200, 60)),
      region('10mg', rectQuad(860, 670, 90, 36)),
    ]
    const cands = groupIntoCandidates(regions, matcher, 0)
    expect(cands).toHaveLength(2)
    const pan = cands.find((c) => c.name === 'Panadol')!
    expect(pan).toMatchObject({
      strength: '500 mg',
      form: 'Tablet',
      packSize: '24 tablets',
      needsCheck: false,
    })
    const unk = cands.find((c) => c.name === 'Zentora')!
    expect(unk.needsCheck).toBe(true)
    expect(unk.confidence).toBeLessThan(0.6)
    expect(unk.matchedEntry).toBeUndefined()
  })
  it('splits two different recognised drugs placed side by side', () => {
    const regions = [
      region('Cetirizine', rectQuad(100, 100, 200, 50)),
      region('Atorvastatin', rectQuad(100, 220, 220, 50)),
    ]
    expect(groupIntoCandidates(regions, matcher, 0)).toHaveLength(2)
  })
  it('never presents a fuzzy name match as confident', () => {
    const [c] = groupIntoCandidates([region('Zithromaz', rectQuad(100, 100, 200, 50))], matcher, 0)
    expect(c.name).toBe('Zithromax')
    expect(c.needsCheck).toBe(true)
    expect(c.confidence).toBeLessThan(0.8)
  })
  it('ignores boilerplate-only text and respects angle between parallel lines', () => {
    const noise = [region('Keep out of reach of children', rectQuad(100, 100, 300, 14))]
    expect(groupIntoCandidates(noise, matcher, 0)).toHaveLength(0)
    const lines = toLines([
      region('Alpha', rectQuad(100, 100, 100, 30, 0)),
      region('Beta', rectQuad(100, 150, 100, 30, 60)),
    ])
    expect(clusterLines(lines)).toHaveLength(2)
  })
})
