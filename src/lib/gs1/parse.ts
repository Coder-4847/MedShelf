import { daysInMonth, toIsoDate } from '../expiry'

/**
 * GS1 element string parser for the data carried by GS1 DataMatrix / GS1-128 on UAE
 * (and EU) medicine packs: GTIN (01), expiry (17), batch/lot (10), serial (21), etc.
 */

const GS = '\x1d'

interface AiSpec {
  /** Data length for fixed-length AIs, maximum length for variable ones. */
  len: number
  fixed: boolean
  label: string
}

const f = (len: number, label: string): AiSpec => ({ len, fixed: true, label })
const v = (len: number, label: string): AiSpec => ({ len, fixed: false, label })

const AI_TABLE: Record<string, AiSpec> = {
  '00': f(18, 'SSCC'),
  '01': f(14, 'GTIN'),
  '02': f(14, 'Content GTIN'),
  '10': v(20, 'Batch/lot'),
  '11': f(6, 'Production date'),
  '12': f(6, 'Due date'),
  '13': f(6, 'Packaging date'),
  '15': f(6, 'Best before'),
  '16': f(6, 'Sell by'),
  '17': f(6, 'Expiry date'),
  '20': f(2, 'Variant'),
  '21': v(20, 'Serial number'),
  '22': v(20, 'Consumer product variant'),
  '240': v(30, 'Additional product ID'),
  '241': v(30, 'Customer part number'),
  '242': v(6, 'Made-to-order variation'),
  '243': v(20, 'Packaging component number'),
  '250': v(30, 'Secondary serial number'),
  '251': v(30, 'Reference to source entity'),
  '253': v(30, 'Global document type identifier'),
  '254': v(20, 'GLN extension component'),
  '30': v(8, 'Count of items'),
  '37': v(8, 'Count of units'),
  '400': v(30, 'Customer PO number'),
  '401': v(30, 'GINC'),
  '402': f(17, 'GSIN'),
  '403': v(30, 'Routing code'),
  '420': v(20, 'Ship-to postal code'),
  '421': v(15, 'Ship-to postal code with ISO country'),
  '422': f(3, 'Country of origin'),
  '423': v(15, 'Country of initial processing'),
  '424': f(3, 'Country of processing'),
  '425': v(15, 'Country of disassembly'),
  '426': f(3, 'Country covering full process chain'),
  '7001': f(13, 'NATO stock number'),
  '7002': v(30, 'UN/ECE meat carcasses'),
  '7003': f(10, 'Expiration date and time'),
  '7004': v(4, 'Active potency'),
  '710': v(20, 'National healthcare reimbursement number (Germany)'),
  '711': v(20, 'National healthcare reimbursement number (France)'),
  '712': v(20, 'National healthcare reimbursement number (Spain)'),
  '713': v(20, 'National healthcare reimbursement number (Brazil)'),
  '714': v(20, 'National healthcare reimbursement number (Portugal)'),
  '715': v(20, 'National healthcare reimbursement number (USA)'),
  '8003': v(30, 'GRAI'),
  '8004': v(30, 'GIAI'),
  '8006': f(18, 'ITIP'),
  '8010': v(30, 'Component/part identifier'),
  '8011': v(12, 'Component/part serial'),
  '8017': f(18, 'GSRN provider'),
  '8018': f(18, 'GSRN recipient'),
  '8200': v(70, 'Product URL'),
  '90': v(30, 'Internal'),
}
for (let i = 91; i <= 99; i++) AI_TABLE[String(i)] = v(90, 'Internal')
// 310n-369n: trade/logistic measures, 6 digits, the 4th digit is the decimal-point position.
for (const family of [31, 32, 33, 34, 35, 36]) {
  for (let third = 0; third <= 9; third++) {
    for (let n = 0; n <= 9; n++) AI_TABLE[`${family}${third}${n}`] = f(6, 'Measure')
  }
}
for (const first of ['390', '392'])
  for (let i = 0; i <= 9; i++) AI_TABLE[`${first}${i}`] = v(15, 'Amount')
for (const first of ['391', '393'])
  for (let i = 0; i <= 9; i++) AI_TABLE[`${first}${i}`] = v(18, 'Amount')
for (let i = 410; i <= 417; i++) AI_TABLE[String(i)] = f(13, 'Location')

export interface Gs1Element {
  ai: string
  value: string
  label: string
}

export interface Gs1Result {
  raw: string
  elements: Gs1Element[]
  gtin?: string
  gtinValid?: boolean
  /** ISO date; day 00 in the code resolves to the end of the month. */
  expiryDate?: string
  batch?: string
  serial?: string
  productionDate?: string
  bestBefore?: string
  errors: string[]
}

function aiAt(s: string, pos: number): { ai: string; spec: AiSpec } | null {
  for (const n of [2, 3, 4]) {
    const ai = s.slice(pos, pos + n)
    if (ai.length === n && AI_TABLE[ai]) return { ai, spec: AI_TABLE[ai] }
  }
  return null
}

/** GS1 mod-10 check digit validation for GTIN-8/12/13/14 and SSCC-18. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop() as number
  let sum = 0
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1)
  })
  return (10 - (sum % 10)) % 10 === check
}

export function padGtin14(code: string): string {
  return code.padStart(14, '0')
}

/** Strips the leading zero(s) so a GTIN-14 from an EAN-13 pack reads like the printed number. */
export function displayGtin(gtin14: string): string {
  return gtin14.replace(/^0+(?=\d{12,13}$)/, '')
}

