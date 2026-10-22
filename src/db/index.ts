import Dexie, { type Table } from 'dexie'
import type { AliasRecord, Item, PhotoRecord, ScanRecord, SettingRecord } from './types'

/**
 * Schema history. Append a new `version(n)` block for every change and never edit an
 * old one: Dexie replays them in order to upgrade existing browsers.
 *
 *  v1  items, photos, aliases, settings
 *  v2  + scans table (recent scans on the dashboard), + items.disposedAt index;
 *      backfills disposedAt for items disposed under v1
 */
export const SCHEMA_VERSION = 2

const V1_STORES = {
  items: '++id, name, status, expiryDate, category, location, gtin, updatedAt',
  photos: '++id',
  aliases: 'key',
  settings: 'key',
}

const V2_STORES = {
  items: '++id, name, status, expiryDate, category, location, gtin, updatedAt, disposedAt',
  scans: '++id, createdAt',
}

export class MedShelfDB extends Dexie {
  items!: Table<Item, number>
  photos!: Table<PhotoRecord, number>
  aliases!: Table<AliasRecord, string>
  settings!: Table<SettingRecord, string>
  scans!: Table<ScanRecord, number>

  constructor(name = 'medshelf') {
    super(name)
    this.version(1).stores(V1_STORES)
    this.version(2)
      .stores(V2_STORES)
      .upgrade((tx) =>
        tx
          .table('items')
          .toCollection()
          .modify((item: Item) => {
            if (item.status === 'disposed' && !item.disposedAt) {
              item.disposedAt = new Date(item.updatedAt ?? Date.now()).toISOString().slice(0, 10)
            }
          }),
      )
  }
}

export const db = new MedShelfDB()

export { V1_STORES }
