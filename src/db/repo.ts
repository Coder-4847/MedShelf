import { db } from './index'
import { DEFAULT_SETTINGS, type AliasRecord, type Item, type NewItem, type Settings } from './types'
import { aliasKey, normalize } from '../lib/match/text'
import { todayIso } from '../lib/expiry'

function clean<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '' && k !== 'name') continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out as T
}

export async function addItem(input: NewItem): Promise<number> {
  const now = Date.now()
  const item = clean({
    ...input,
    quantity: Math.max(0, Math.round(input.quantity)),
    status: input.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }) as Item
  return db.items.add(item)
}

export async function addItems(inputs: NewItem[]): Promise<number[]> {
  const now = Date.now()
  const rows = inputs.map(
    (input) =>
      clean({
        ...input,
        quantity: Math.max(0, Math.round(input.quantity)),
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      }) as Item,
  )
  return db.items.bulkAdd(rows, { allKeys: true }) as Promise<number[]>
}

export async function updateItem(id: number, changes: Partial<Item>): Promise<void> {
  const patch: Record<string, unknown> = { ...changes, updatedAt: Date.now() }
  const removals: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed === '' && k !== 'name') removals.push(k)
      else patch[k] = trimmed
    } else if (v === undefined) removals.push(k)
  }
  for (const k of removals) delete patch[k]
  await db.transaction('rw', db.items, async () => {
    await db.items.update(id, patch)
    if (removals.length) {
      const item = await db.items.get(id)
      if (item) {
        for (const k of removals) delete (item as unknown as Record<string, unknown>)[k]
        await db.items.put(item)
      }
    }
  })
}

export async function adjustQuantity(id: number, delta: number): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    const item = await db.items.get(id)
    if (!item) return
    await db.items.update(id, {
      quantity: Math.max(0, item.quantity + delta),
      updatedAt: Date.now(),
    })
  })
}

export async function bulkUpdate(ids: number[], changes: Partial<Item>): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.items, async () => {
    for (const id of ids) await db.items.update(id, { ...changes, updatedAt: now })
  })
}

/** Deletes items and returns them so the caller can offer Undo. Photos stay until purgeOrphanPhotos(). */
export async function deleteItems(ids: number[]): Promise<Item[]> {
  const removed = (await db.items.bulkGet(ids)).filter((i): i is Item => !!i)
  await db.items.bulkDelete(ids)
  return removed
}

export async function restoreItems(items: Item[]): Promise<void> {
  await db.items.bulkPut(items)
}

export async function markDisposed(ids: number[]): Promise<void> {
  const today = todayIso()
  await bulkUpdate(ids, { status: 'disposed', disposedAt: today })
}

export async function markActive(ids: number[]): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.items, async () => {
    for (const id of ids) {
      const item = await db.items.get(id)
      if (!item) continue
      delete item.disposedAt
      item.status = 'active'
      item.updatedAt = now
      await db.items.put(item)
    }
  })
}

/** Removes photos no item references. Call after the undo window for deletions has passed. */
export async function purgeOrphanPhotos(): Promise<number> {
  const used = new Set((await db.items.toArray()).map((i) => i.photoId).filter(Boolean))
  const scanPhotos = new Set<number>()
  const orphanIds = (await db.photos.toCollection().primaryKeys()).filter(
    (id) => !used.has(id) && !scanPhotos.has(id),
  )
  await db.photos.bulkDelete(orphanIds)
  return orphanIds.length
}

export function findDuplicate(
  items: Item[],
  candidate: { name: string; strength?: string; form?: string },
): Item | undefined {
  const name = normalize(candidate.name)
  if (!name) return undefined
  const strength = normalize(candidate.strength ?? '')
  return items.find(
    (i) =>
      i.status === 'active' &&
      normalize(i.name) === name &&
      normalize(i.strength ?? '') === strength,
  )
}

// ---- settings ----

export async function loadSettings(): Promise<Settings> {
  const rows = await db.settings.toArray()
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...stored } as Settings
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value })
  if (key === 'theme') {
    try {
      localStorage.setItem('medshelf-theme', String(value))
    } catch {
      /* storage can be blocked; theme still applies for this session */
    }
  }
}

// ---- learned aliases ----

/** Remembers that OCR text `raw` means `canonical`, so the same misread matches next time. */
export async function learnAlias(
  raw: string,
  canonical: string,
  extra: Partial<Pick<AliasRecord, 'genericName' | 'strength' | 'form' | 'category'>> = {},
) {
  const key = aliasKey(raw)
  if (key.length < 3 || normalize(key) === normalize(canonical)) return
  const existing = await db.aliases.get(key)
  await db.aliases.put({
    ...existing,
    key,
    canonical,
    ...clean(extra),
    count: (existing?.count ?? 0) + 1,
    updatedAt: Date.now(),
  })
}

export async function learnGtin(
  gtin: string,
  canonical: string,
  extra: Partial<Pick<AliasRecord, 'genericName' | 'strength' | 'form' | 'category'>> = {},
) {
  const key = `gtin:${gtin}`
  const existing = await db.aliases.get(key)
  await db.aliases.put({
    ...existing,
    key,
    canonical,
    ...clean(extra),
    count: (existing?.count ?? 0) + 1,
    updatedAt: Date.now(),
  })
}

export async function clearAllData() {
  await db.transaction('rw', [db.items, db.photos, db.aliases, db.settings, db.scans], async () => {
    await Promise.all([
      db.items.clear(),
      db.photos.clear(),
      db.aliases.clear(),
      db.settings.clear(),
      db.scans.clear(),
    ])
  })
}
