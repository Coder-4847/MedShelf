import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { MedShelfDB, V1_STORES, db } from '../../src/db'
import {
  addItem,
  adjustQuantity,
  bulkUpdate,
  deleteItems,
  findDuplicate,
  learnAlias,
  loadSettings,
  markDisposed,
  purgeOrphanPhotos,
  restoreItems,
  setSetting,
  updateItem,
} from '../../src/db/repo'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('items', () => {
  it('adds, updates and trims fields', async () => {
    const id = await addItem({ name: '  Panadol ', quantity: 2, strength: '500 mg', notes: '   ' })
    const item = await db.items.get(id)
    expect(item).toMatchObject({
      name: 'Panadol',
      quantity: 2,
      strength: '500 mg',
      status: 'active',
    })
    expect(item).not.toHaveProperty('notes')
    await updateItem(id, { location: 'Kitchen drawer', strength: '' })
    const updated = await db.items.get(id)
    expect(updated?.location).toBe('Kitchen drawer')
    expect(updated).not.toHaveProperty('strength')
  })

  it('never lets quantity go negative', async () => {
    const id = await addItem({ name: 'Brufen', quantity: 1 })
    await adjustQuantity(id, -5)
    expect((await db.items.get(id))?.quantity).toBe(0)
    await adjustQuantity(id, 3)
    expect((await db.items.get(id))?.quantity).toBe(3)
  })

  it('deletes and restores (undo)', async () => {
    const a = await addItem({ name: 'A', quantity: 1 })
    const b = await addItem({ name: 'B', quantity: 1 })
    const removed = await deleteItems([a, b])
    expect(await db.items.count()).toBe(0)
    await restoreItems(removed)
    expect(await db.items.count()).toBe(2)
    expect((await db.items.get(a))?.name).toBe('A')
  })

  it('bulk updates and disposes', async () => {
    const a = await addItem({ name: 'A', quantity: 1 })
    const b = await addItem({ name: 'B', quantity: 1 })
    await bulkUpdate([a, b], { category: 'Allergy' })
    await markDisposed([a])
    expect((await db.items.get(a))?.status).toBe('disposed')
    expect((await db.items.get(a))?.disposedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await db.items.get(b))?.category).toBe('Allergy')
  })

  it('finds duplicates by name + strength', async () => {
    await addItem({ name: 'Panadol', strength: '500 mg', quantity: 1 })
    const items = await db.items.toArray()
    expect(findDuplicate(items, { name: 'panadol', strength: '500mg' })).toBeUndefined() // different text
    expect(findDuplicate(items, { name: 'PANADOL', strength: '500 MG' })?.name).toBe('Panadol')
    expect(findDuplicate(items, { name: 'Panadol', strength: '1 g' })).toBeUndefined()
  })
})

describe('photos', () => {
  it('purges photos that no item references', async () => {
    const blob = new Blob(['x'])
    const keep = await db.photos.add({ blob, thumbBlob: blob, width: 1, height: 1, createdAt: 0 })
    await db.photos.add({ blob, thumbBlob: blob, width: 1, height: 1, createdAt: 0 })
    await addItem({ name: 'A', quantity: 1, photoId: keep })
    expect(await purgeOrphanPhotos()).toBe(1)
    expect(await db.photos.count()).toBe(1)
  })
})

describe('settings and aliases', () => {
  it('returns defaults and persists overrides', async () => {
    expect((await loadSettings()).expiryWarningDays).toBe(60)
    await setSetting('expiryWarningDays', 30)
    expect((await loadSettings()).expiryWarningDays).toBe(30)
  })
  it('learns an alias once per key and counts repeats', async () => {
    await learnAlias('PANAKOL 500 mg', 'Panadol')
    await learnAlias('panakol', 'Panadol')
    const row = await db.aliases.get('panakol')
    expect(row).toMatchObject({ canonical: 'Panadol', count: 2 })
  })
  it('does not learn an identity mapping', async () => {
    await learnAlias('Panadol', 'Panadol')
    expect(await db.aliases.count()).toBe(0)
  })
})

describe('schema migration v1 -> v2', () => {
  it('backfills disposedAt and adds the scans table without losing items', async () => {
    const name = 'medshelf-migration-test'
    const v1 = new Dexie(name)
    v1.version(1).stores(V1_STORES)
    await v1.table('items').bulkAdd([
      {
        name: 'Old disposed',
        quantity: 1,
        status: 'disposed',
        createdAt: 1,
        updatedAt: Date.UTC(2025, 5, 1),
      },
      { name: 'Old active', quantity: 4, status: 'active', createdAt: 1, updatedAt: 1 },
    ])
    v1.close()

    const v2 = new MedShelfDB(name)
    await v2.open()
    const items = await v2.items.toArray()
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.name === 'Old disposed')?.disposedAt).toBe('2025-06-01')
    expect(items.find((i) => i.name === 'Old active')?.disposedAt).toBeUndefined()
    expect(await v2.scans.count()).toBe(0)
    v2.close()
    await Dexie.delete(name)
  })
})
