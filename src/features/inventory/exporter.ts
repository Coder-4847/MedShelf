import { db } from '../../db'
import { exportFilename, itemsToCsv } from '../../lib/io/columns'
import { toCsv } from '../../lib/io/csv'
import { downloadBlob } from '../../lib/io/download'

export async function exportInventory(kind: 'xlsx' | 'csv', warningDays: number): Promise<number> {
  const items = (await db.items.where('status').equals('active').toArray()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const now = new Date()
  if (kind === 'csv') {
    const csv = toCsv(itemsToCsv(items, warningDays, now))
    downloadBlob(
      new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
      exportFilename('csv', now),
    )
  } else {
    const { buildXlsx } = await import('../../lib/io/xlsx')
    const buf = await buildXlsx(items, warningDays, now)
    downloadBlob(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      exportFilename('xlsx', now),
    )
  }
  return items.length
}
