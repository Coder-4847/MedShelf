import { resize as resizeTo, toBgrTensor } from './image'
import type { Ort, Session } from './ort'
import type { RawImage } from './types'

export interface Dictionary {
  /** chars[0] is the CTC blank. */
  chars: string[]
  /** 1 where the class may be emitted. Blank is always allowed. */
  allowed: Uint8Array
}

const LATIN =
  /^[A-Za-z0-9 .,:;%+\-/()&'"!?#@*=_<>[\]µ°²³½ØÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ]$/

/**
 * Builds the CTC character table from PaddleOCR's dictionary file and restricts decoding to
 * Latin letters, digits and common label punctuation. The bundled model also knows thousands
 * of CJK characters; masking them stops noise being "read" as Chinese.
 */
export function buildDictionary(fileText: string, outputClasses?: number): Dictionary {
  const lines = fileText.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines[lines.length - 1] === '') lines.pop()
  const chars = ['', ...lines]
  // PaddleOCR appends a space class (use_space_char) after the dictionary.
  if (outputClasses === undefined || outputClasses > chars.length) chars.push(' ')
  const allowed = new Uint8Array(chars.length)
  allowed[0] = 1
  for (let i = 1; i < chars.length; i++) allowed[i] = LATIN.test(chars[i]) ? 1 : 0
  return { chars, allowed }
}

export interface Recognition {
  text: string
  /** Mean per-character probability, 0..1 */
  score: number
}

export function ctcDecode(
  logits: Float32Array,
  steps: number,
  classes: number,
  dict: Dictionary,
): Recognition {
  // Some exports emit raw logits, others softmax probabilities.
  let rowSum = 0
  for (let c = 0; c < classes; c++) rowSum += logits[c]
  const isProb = Math.abs(rowSum - 1) < 0.05

  let text = ''
  let scoreSum = 0
  let n = 0
  let prev = -1
  for (let t = 0; t < steps; t++) {
    const base = t * classes
    let best = 0
    let bestV = -Infinity
    for (let c = 0; c < classes; c++) {
      if (!dict.allowed[c]) continue
      const v = logits[base + c]
      if (v > bestV) {
        bestV = v
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      let p = bestV
      if (!isProb) {
        let max = -Infinity
        for (let c = 0; c < classes; c++) if (logits[base + c] > max) max = logits[base + c]
        let denom = 0
        for (let c = 0; c < classes; c++) denom += Math.exp(logits[base + c] - max)
        p = Math.exp(bestV - max) / denom
      }
      text += dict.chars[best] ?? ''
      scoreSum += p
      n++
    }
    prev = best
  }
  return { text: text.trim(), score: n ? scoreSum / n : 0 }
}

const REC_H = 48

/** Recognises one upright text-line crop (any width; height is resized to 48 by the caller). */
export async function recognizeCrop(
  ort: Ort,
  session: Session,
  dict: Dictionary,
  crop: RawImage,
): Promise<Recognition> {
  const data = toBgrTensor(crop, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
  const input = new ort.Tensor('float32', data, [1, 3, REC_H, crop.width])
  const out = await session.run({ [session.inputNames[0]]: input })
  const o = out[session.outputNames[0]]
  const steps = o.dims[1]
  const classes = o.dims[2]
  return ctcDecode(o.data as Float32Array, steps, classes, dict)
}

export const REC_HEIGHT = REC_H

/** Angle classifier: is this crop upside down? */
export async function classifyCrop(
  ort: Ort,
  session: Session,
  crop: RawImage,
): Promise<{ flip: boolean; score: number }> {
  // The classifier wants 3x48x192: resize keeps aspect, then pad right.
  const w = Math.min(192, Math.max(8, Math.round((REC_H * crop.width) / crop.height)))
  const resized = crop.height === REC_H && crop.width === w ? crop : resizeTo(crop, w, REC_H)
  const data = toBgrTensor(resized, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], 192)
  const input = new ort.Tensor('float32', data, [1, 3, REC_H, 192])
  const out = await session.run({ [session.inputNames[0]]: input })
  const p = out[session.outputNames[0]].data as Float32Array
  return { flip: p[1] > p[0], score: Math.max(p[0], p[1]) }
}