/**
 * Resolves a 6-digit GS1 date (YYMMDD). Day 00 means "last day of the month".
 * The century follows the GS1 General Specifications rule (7.12): years 51-99 ahead of the
 * current year are read as the previous century, years 50-99 behind as the next.
 */
export function parseGs1Date(yymmdd: string, now: Date = new Date()): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined
  const yy = Number(yymmdd.slice(0, 2))
  const mm = Number(yymmdd.slice(2, 4))
  let dd = Number(yymmdd.slice(4, 6))
  if (mm < 1 || mm > 12) return undefined
  const currentYear = now.getFullYear()
  const century = Math.floor(currentYear / 100) * 100
  const diff = yy - (currentYear % 100)
  let year = century + yy
  if (diff >= 51) year -= 100
  else if (diff <= -50) year += 100
  const last = daysInMonth(year, mm)
  if (dd === 0) dd = last
  if (dd > last) return undefined
  return toIsoDate(year, mm, dd)
}

const SYMBOLOGY_ID = /^\][A-Za-z][0-9A-Za-z]/

/** Normalises scanner output: symbology id, group-separator substitutes, leading FNC1. */
function normalise(input: string): string {
  let s = input
  s = s.replace(SYMBOLOGY_ID, '')
  s = s.replace(/<GS>|\u241d|\\x1d|\\u001d/gi, GS)
  if (s.startsWith(GS)) s = s.slice(1)
  return s
}

/** Converts human-readable "(01)...(17)..." text into a raw element string with GS separators. */
function fromHri(s: string): string | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null
  const parts = [...s.matchAll(/\((\d{2,4})\)([^(]*)/g)]
  let out = ''
  parts.forEach(([, ai, value], i) => {
    const spec = AI_TABLE[ai]
    out += ai + value
    if (spec && !spec.fixed && i < parts.length - 1) out += GS
  })
  return out
}

export function looksLikeGs1(input: string): boolean {
  const s = normalise(input)
  return (
    /^\(\d{2,4}\)/.test(s) ||
    /^(01\d{14}|00\d{18}|02\d{14}|10[\x21-\x7e]|17\d{6}|21[\x21-\x7e])/.test(s)
  )
}

export function parseGs1(input: string, now: Date = new Date()): Gs1Result {
  const raw = input
  let s = normalise(input)
  const hri = fromHri(s)
  if (hri !== null) s = hri
  const result: Gs1Result = { raw, elements: [], errors: [] }

  let pos = 0
  while (pos < s.length) {
    if (s[pos] === GS) {
      pos++
      continue
    }
    const found = aiAt(s, pos)
    if (!found) {
      result.errors.push(
        `Unknown application identifier at position ${pos}: "${s.slice(pos, pos + 4)}"`,
      )
      break
    }
    const { ai, spec } = found
    pos += ai.length
    let value: string
    if (spec.fixed) {
      value = s.slice(pos, pos + spec.len)
      if (value.length < spec.len || value.includes(GS)) {
        result.errors.push(`AI ${ai} (${spec.label}) is truncated`)
        break
      }
      pos += spec.len
    } else {
      let end = s.indexOf(GS, pos)
      if (end === -1) end = s.length
      value = s.slice(pos, end)
      if (value.length > spec.len) {
        result.errors.push(`AI ${ai} (${spec.label}) is longer than ${spec.len} characters`)
        value = value.slice(0, spec.len)
        pos += spec.len
      } else {
        pos = end
      }
      if (!value) {
        result.errors.push(`AI ${ai} (${spec.label}) has no data`)
        break
      }
    }
    result.elements.push({ ai, value, label: spec.label })
  }

  for (const { ai, value } of result.elements) {
    switch (ai) {
      case '01':
        result.gtin ??= value
        result.gtinValid = isValidGtin(value)
        break
      case '17': {
        const date = parseGs1Date(value, now)
        if (date) result.expiryDate ??= date
        else result.errors.push(`Invalid expiry date "${value}"`)
        break
      }
      case '15': {
        const date = parseGs1Date(value, now)
        if (date) result.bestBefore ??= date
        break
      }
      case '11': {
        const date = parseGs1Date(value, now)
        if (date) result.productionDate ??= date
        break
      }
      case '7003':
        if (!result.expiryDate) {
          const date = parseGs1Date(value.slice(0, 6), now)
          if (date) result.expiryDate = date
        }
        break
      case '10':
        result.batch ??= value
        break
      case '21':
        result.serial ??= value
        break
    }
  }
  return result
}

export interface ScannedCode {
  format: string
  text: string
  symbologyIdentifier?: string
}

/**
 * Interprets any barcode: GS1 element strings give full data; a plain EAN/UPC gives a GTIN only.
 * Returns null for codes that are neither (e.g. unrelated QR codes).
 */
export function interpretBarcode(code: ScannedCode, now: Date = new Date()): Gs1Result | null {
  const text = code.text
  const isGs1Symbology = /^\](d2|C1|e0|Q3|J1)/.test(code.symbologyIdentifier ?? '')
  if (isGs1Symbology || looksLikeGs1(text)) {
    const res = parseGs1(text, now)
    if (res.elements.length > 0) return res
  }
  if (/^(EAN|UPC)/i.test(code.format) && /^\d{8,14}$/.test(text)) {
    const gtin = padGtin14(text)
    return {
      raw: text,
      elements: [{ ai: '01', value: gtin, label: 'GTIN' }],
      gtin,
      gtinValid: isValidGtin(text),
      errors: [],
    }
  }
  return null
}
