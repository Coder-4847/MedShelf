import type { Item } from '../../db/types'
import { normalize } from '../match/text'
import type { Candidate } from './types'

/** Identity of a medicine for merging: same name and strength. */
export function candidateKey(c: Pick<Candidate, 'name' | 'strength'>): string {
  return `${normalize(c.name)}|${normalize(c.strength ?? '').replace(/ /g, '')}`
}

export interface MergedItem {
  key: string
  name: string
  genericName?: string
  strength?: string
  form?: string
  packSize?: string
  category?: string
  expiryDate?: string
  batch?: string
  gtin?: string
  serial?: string
  quantity: number
  /** Candidate used for the photo crop and alias learning. */
  primary: Candidate
  members: Candidate[]
  photos: number[]
}

/**
 * Collapses confirmed candidates into inventory rows.
 *
 * Two photos often show the same pile, so the same medicine seen in several photos is
 * counted once: quantity is the largest per-photo total, not the sum. Boxes carrying the
 * same GTIN + serial are the very same pack and are never counted twice.
 */
export function mergeForInventory(candidates: Candidate[]): MergedItem[] {
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    if (c.status !== 'confirmed') continue
    const k = candidateKey(c)
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  const out: MergedItem[] = []
  for (const [key, members] of groups) {
    const seenSerials = new Set<string>()
    const unique = members.filter((m) => {
      if (!m.gtin || !m.serial) return true
      const id = `${m.gtin}/${m.serial}`
      if (seenSerials.has(id)) return false
      seenSerials.add(id)
      return true
    })
    const perPhoto = new Map<number, number>()
    for (const m of unique)
      perPhoto.set(m.photoIndex, (perPhoto.get(m.photoIndex) ?? 0) + Math.max(1, m.quantity))
    const quantity = Math.max(...perPhoto.values())
    // The most informative member supplies the details (prefer barcode-derived expiry).
    const primary = [...unique].sort((a, b) => score(b) - score(a))[0]
    const pick = <K extends keyof Candidate>(k: K) =>
      unique.find((m) => m[k] !== undefined && m[k] !== '')?.[k]
    out.push({
      key,
      name: primary.name,
      genericName: pick('genericName') as string | undefined,
      strength: primary.strength,
      form: pick('form') as string | undefined,
      packSize: pick('packSize') as string | undefined,
      category: pick('category') as string | undefined,
      expiryDate: primary.expiryDate ?? (pick('expiryDate') as string | undefined),
      batch: primary.batch ?? (pick('batch') as string | undefined),
      gtin: primary.gtin ?? (pick('gtin') as string | undefined),
      serial: primary.serial,
      quantity,
      primary,
      members: unique,
      photos: [...new Set(unique.map((m) => m.photoIndex))],
    })
  }
  return out
}

const score = (c: Candidate) =>
  (c.expirySource === 'barcode' ? 2 : 0) + (c.gtin ? 1 : 0) + c.confidence

/** Existing active inventory row that this scanned medicine would duplicate. */
export function findInventoryMatch(
  items: Item[],
  m: Pick<MergedItem, 'name' | 'strength'>,
): Item | undefined {
  const k = candidateKey(m)
  return items.find((i) => i.status === 'active' && candidateKey(i) === k)
}

export function confidenceLabel(
  c: Pick<Candidate, 'confidence' | 'needsCheck'>,
): 'high' | 'medium' | 'low' {
  if (!c.needsCheck && c.confidence >= 0.8) return 'high'
  return c.confidence >= 0.55 ? 'medium' : 'low'
}
