import type { Item } from '../../db/types'
import { parseIso } from '../expiry'
import { EXPORT_COLUMNS, statusText } from './columns'

type ExcelJSModule = typeof import('exceljs')

async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = (await import('exceljs')) as ExcelJSModule & { default?: ExcelJSModule }
  return mod.default ?? mod
}

const ACCENT = 'FF0F6B64'

/**
 * Builds a formatted workbook: styled header, frozen header row, filters, auto column widths,
 * real date cells, and a live "Expiry status" formula with conditional colouring so the
 * sheet keeps colouring correctly when it is opened again months later.
 */
export async function buildXlsx(
  items: Item[],
  warningDays: number,
  now: Date = new Date(),
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MedShelf'
  wb.created = now
  const ws = wb.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  const dateCol = EXPORT_COLUMNS.findIndex((c) => c.key === 'expiryDate') + 1
  const statusCol = EXPORT_COLUMNS.findIndex((c) => c.key === 'expiryStatus') + 1
  const letter = (n: number) => String.fromCharCode(64 + n)

  items.forEach((item, idx) => {
    const rowNumber = idx + 2
    const values: Record<string, unknown> = {}
    for (const c of EXPORT_COLUMNS) {
      if (c.key === 'expiryDate') {
        const p = item.expiryDate ? parseIso(item.expiryDate) : null
        values[c.key] = p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : undefined
      } else if (c.key === 'expiryStatus') {
        const d = `${letter(dateCol)}${rowNumber}`
        values[c.key] = {
          formula: `IF(${d}="","No expiry",IF(${d}<TODAY(),"Expired",IF(${d}<=TODAY()+${warningDays},"Expiring soon","OK")))`,
          result: statusText(item, warningDays, now),
        }
      } else values[c.key] = c.value(item)
    }
    ws.addRow(values)
  })

  const header = ws.getRow(1)
  header.height = 22
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
  ws.getColumn(dateCol).numFmt = 'dd mmm yyyy'
  ws.getColumn(dateCol).alignment = { horizontal: 'left' }
  ws.getColumn(EXPORT_COLUMNS.findIndex((c) => c.key === 'quantity') + 1).alignment = {
    horizontal: 'center',
  }

  // Fit widths to content (bounded), never narrower than the header.
  EXPORT_COLUMNS.forEach((c, i) => {
    let max = c.header.length + 2
    for (const item of items) {
      const v = c.value(item)
      if (v !== undefined) max = Math.max(max, String(v).length + 2)
    }
    ws.getColumn(i + 1).width = Math.min(48, Math.max(c.width * 0.6, max))
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } }

  if (items.length) {
    const ref = `${letter(statusCol)}2:${letter(statusCol)}${items.length + 1}`
    const rule = (text: string, fg: string, bg: string, priority: number) => ({
      type: 'containsText' as const,
      operator: 'containsText' as const,
      text,
      priority,
      style: {
        font: { bold: true, color: { argb: fg } },
        fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: bg } },
      },
    })
    ws.addConditionalFormatting({
      ref,
      rules: [
        rule('Expired', 'FF9B1C1C', 'FFFBD5D5', 1),
        rule('Expiring soon', 'FF8A4B00', 'FFFCEBC4', 2),
        rule('OK', 'FF166534', 'FFD7F0DF', 3),
      ],
    })
  }

  const out = await wb.xlsx.writeBuffer()
  return out as ArrayBuffer
}

/** Reads the first worksheet into a plain string grid (dates become ISO yyyy-mm-dd). */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    const count = Math.max(row.cellCount, ws.columnCount)
    for (let c = 1; c <= count; c++) cells.push(cellToString(row.getCell(c).value))
    rows.push(cells)
  })
  return rows
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellToString(o.result)
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('')
    }
    if ('text' in o) return String(o.text)
    if ('error' in o) return ''
    return ''
  }
  return String(v)
}
