import type { Quad, RawImage } from './types'

/** Bilinear resize of an RGBA image. */
export function resize(img: RawImage, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  // Box-filter by 2x2 taps when shrinking a lot, to limit aliasing.
  const taps = Math.max(sx, sy) > 1.8 ? 2 : 1
  const src = img.data
  const W = img.width
  const H = img.height
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          const fx = Math.min(W - 1, Math.max(0, (x + (tx + 0.5) / taps) * sx - 0.5))
          const fy = Math.min(H - 1, Math.max(0, (y + (ty + 0.5) / taps) * sy - 0.5))
          const x0 = fx | 0
          const y0 = fy | 0
          const x1 = Math.min(W - 1, x0 + 1)
          const y1 = Math.min(H - 1, y0 + 1)
          const ax = fx - x0
          const ay = fy - y0
          const i00 = (y0 * W + x0) * 4
          const i10 = (y0 * W + x1) * 4
          const i01 = (y1 * W + x0) * 4
          const i11 = (y1 * W + x1) * 4
          const w00 = (1 - ax) * (1 - ay)
          const w10 = ax * (1 - ay)
          const w01 = (1 - ax) * ay
          const w11 = ax * ay
          r += src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11
          g += src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11
          b += src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
          a += src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11
        }
      }
      const n = taps * taps
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { data: out, width: w, height: h }
}

export function crop(img: RawImage, x0: number, y0: number, w: number, h: number): RawImage {
  const cx0 = Math.max(0, Math.floor(x0))
  const cy0 = Math.max(0, Math.floor(y0))
  const cw = Math.min(img.width - cx0, Math.ceil(w))
  const ch = Math.min(img.height - cy0, Math.ceil(h))
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const s = ((cy0 + y) * img.width + cx0) * 4
    out.set(img.data.subarray(s, s + cw * 4), y * cw * 4)
  }
  return { data: out, width: cw, height: ch }
}

/**
 * Warps the parallelogram described by `quad` (tl, tr, br, bl) into an upright
 * `outW` x `outH` image: the deskewed crop fed to the recogniser.
 */
export function sampleQuad(img: RawImage, quad: Quad, outW: number, outH: number): RawImage {
  const [tl, tr, , bl] = quad
  const ux = (tr.x - tl.x) / outW
  const uy = (tr.y - tl.y) / outW
  const vx = (bl.x - tl.x) / outH
  const vy = (bl.y - tl.y) / outH
  const srcLen = Math.hypot(tr.x - tl.x, tr.y - tl.y) / outW
  const taps = srcLen > 1.8 ? 2 : 1
  const out = new Uint8ClampedArray(outW * outH * 4)
  const W = img.width
  const H = img.height
  const src = img.data
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          const dx = x + (tx + 0.5) / taps
          const dy = y + (ty + 0.5) / taps
          const fx = Math.min(W - 1, Math.max(0, tl.x + ux * dx + vx * dy - 0.5))
          const fy = Math.min(H - 1, Math.max(0, tl.y + uy * dx + vy * dy - 0.5))
          const x0 = fx | 0
          const y0 = fy | 0
          const x1 = Math.min(W - 1, x0 + 1)
          const y1 = Math.min(H - 1, y0 + 1)
          const ax = fx - x0
          const ay = fy - y0
          const i00 = (y0 * W + x0) * 4
          const i10 = (y0 * W + x1) * 4
          const i01 = (y1 * W + x0) * 4
          const i11 = (y1 * W + x1) * 4
          const w00 = (1 - ax) * (1 - ay)
          const w10 = ax * (1 - ay)
          const w01 = (1 - ax) * ay
          const w11 = ax * ay
          r += src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11
          g += src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11
          b += src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
        }
      }
      const n = taps * taps
      const o = (y * outW + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  }
  return { data: out, width: outW, height: outH }
}

export function rotate180(img: RawImage): RawImage {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < w * h; i++) {
    const j = w * h - 1 - i
    out[j * 4] = img.data[i * 4]
    out[j * 4 + 1] = img.data[i * 4 + 1]
    out[j * 4 + 2] = img.data[i * 4 + 2]
    out[j * 4 + 3] = img.data[i * 4 + 3]
  }
  return { data: out, width: w, height: h }
}

/** Rotates 90 degrees clockwise. */
export function rotate90(img: RawImage): RawImage {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = (x * h + (h - 1 - y)) * 4
      out[d] = img.data[s]
      out[d + 1] = img.data[s + 1]
      out[d + 2] = img.data[s + 2]
      out[d + 3] = img.data[s + 3]
    }
  }
  return { data: out, width: h, height: w }
}

/**
 * RGBA -> planar float32 CHW in BGR order (the order PaddleOCR models were trained with).
 * `padToW` pads the right edge with zeros (after normalisation) for fixed-width inputs.
 */
export function toBgrTensor(
  img: RawImage,
  mean: [number, number, number],
  std: [number, number, number],
  padToW = img.width,
): Float32Array {
  const { width: w, height: h } = img
  const plane = h * padToW
  const out = new Float32Array(3 * plane)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * padToW + x
      out[o] = (img.data[i + 2] / 255 - mean[0]) / std[0]
      out[plane + o] = (img.data[i + 1] / 255 - mean[1]) / std[1]
      out[2 * plane + o] = (img.data[i] / 255 - mean[2]) / std[2]
    }
  }
  return out
}
