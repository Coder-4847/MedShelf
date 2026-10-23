import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import * as ort from 'onnxruntime-web/wasm'
import { OcrEngine } from '../../src/lib/ocr/engine'
import { buildDictionary } from '../../src/lib/ocr/recognize'
import { resize } from '../../src/lib/ocr/image'
import type { Ort } from '../../src/lib/ocr/ort'
import type { RawImage, TextRegion } from '../../src/lib/ocr/types'

export const ROOT = join(__dirname, '../..')
export const FIXTURES = join(ROOT, 'tests/fixtures/scans')
export const OUT = join(ROOT, 'eval-output')
mkdirSync(OUT, { recursive: true })

export async function loadEngine(): Promise<OcrEngine> {
  ort.env.wasm.wasmPaths = join(ROOT, 'node_modules/onnxruntime-web/dist/')
  ort.env.wasm.numThreads = 1
  const create = (f: string) =>
    ort.InferenceSession.create(readFileSync(join(ROOT, 'public/models', f)), {
      executionProviders: ['wasm'],
    })
  const [det, rec, cls] = await Promise.all([
    create('ch_PP-OCRv4_det_infer.onnx'),
    create('ch_PP-OCRv4_rec_infer.onnx'),
    create('ch_ppocr_mobile_v2.0_cls_infer.onnx'),
  ])
  const dictText = readFileSync(join(ROOT, 'public/models/ppocr_keys_v1.txt'), 'utf8')
  const classes = rec.outputNames.length ? undefined : undefined
  void classes
  return new OcrEngine(ort as unknown as Ort, det, rec, cls, buildDictionary(dictText))
}

export async function loadRaw(file: string): Promise<RawImage> {
  const img = await loadImage(file)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height)
  return { data: d.data, width: img.width, height: img.height }
}

export function workImage(raw: RawImage, longEdge: number): { img: RawImage; scale: number } {
  const scale = Math.min(1, longEdge / Math.max(raw.width, raw.height))
  if (scale === 1) return { img: raw, scale }
  return { img: resize(raw, Math.round(raw.width * scale), Math.round(raw.height * scale)), scale }
}

export async function writeOverlay(
  file: string,
  raw: RawImage,
  scale: number,
  regions: TextRegion[],
  name: string,
) {
  const w = Math.round(raw.width * scale)
  const h = Math.round(raw.height * scale)
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  const src = createCanvas(raw.width, raw.height)
  src
    .getContext('2d')
    .putImageData(
      new (await import('@napi-rs/canvas')).ImageData(
        new Uint8ClampedArray(raw.data),
        raw.width,
        raw.height,
      ),
      0,
      0,
    )
  ctx.drawImage(src, 0, 0, w, h)
  ctx.lineWidth = 2
  ctx.font = '16px sans-serif'
  for (const r of regions) {
    ctx.strokeStyle = r.score > 0.8 ? '#00c853' : r.score > 0.5 ? '#ffab00' : '#d50000'
    ctx.beginPath()
    r.quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = '#000'
    ctx.fillRect(r.quad[0].x, r.quad[0].y - 16, Math.min(300, r.text.length * 9), 16)
    ctx.fillStyle = '#fff'
    ctx.fillText(r.text.slice(0, 32), r.quad[0].x + 2, r.quad[0].y - 3)
  }
  writeFileSync(join(OUT, `${name}.png`), c.toBuffer('image/png'))
  void file
}

export async function writeCandidateOverlay(
  name: string,
  raw: RawImage,
  gt: { quad: { x: number; y: number }[]; label: string }[],
  cands: { quad: { x: number; y: number }[]; label: string; check: boolean }[],
  regions: TextRegion[],
) {
  const { ImageData } = await import('@napi-rs/canvas')
  const c = createCanvas(raw.width, raw.height)
  const ctx = c.getContext('2d')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), 0, 0)
  const poly = (q: { x: number; y: number }[]) => {
    ctx.beginPath()
    q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  for (const r of regions) {
    poly(r.quad)
    ctx.stroke()
  }
  ctx.lineWidth = 3
  ctx.font = 'bold 20px sans-serif'
  for (const g of gt) {
    ctx.strokeStyle = '#2962ff'
    poly(g.quad)
    ctx.stroke()
    ctx.fillStyle = '#2962ff'
    ctx.fillText(g.label, g.quad[3].x + 4, g.quad[3].y - 6)
  }
  for (const k of cands) {
    ctx.strokeStyle = k.check ? '#ff6d00' : '#00c853'
    ctx.setLineDash([10, 6])
    poly(k.quad)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#000'
    ctx.fillRect(k.quad[0].x, k.quad[0].y - 22, Math.min(360, k.label.length * 11 + 8), 22)
    ctx.fillStyle = '#fff'
    ctx.fillText(k.label, k.quad[0].x + 4, k.quad[0].y - 5)
  }
  writeFileSync(join(OUT, `${name}.png`), c.toBuffer('image/png'))
}
