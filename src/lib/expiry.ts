export type ExpiryStatus = 'expired' | 'soon' | 'ok' | 'none'

const DAY_MS = 86_400_000

function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toIsoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

/** Local calendar date as ISO (not UTC, so "today" is right late in the evening in the UAE). */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Whole days from `now` (local date) to the ISO date. Negative = in the past. */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const p = parseIso(iso)
  if (!p) return null
  return Math.round(
    (utcDay(p.y, p.m, p.d) - utcDay(now.getFullYear(), now.getMonth() + 1, now.getDate())) / DAY_MS,
  )
}

/**
 * Expired means strictly before today: a box that says "03/2027" is valid through
 * the end of March, which is how expiry dates are printed on packaging.
 */
export function expiryStatus(
  iso: string | undefined,
  warningDays: number,
  now: Date = new Date(),
): ExpiryStatus {
  if (!iso) return 'none'
  const days = daysUntil(iso, now)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= warningDays) return 'soon'
  return 'ok'
}

export const STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: 'Expired',
  soon: 'Expiring soon',
  ok: 'OK',
  none: 'No expiry',
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function expandYear(yy: number): number {
  return yy < 100 ? 2000 + yy : yy
}

/**
 * Parses the date formats people type or OCR reads off a box into an ISO date.
 * Month-only dates resolve to the last day of the month.
 * Supports: 2027-03-31, 31/03/2027, 03/2027, 3-27, Mar 2027, 2027-03, 03.2027, 31 Mar 2027.
 */
export function parseExpiryInput(text: string): string | undefined {
  const s = text.trim().toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ')
  if (!s) return undefined

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s)
  if (m) return validDate(expandYear(Number(m[3])), Number(m[2]), Number(m[1]))

  m = /^(\d{4})[-/.](\d{1,2})$/.exec(s)
  if (m) return endOfMonth(Number(m[1]), Number(m[2]))

  m = /^(\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) return endOfMonth(expandYear(Number(m[2])), Number(m[1]))

  m = /^(?:(\d{1,2}) )?([a-z]{3})[a-z]*[ -/.]?(\d{2}|\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[2])
    if (month < 0) return undefined
    const year = expandYear(Number(m[3]))
    return m[1] ? validDate(year, month + 1, Number(m[1])) : endOfMonth(year, month + 1)
  }
  return undefined
}

function validDate(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined
  return toIsoDate(y, m, d)
}

export function endOfMonth(y: number, m: number): string | undefined {
  if (m < 1 || m > 12) return undefined
  return toIsoDate(y, m, daysInMonth(y, m))
}

export function formatExpiry(iso: string | undefined): string {
  if (!iso) return ''
  const p = parseIso(iso)
  if (!p) return iso
  const month = MONTHS[p.m - 1]
  return `${String(p.d).padStart(2, '0')} ${month[0].toUpperCase()}${month.slice(1)} ${p.y}`
}

export function describeDays(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const d = daysUntil(iso, now)
  if (d === null) return ''
  if (d === 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  if (d === -1) return 'Expired yesterday'
  if (d > 0) return d < 90 ? `In ${d} days` : `In ${Math.round(d / 30)} months`
  return Math.abs(d) < 90 ? `${Math.abs(d)} days ago` : `${Math.round(Math.abs(d) / 30)} months ago`
}

export function isLowStock(
  quantity: number,
  itemThreshold: number | undefined,
  defaultThreshold: number,
): boolean {
  return quantity <= (itemThreshold ?? defaultThreshold)
}
