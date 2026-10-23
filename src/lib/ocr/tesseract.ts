import type { Quad, RawImage, TextRegion } from './types'

/**
 * Fallback reader used when the PaddleOCR models cannot load or run on a device.
 * Tesseract reads upright text only, so the photo is tried at 0/90/180/270 degrees in
 * thorough mode (0 only in fast mode). Accuracy is lower than the main reader.
 */
const base = import.meta.env.BASE_URL

function toCanvas(img: RawImage): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0,
  )
  return c
}

function rotated(src: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  if (quarterTurns === 0) return src
  const swap = quarterTurns % 2 === 1
  const c = document.createElement('canvas')
  c.width = swap ? src.height : src.width
  c.height = swap ? src.width : src.height
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((quarterTurns * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

/** Maps a point in the rotated canvas back to the original image. */
function unrotate(x: number, y: number, turns: number, w: number, h: number) {
  switch (turns) {
    case 1:
      return { x: y, y: h - x }
    case 2:
      return { x: w - x, y: h - y }
    case 3:
      return { x: w - y, y: x }
    default:
      return { x, y }
  }
}

export async function runTesseract(
  img: RawImage,
  thorough: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<TextRegion[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}vendor/tesseract/worker.min.js`,
    corePath: `${base}vendor/tesseract/core`,
    langPath: `${base}vendor/tesseract/lang`,
    gzip: true,
    workerBlobURL: false,
  })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' as never }) // sparse text
    const src = toCanvas(img)
    const turnsList = thorough ? [0, 1, 2, 3] : [0]
    const regions: TextRegion[] = []
    let done = 0
    for (const turns of turnsList) {
      const canvas = rotated(src, turns)
      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const text = line.text.trim()
            if (!text || line.confidence < 55) continue
            const { x0, y0, x1, y1 } = line.bbox
            const pts = [
              unrotate(x0, y0, turns, img.width, img.height),
              unrotate(x1, y0, turns, img.width, img.height),
              unrotate(x1, y1, turns, img.width, img.height),
              unrotate(x0, y1, turns, img.width, img.height),
            ]
            // Keep reading order tl->tr along the text direction for the rotated pass.
            const quad: Quad = (
              turns === 0
                ? pts
                : turns === 2
                  ? [pts[2], pts[3], pts[0], pts[1]]
                  : turns === 1
                    ? [pts[3], pts[0], pts[1], pts[2]]
                    : [pts[1], pts[2], pts[3], pts[0]]
            ) as Quad
            regions.push({ quad, text, score: line.confidence / 100 })
          }
        }
      }
      onProgress?.(++done, turnsList.length)
    }
    return dedupe(regions)
  } finally {
    await worker.terminate()
  }
}

/** The same text can be seen in more than one rotation; keep the most confident reading. */
function dedupe(regions: TextRegion[]): TextRegion[] {
  const out: TextRegion[] = []
  for (const r of regions.sort((a, b) => b.score - a.score)) {
    const c = centre(r)
    if (out.some((o) => Math.hypot(centre(o).x - c.x, centre(o).y - c.y) < 12)) continue
    out.push(r)
  }
  return out
}
const centre = (r: TextRegion) => ({
  x: r.quad.reduce((s, p) => s + p.x, 0) / 4,
  y: r.quad.reduce((s, p) => s + p.y, 0) / 4,
})
