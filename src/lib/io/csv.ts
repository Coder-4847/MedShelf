/** Minimal RFC 4180 CSV codec (quotes, embedded commas/newlines, BOM, CRLF). */

const FORMULA_START = /^[=+@\t\r]/

function escapeCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  let s = String(value)
  // Stop spreadsheet apps from evaluating text as a formula when the file is opened.
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number | undefined | null)[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += c
    } else if (c === '"' && cell === '') inQuotes = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  // Undo the formula guard added by toCsv.
  return rows.map((r) => r.map((c) => (/^'[=+@\t\r]/.test(c) ? c.slice(1) : c)))
}
