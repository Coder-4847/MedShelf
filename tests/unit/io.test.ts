import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/db'
import { addItem } from '../../src/db/repo'
import type { Item } from '../../src/db/types'
import { createBackup, restoreBackup } from '../../src/lib/io/backup'
import { exportFilename, itemsToCsv } from '../../src/lib/io/columns'
import { parseCsv, toCsv } from '../../src/lib/io/csv'
import { parseCsvItems, rowsToItems } from '../../src/lib/io/import'
import { buildXlsx, parseXlsx } from '../../src/lib/io/xlsx'

const NOW = new Date(2026, 9, 22)

const sample: Item[] = [
  {
    id: 1,
    name: 'Panadol',
    strength: '500 mg',
    form: 'Tablet',
    quantity: 3,
    expiryDate: '2027-03-31',
    location: 'Kitchen drawer',
    category: 'Pain relief',
    batch: 'AB12',
    notes: 'Half box, "opened"',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 2,
    name: 'Amoxil, syrup',
    strength: '250 mg/5 ml',
    form: 'Suspension',
    quantity: 1,
    expiryDate: '2026-01-31',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    lowStockThreshold: 2,
    gtin: '06291100123454',
    packSize: '100 ml',
  },
  {
    id: 3,
    name: 'Vitamin D3',
    quantity: 0,
    notes: 'line1\nline2',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  },
]

const core = (i: {
  name: string
  strength?: string
  form?: string
  quantity: number
  expiryDate?: string
  location?: string
  category?: string
  batch?: string
  notes?: string
  gtin?: string
  packSize?: string
  lowStockThreshold?: number
}) => ({
  name: i.name,
  strength: i.strength,
  form: i.form,
  quantity: i.quantity,
  expiryDate: i.expiryDate,
  location: i.location,
  category: i.category,
  batch: i.batch,
  notes: i.notes,
  gtin: i.gtin,
  packSize: i.packSize,
  lowStockThreshold: i.lowStockThreshold,
})

describe('CSV codec', () => {
  it('quotes commas, quotes and newlines and round-trips', () => {
    const rows = [
      ['a', 'b,c', 'say "hi"', 'x\ny'],
      ['', '1', '2', '3'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
  it('parses CRLF, BOM and a missing trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('neutralises formula injection and restores it on import', () => {
    const csv = toCsv([['=1+1', '@x', 'ok']])
    expect(csv.startsWith("'=1+1")).toBe(true)
    expect(parseCsv(csv)).toEqual([['=1+1', '@x', 'ok']])
  })
})

describe('import mapping', () => {
  it('maps common header variants', () => {
    const r = rowsToItems([
      ['Medicine', 'Qty', 'Exp date', 'Storage', 'Lot no'],
      ['Panadol', '2', '03/2027', 'Bedroom', 'L9'],
    ])
    expect(r.errors).toEqual([])
    expect(r.rows[0].item).toMatchObject({
      name: 'Panadol',
      quantity: 2,
      expiryDate: '2027-03-31',
      location: 'Bedroom',
      batch: 'L9',
    })
  })
  it('handles Excel date serials, bad quantities and missing names', () => {
    const r = rowsToItems([
      ['Name', 'Quantity', 'Expiry'],
      ['A', 'many', '46477'],
      ['', '1', ''],
      ['B', '2', 'soonish'],
    ])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].item.expiryDate).toBe('2027-03-31')
    expect(r.rows[0].item.quantity).toBe(1)
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4])
  })
  it('requires a Name column', () => {
    const r = rowsToItems([
      ['Foo', 'Bar'],
      ['1', '2'],
    ])
    expect(r.rows).toHaveLength(0)
    expect(r.errors[0].message).toMatch(/Name/)
  })
})

describe('export/import round trip', () => {
  it('CSV: export then import reproduces the items', () => {
    const csv = toCsv(itemsToCsv(sample, 60, NOW))
    const back = parseCsvItems(csv)
    expect(back.errors).toEqual([])
    expect(back.rows.map((r) => core(r.item))).toEqual(
      sample.map((s) => core(s)).map((c) => JSON.parse(JSON.stringify(c))),
    )
  })

  it('XLSX: export then import reproduces the items, with real formatting', async () => {
    const buf = await buildXlsx(sample, 60, NOW)
    const grid = await parseXlsx(buf)
    expect(grid[0].slice(0, 6)).toEqual([
      'Name',
      'Strength',
      'Form',
      'Quantity',
      'Expiry',
      'Expiry status',
    ])
    const status = grid.map((r) => r[5])
    expect(status.slice(1)).toEqual(['OK', 'Expired', 'No expiry'])
    const back = rowsToItems(grid)
    expect(back.errors).toEqual([])
    expect(back.rows.map((r) => core(r.item))).toEqual(
      sample.map((s) => core(s)).map((c) => JSON.parse(JSON.stringify(c))),
    )

    // Inspect the workbook itself for the formatting requirements.
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true)
    expect(ws.getCell('E2').value).toBeInstanceOf(Date)
    expect(ws.getCell('E2').numFmt).toBe('dd mmm yyyy')
    expect(ws.getColumn(1).width).toBeGreaterThan(12)
    expect(
      JSON.stringify((ws as unknown as { conditionalFormattings: unknown }).conditionalFormattings),
    ).toContain('Expired')
  })

  it('names files by date', () => {
    expect(exportFilename('xlsx', NOW)).toBe('medshelf-inventory-2026-10-22.xlsx')
    expect(exportFilename('csv', NOW)).toBe('medshelf-inventory-2026-10-22.csv')
  })
})

describe('backup / restore', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('round-trips items, photos, aliases and settings', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' })
    const photoId = await db.photos.add({
      blob: png,
      thumbBlob: png,
      width: 10,
      height: 20,
      createdAt: 5,
    })
    await addItem({ name: 'Panadol', quantity: 2, photoId, expiryDate: '2027-03-31' })
    await db.aliases.put({ key: 'panakol', canonical: 'Panadol', count: 1, updatedAt: 1 })
    await db.settings.put({ key: 'expiryWarningDays', value: 45 })

    const text = await (await createBackup()).text()
    await Promise.all(db.tables.map((t) => t.clear()))
    expect(await db.items.count()).toBe(0)

    const res = await restoreBackup(text)
    expect(res).toEqual({ items: 1, photos: 1 })
    const item = (await db.items.toArray())[0]
    expect(item).toMatchObject({ name: 'Panadol', quantity: 2, photoId })
    const photo = await db.photos.get(photoId)
    expect(new Uint8Array(await photo!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(photo!.blob.type).toBe('image/jpeg')
    expect((await db.aliases.get('panakol'))?.canonical).toBe('Panadol')
    expect((await db.settings.get('expiryWarningDays'))?.value).toBe(45)
  })

  it('rejects bad files without touching existing data', async () => {
    await addItem({ name: 'Keep me', quantity: 1 })
    await expect(restoreBackup('not json')).rejects.toThrow(/valid JSON/)
    await expect(restoreBackup('{"format":"other"}')).rejects.toThrow(/not a MedShelf backup/)
    await expect(
      restoreBackup(JSON.stringify({ format: 'medshelf-backup', schemaVersion: 99, items: [] })),
    ).rejects.toThrow(/newer version/)
    await expect(
      restoreBackup(
        JSON.stringify({ format: 'medshelf-backup', schemaVersion: 2, items: [{ foo: 1 }] }),
      ),
    ).rejects.toThrow(/damaged/)
    expect(await db.items.count()).toBe(1)
  })
})
