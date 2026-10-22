import { db, SCHEMA_VERSION } from '../../db'
import type { AliasRecord, Item, PhotoRecord, ScanRecord, SettingRecord } from '../../db/types'

const FORMAT = 'medshelf-backup'

interface PhotoJson {
  id: number
  createdAt: number
  width: number
  height: number
  blob: string
  thumbBlob: string
}

interface ScanJson extends Omit<ScanRecord, 'thumbBlob'> {
  thumbBlob?: string
}

export interface BackupFile {
  format: typeof FORMAT
  schemaVersion: number
  exportedAt: string
  items: Item[]
  photos: PhotoJson[]
  aliases: AliasRecord[]
  settings: SettingRecord[]
  scans: ScanJson[]
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m) throw new Error('Backup contains an invalid image.')
  const type = m[1] || 'application/octet-stream'
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function createBackup(): Promise<Blob> {
  const [items, photos, aliases, settings, scans] = await Promise.all([
    db.items.toArray(),
    db.photos.toArray(),
    db.aliases.toArray(),
    db.settings.toArray(),
    db.scans.toArray(),
  ])
  const file: BackupFile = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items,
    photos: await Promise.all(
      photos.map(async (p) => ({
        id: p.id!,
        createdAt: p.createdAt,
        width: p.width,
        height: p.height,
        blob: await blobToDataUrl(p.blob),
        thumbBlob: await blobToDataUrl(p.thumbBlob),
      })),
    ),
    aliases,
    settings,
    scans: await Promise.all(
      scans.map(async ({ thumbBlob, ...rest }) => ({
        ...rest,
        thumbBlob: thumbBlob ? await blobToDataUrl(thumbBlob) : undefined,
      })),
    ),
  }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

export function validateBackup(data: unknown): BackupFile {
  const d = data as Partial<BackupFile> | null
  if (!d || typeof d !== 'object' || d.format !== FORMAT) {
    throw new Error('This is not a MedShelf backup file.')
  }
  if (typeof d.schemaVersion !== 'number' || d.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      'This backup was made by a newer version of MedShelf. Update the app and try again.',
    )
  }
  if (!Array.isArray(d.items)) throw new Error('The backup is missing its items.')
  for (const item of d.items) {
    if (!item || typeof item.name !== 'string' || typeof item.quantity !== 'number') {
      throw new Error('The backup contains a damaged item record.')
    }
  }
  return {
    format: FORMAT,
    schemaVersion: d.schemaVersion,
    exportedAt: d.exportedAt ?? '',
    items: d.items,
    photos: Array.isArray(d.photos) ? d.photos : [],
    aliases: Array.isArray(d.aliases) ? d.aliases : [],
    settings: Array.isArray(d.settings) ? d.settings : [],
    scans: Array.isArray(d.scans) ? d.scans : [],
  }
}

/** Replaces ALL current data with the backup. Validation happens before anything is cleared. */
export async function restoreBackup(text: string): Promise<{ items: number; photos: number }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const backup = validateBackup(parsed)

  const photos: PhotoRecord[] = await Promise.all(
    backup.photos.map(async (p) => ({
      id: p.id,
      createdAt: p.createdAt,
      width: p.width,
      height: p.height,
      blob: await dataUrlToBlob(p.blob),
      thumbBlob: await dataUrlToBlob(p.thumbBlob),
    })),
  )
  const scans: ScanRecord[] = await Promise.all(
    backup.scans.map(async ({ thumbBlob, ...rest }) => ({
      ...rest,
      thumbBlob: thumbBlob ? await dataUrlToBlob(thumbBlob) : undefined,
    })),
  )

  await db.transaction('rw', [db.items, db.photos, db.aliases, db.settings, db.scans], async () => {
    await Promise.all([
      db.items.clear(),
      db.photos.clear(),
      db.aliases.clear(),
      db.settings.clear(),
      db.scans.clear(),
    ])
    await db.photos.bulkAdd(photos)
    await db.items.bulkAdd(backup.items)
    await db.aliases.bulkAdd(backup.aliases)
    await db.settings.bulkAdd(backup.settings)
    await db.scans.bulkAdd(scans)
  })
  return { items: backup.items.length, photos: photos.length }
}
