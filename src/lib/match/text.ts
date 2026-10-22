/** Lowercases, strips accents and punctuation; "Cold & Flu" -> "cold and flu". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Collapses characters OCR commonly confuses so "Pana d0l" and "Panadol" compare equal.
 * Only used as a secondary comparison with a small penalty.
 */
export function skeleton(s: string): string {
  return s
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[01!|]/g, (c) => (c === '0' ? 'o' : 'l'))
    .replace(/i/g, 'l')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/2/g, 'z')
    .replace(/\s+/g, '')
}

export function levenshtein(a: string, b: string, maxDist = Infinity): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDist) return maxDist + 1
  if (!la) return lb
  if (!lb) return la
  let prev = new Array<number>(lb + 1)
  let cur = new Array<number>(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    let rowMin = cur[0]
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      let v = prev[j - 1] + cost
      if (prev[j] + 1 < v) v = prev[j] + 1
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > maxDist) return maxDist + 1
    ;[prev, cur] = [cur, prev]
  }
  return prev[lb]
}

/** 1 = identical, 0 = nothing in common. */
export function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  const d = levenshtein(a, b, Math.ceil(max * 0.5))
  return Math.max(0, 1 - d / max)
}

const NUMERIC_TOKEN = /^\d+([.,]\d+)?(mg|mcg|ug|g|kg|ml|l|iu|u|mmol|meq)?$/
const UNIT_TOKEN = /^(mg|mcg|ug|g|kg|ml|l|iu|u|mmol|meq|x)$/

/** Words that appear on every box and must never be treated as a medicine name. */
export const LABEL_WORDS = new Set([
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'caps',
  'film',
  'coated',
  'each',
  'contains',
  'contain',
  'store',
  'below',
  'keep',
  'out',
  'reach',
  'children',
  'child',
  'oral',
  'use',
  'uses',
  'dose',
  'dosage',
  'for',
  'and',
  'the',
  'with',
  'see',
  'leaflet',
  'inside',
  'batch',
  'lot',
  'exp',
  'expiry',
  'date',
  'mfg',
  'manufactured',
  'by',
  'made',
  'in',
  'uae',
  'price',
  'aed',
  'pack',
  'syrup',
  'suspension',
  'solution',
  'cream',
  'gel',
  'ointment',
  'drops',
  'spray',
  'injection',
  'sachet',
  'sachets',
  'lozenges',
  'net',
  'content',
  'ml',
  'mg',
  'ph',
  'pharma',
  'pharmaceuticals',
  'pharmaceutical',
  'limited',
  'ltd',
  'inc',
  'co',
  'company',
  'prescription',
  'only',
  'medicine',
  'medicines',
  'adults',
  'adult',
  'kids',
  'warning',
  'caution',
  'sugar',
  'free',
  'sterile',
  'external',
  'topical',
  'nasal',
  'eye',
  'ear',
])

/** Alphabetic tokens of a text with numbers and units removed ("Panadol 500 mg" -> ["panadol"]). */
export function wordTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t && !NUMERIC_TOKEN.test(t) && !UNIT_TOKEN.test(t))
}

/** Key used for learned aliases: the alphabetic words only, so strength changes don't matter. */
export function aliasKey(text: string): string {
  return wordTokens(text).join(' ')
}
