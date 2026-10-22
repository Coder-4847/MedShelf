import { parseExpiryInput } from '../expiry'

export interface ExtractedDetails {
  strength?: string
  strengthAlternatives: string[]
  form?: string
  packSize?: string
  expiryText?: string
  expiryDate?: string
  batch?: string
}

const NUM = String.raw`\d+(?:[.,]\d+)?`
const MASS = String.raw`(?:mg|mcg|[µμu]g|g|iu|i\.u\.|%)`
const VOL = String.raw`(?:ml|l|g|dose|tab|tablet|capsule|actuation)`

// "5OO mg" / "l0 mg": letters that are really digits when they sit in a number before a unit.
// Requires at least one real digit so ordinary words are never rewritten.
function repairDigits(text: string): string {
  return text.replace(/\b(?=[0-9OolIS]*\d)[0-9OolIS]{2,5}(?=\s*(?:mg|mcg|ml)\b)/g, (tok) =>
    tok.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5'),
  )
}

function cleanNumber(raw: string, unit: string): string {
  // "100,000 IU" uses a thousands separator; "0,5 mg" is a decimal comma.
  if (/^\d{1,3},\d{3}$/.test(raw) && /iu/i.test(unit)) return raw.replace(',', '')
  return raw.replace(',', '.').replace(/^0+(?=\d)/, '')
}

function cleanUnit(unit: string): string {
  const u = unit.toLowerCase().replace(/\./g, '')
  if (u === 'iu') return 'IU'
  if (u === 'µg' || u === 'μg' || u === 'ug') return 'mcg'
  return u
}

function fmt(num: string, unit: string): string {
  const u = cleanUnit(unit)
  const n = cleanNumber(num, u)
  return u === '%' ? `${n}%` : `${n} ${u}`
}

interface Span {
  text: string
  start: number
  end: number
  kind: 'ratio' | 'combo' | 'simple'
  unit: string
}

export function extractStrengths(input: string): {
  primary?: string
  all: string[]
  packVolume?: string
} {
  const text = repairDigits(input)
  const spans: Span[] = []

  const ratioRe = new RegExp(
    String.raw`(${NUM})\s*(${MASS})\s*\/\s*(?:(${NUM})\s*)?(${VOL})(?![a-z])`,
    'gi',
  )
  for (const m of text.matchAll(ratioRe)) {
    const left = fmt(m[1], m[2])
    const right = m[3] ? `${cleanNumber(m[3], m[4])} ${cleanUnit(m[4])}` : cleanUnit(m[4])
    spans.push({
      text: `${left}/${right}`,
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'ratio',
      unit: cleanUnit(m[2]),
    })
  }
  const comboRe = new RegExp(
    String.raw`(${NUM})\s*(${MASS})\s*[\/+]\s*(${NUM})\s*(${MASS})(?![a-z])`,
    'gi',
  )
  for (const m of text.matchAll(comboRe)) {
    if (spans.some((s) => m.index! >= s.start && m.index! < s.end)) continue
    spans.push({
      text: `${fmt(m[1], m[2])}/${fmt(m[3], m[4])}`,
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'combo',
      unit: cleanUnit(m[2]),
    })
  }
  const simpleRe = new RegExp(
    String.raw`(?<![\d.,/])(${NUM})\s*(mg|mcg|[µμu]g|iu|i\.u\.|%|g|ml|l)(?![a-z])`,
    'gi',
  )
  let packVolume: string | undefined
  for (const m of text.matchAll(simpleRe)) {
    if (spans.some((s) => m.index! < s.end && m.index! + m[0].length > s.start)) continue
    const unit = cleanUnit(m[2])
    const value = Number(cleanNumber(m[1], unit))
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) continue
    if (unit === 'ml' || unit === 'l') {
      packVolume ??= fmt(m[1], m[2])
      continue
    }
    spans.push({
      text: fmt(m[1], m[2]),
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'simple',
      unit,
    })
  }
  spans.sort((a, b) => a.start - b.start)
  const all = [...new Set(spans.map((s) => s.text))]
  const preferred =
    spans.find((s) => s.kind === 'ratio') ??
    spans.find((s) => s.kind === 'combo') ??
    spans.find((s) => s.kind === 'simple' && s.unit !== 'g') ??
    spans.find((s) => s.kind === 'simple')
  return { primary: preferred?.text, all, packVolume }
}

