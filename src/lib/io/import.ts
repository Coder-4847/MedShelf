import type { NewItem } from '../../db/types'
import { parseExpiryInput } from '../expiry'
import { parseCsv } from './csv'

type Field =
  | 'name'
  | 'genericName'
  | 'strength'
  | 'form'
  | 'packSize'
  | 'quantity'
  | 'lowStockThreshold'
  | 'expiryDate'
  | 'batch'
  | 'gtin'
  | 'serial'
  | 'category'
  | 'location'
  | 'notes'

const SYNONYMS: Record<Field, string[]> = {
  name: [
    'name',
    'medicine',
    'medicinename',
    'medication',
    'drug',
    'drugname',
    'product',
    'productname',
    'item',
    'brand',
    'brandname',
  ],
  genericName: ['genericname', 'generic', 'activeingredient', 'ingredient', 'activesubstance'],
  strength: ['strength', 'dose', 'potency'],
  form: ['form', 'dosageform', 'type', 'formulation'],
  packSize: ['packsize', 'pack', 'packagesize', 'packaging'],
  quantity: ['quantity', 'qty', 'count', 'stock', 'units', 'amount', 'packs', 'number'],
  lowStockThreshold: [
    'lowstockthreshold',
    'lowstock',
    'minimum',
    'minqty',
    'minimumquantity',
    'reorderlevel',
    'threshold',
  ],
  expiryDate: [
    'expiry',
    'expirydate',
    'exp',
    'expdate',
    'expires',
    'expiration',
    'expirationdate',
    'validuntil',
    'bestbefore',
  ],
  batch: ['batch', 'batchno', 'batchnumber', 'lot', 'lotno', 'lotnumber'],
  gtin: ['gtin', 'barcode', 'ean', 'upc'],
  serial: ['serial', 'serialno', 'serialnumber'],
  category: ['category', 'group', 'class'],
  location: ['location', 'place', 'storage', 'room', 'storedin'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
}

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface ImportRow {
  line: number
  item: NewItem
}

export interface ImportResult {
  rows: ImportRow[]
  errors: { line: number; message: string }[]
  mapped: Partial<Record<Field, string>>
  unmapped: string[]
}

/** Excel stores dates as days since 1899-12-30. */
function excelSerialToIso(n: number): string | undefined {
  if (n < 20000 || n > 80000) return undefined
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function parseDateCell(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelSerialToIso(Number(v))
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(v)
  if (iso) return parseExpiryInput(iso[1])
  return parseExpiryInput(v)
}

export function rowsToItems(grid: string[][]): ImportResult {
  const result: ImportResult = { rows: [], errors: [], mapped: {}, unmapped: [] }
  const headerIdx = grid.findIndex((r) => r.some((c) => c.trim()))
  if (headerIdx === -1) return result
  const headers = grid[headerIdx].map((h) => h.trim())

  const colFor: Partial<Record<Field, number>> = {}
  headers.forEach((h, i) => {
    const key = headerKey(h)
    for (const field of Object.keys(SYNONYMS) as Field[]) {
      if (colFor[field] === undefined && SYNONYMS[field].includes(key)) {
        colFor[field] = i
        result.mapped[field] = h
        return
      }
    }
    if (h && key !== 'expirystatus' && key !== 'status' && key !== 'photo') result.unmapped.push(h)
  })

  if (colFor.name === undefined) {
    result.errors.push({
      line: headerIdx + 1,
      message: 'No "Name" column found. Add a header row with a Name column.',
    })
    return result
  }

  const get = (row: string[], f: Field) =>
    colFor[f] === undefined ? '' : (row[colFor[f]!] ?? '').trim()

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r]
    if (!row.some((c) => c.trim())) continue
    const line = r + 1
    const name = get(row, 'name')
    if (!name) {
      result.errors.push({ line, message: 'Missing name, row skipped.' })
      continue
    }
    const qtyRaw = get(row, 'quantity')
    let quantity = 1
    if (qtyRaw) {
      const q = Number(qtyRaw.replace(',', '.'))
      if (Number.isFinite(q) && q >= 0) quantity = Math.round(q)
      else result.errors.push({ line, message: `Quantity "${qtyRaw}" is not a number; using 1.` })
    }
    const expRaw = get(row, 'expiryDate')
    const expiryDate = parseDateCell(expRaw)
    if (expRaw && !expiryDate) {
      result.errors.push({ line, message: `Expiry "${expRaw}" was not understood; left blank.` })
    }
    const thr = get(row, 'lowStockThreshold')
    const item: NewItem = {
      name,
      quantity,
      genericName: get(row, 'genericName') || undefined,
      strength: get(row, 'strength') || undefined,
      form: get(row, 'form') || undefined,
      packSize: get(row, 'packSize') || undefined,
      lowStockThreshold:
        thr && Number.isFinite(Number(thr)) ? Math.max(0, Math.round(Number(thr))) : undefined,
      expiryDate,
      batch: get(row, 'batch') || undefined,
      gtin: get(row, 'gtin') || undefined,
      serial: get(row, 'serial') || undefined,
      category: get(row, 'category') || undefined,
      location: get(row, 'location') || undefined,
      notes: get(row, 'notes') || undefined,
    }
    result.rows.push({ line, item })
  }
  return result
}

export function parseCsvItems(text: string): ImportResult {
  return rowsToItems(parseCsv(text))
}
