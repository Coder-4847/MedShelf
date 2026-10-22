import type { Item } from '../../db/types'
import { expiryStatus, STATUS_LABEL, type ExpiryStatus } from '../expiry'

export interface ExportColumn {
  key: string
  header: string
  width: number
  value: (item: Item) => string | number | undefined
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Name', width: 28, value: (i) => i.name },
  { key: 'strength', header: 'Strength', width: 14, value: (i) => i.strength },
  { key: 'form', header: 'Form', width: 12, value: (i) => i.form },
  { key: 'quantity', header: 'Quantity', width: 10, value: (i) => i.quantity },
  { key: 'expiryDate', header: 'Expiry', width: 14, value: (i) => i.expiryDate },
  { key: 'expiryStatus', header: 'Expiry status', width: 16, value: () => undefined },
  { key: 'location', header: 'Location', width: 18, value: (i) => i.location },
  { key: 'category', header: 'Category', width: 20, value: (i) => i.category },
  { key: 'batch', header: 'Batch', width: 14, value: (i) => i.batch },
  { key: 'notes', header: 'Notes', width: 30, value: (i) => i.notes },
  { key: 'genericName', header: 'Generic name', width: 22, value: (i) => i.genericName },
  { key: 'packSize', header: 'Pack size', width: 14, value: (i) => i.packSize },
  {
    key: 'lowStockThreshold',
    header: 'Low-stock threshold',
    width: 12,
    value: (i) => i.lowStockThreshold,
  },
  { key: 'gtin', header: 'GTIN', width: 18, value: (i) => i.gtin },
  { key: 'serial', header: 'Serial', width: 18, value: (i) => i.serial },
]

export function statusText(item: Item, warningDays: number, now: Date): string {
  const s: ExpiryStatus = expiryStatus(item.expiryDate, warningDays, now)
  return STATUS_LABEL[s]
}

export function exportFilename(ext: 'xlsx' | 'csv' | 'json', now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return ext === 'json'
    ? `medshelf-backup-${y}-${m}-${d}.json`
    : `medshelf-inventory-${y}-${m}-${d}.${ext}`
}

export function itemsToCsv(items: Item[], warningDays: number, now: Date = new Date()): string[][] {
  const rows: string[][] = [EXPORT_COLUMNS.map((c) => c.header)]
  for (const item of items) {
    rows.push(
      EXPORT_COLUMNS.map((c) =>
        c.key === 'expiryStatus' ? statusText(item, warningDays, now) : String(c.value(item) ?? ''),
      ),
    )
  }
  return rows
}