const FORM_RULES: [string, RegExp][] = [
  ['Injection', /\b(injection|ampoules?|vials?|inj|prefilled|pen injector)\b/i],
  ['Inhaler', /\b(inhaler|evohaler|turbuhaler|diskus|respimat|inhalation)\b/i],
  ['Suppository', /\b(suppositor(?:y|ies)|supp)\b/i],
  ['Sachet', /\bsachets?\b/i],
  ['Lozenge', /\blozenges?\b/i],
  ['Patch', /\b(patch(?:es)?|plasters?)\b/i],
  ['Drops', /\b(drops|gtt)\b/i],
  ['Spray', /\bspray\b/i],
  ['Syrup', /\bsyrup\b/i],
  ['Suspension', /\bsuspension\b/i],
  ['Solution', /\b(solution|mouthwash|gargle)\b/i],
  ['Ointment', /\bointment\b/i],
  ['Cream', /\bcream\b/i],
  ['Gel', /\bgel\b/i],
  ['Lotion', /\blotion\b/i],
  ['Powder', /\bpowder\b/i],
  ['Capsule', /\b(capsules?|caps|softgels?|liqui-?gels?)\b/i],
  ['Tablet', /\b(tablets?|tabs?|caplets?|film[- ]coated|chewable|effervescent)\b/i],
]

export function extractForm(text: string): string | undefined {
  for (const [form, re] of FORM_RULES) if (re.test(text)) return form
  return undefined
}

const COUNT_UNIT = String.raw`(tablets?|tabs?|capsules?|caps|sachets?|ampoules?|lozenges?|suppositor(?:y|ies)|patch(?:es)?|vials?|softgels?)`

const PACK_ADJECTIVES = String.raw`(?:film[- ]?coated|coated|film|chewable|effervescent|soluble|dispersible|orodispersible|hard|soft|gastro[- ]?resistant|enteric[- ]?coated|prolonged[- ]release|extended[- ]release)`

export function extractPackSize(text: string, packVolume?: string): string | undefined {
  let m = new RegExp(
    String.raw`\b(\d{1,3})\s*(?:'?s\b\s*)?(?:${PACK_ADJECTIVES}\s+){0,2}${COUNT_UNIT}\b`,
    'i',
  ).exec(text)
  if (m && Number(m[1]) > 0) return `${m[1]} ${m[2].toLowerCase()}`
  m = /\b(\d{1,3})\s*['’]s\b/i.exec(text)
  if (m) return `${m[1]}'s`
  m = /\b(?:x|pack of|box of)\s*(\d{1,3})\b(?!\s*(?:mg|mcg|ml|g)\b)/i.exec(text)
  if (m) return `${m[1]} units`
  return packVolume
}

const EXP_RE = new RegExp(
  String.raw`(?:\bexp(?:iry)?(?:\.|\s*date)?|\bbest before|\buse before|\bbb)\s*[:.\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}\s*[/.\-]\s*\d{1,2}(?:\s*[/.\-]\s*\d{1,2})?|\d{1,2}\s*[/.\-]\s*\d{2,4}|[a-z]{3,9}\.?[ \-/]*\d{2,4})`,
  'i',
)
const BATCH_RE =
  /(?:\bbatch(?:\s*(?:no|number|nr|#))?|\bb\.?n\.?|\blot(?:\s*(?:no|number|#))?)\s*[:.\-#]?\s*([A-Z0-9][A-Z0-9-]{2,15})/i

export function extractExpiry(text: string): { text?: string; date?: string } {
  const m = EXP_RE.exec(text)
  if (!m) return {}
  const date = parseExpiryInput(m[1].replace(/\s+/g, ''))
  return { text: m[1], date }
}

export function extractBatch(text: string): string | undefined {
  const m = BATCH_RE.exec(text)
  if (!m) return undefined
  const value = m[1].toUpperCase()
  // Reject label words that happen to follow "lot"/"batch" ("Batch No").
  return /^(NO|NUMBER|NR|EXP|MFG|DATE)$/.test(value) ? undefined : value
}

export function extractDetails(text: string): ExtractedDetails {
  const s = extractStrengths(text)
  const exp = extractExpiry(text)
  return {
    strength: s.primary,
    strengthAlternatives: s.all.filter((x) => x !== s.primary),
    form: extractForm(text),
    packSize: extractPackSize(text, s.packVolume),
    expiryText: exp.text,
    expiryDate: exp.date,
    batch: extractBatch(text),
  }
}
