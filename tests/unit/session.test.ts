import { describe, expect, it } from 'vitest'
import type { Item } from '../../src/db/types'
import {
  candidateKey,
  confidenceLabel,
  findInventoryMatch,
  mergeForInventory,
} from '../../src/lib/scan/session'
import type { Candidate } from '../../src/lib/scan/types'

let n = 0
const cand = (over: Partial<Candidate>): Candidate => ({
  id: `c${n++}`,
  photoIndex: 0,
  name: 'Panadol',
  strength: '500 mg',
  strengthOptions: [],
  quantity: 1,
  confidence: 0.9,
  needsCheck: false,
  rawLines: [],
  quad: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  barcodeIds: [],
  source: 'ocr',
  status: 'confirmed',
  seenIn: [0],
  ...over,
})

describe('mergeForInventory', () => {
  it('ignores pending and discarded candidates', () => {
    const out = mergeForInventory([
      cand({ status: 'pending' }),
      cand({ status: 'discarded' }),
      cand({}),
    ])
    expect(out).toHaveLength(1)
  })
  it('sums boxes within one photo', () => {
    const out = mergeForInventory([
      cand({}),
      cand({}),
      cand({ name: 'Brufen', strength: '400 mg' }),
    ])
    expect(out.find((m) => m.name === 'Panadol')?.quantity).toBe(2)
    expect(out).toHaveLength(2)
  })
  it('does not double count the same pile photographed twice', () => {
    const out = mergeForInventory([
      cand({ photoIndex: 0 }),
      cand({ photoIndex: 0 }),
      cand({ photoIndex: 1 }),
      cand({ photoIndex: 1 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].quantity).toBe(2)
    expect(out[0].photos).toEqual([0, 1])
  })
  it('never counts the same GTIN + serial twice', () => {
    const out = mergeForInventory([
      cand({ gtin: '1', serial: 'A' }),
      cand({ gtin: '1', serial: 'A', photoIndex: 1 }),
      cand({ gtin: '1', serial: 'B' }),
    ])
    expect(out[0].quantity).toBe(2)
  })
  it('prefers barcode expiry and batch', () => {
    const out = mergeForInventory([
      cand({ expiryDate: '2027-01-31', expirySource: 'text', batch: 'X' }),
      cand({
        photoIndex: 1,
        expiryDate: '2027-03-31',
        expirySource: 'barcode',
        batch: 'B1',
        gtin: '9',
        serial: '1',
      }),
    ])
    expect(out[0]).toMatchObject({ expiryDate: '2027-03-31', batch: 'B1', gtin: '9' })
  })
  it('matches strengths regardless of spacing and case', () => {
    expect(candidateKey({ name: 'PANADOL', strength: '500mg' })).toBe(
      candidateKey({ name: 'Panadol', strength: '500 MG' }),
    )
  })
})

describe('inventory duplicate detection', () => {
  const items = [
    {
      id: 1,
      name: 'Panadol',
      strength: '500 mg',
      quantity: 3,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    },
  ] as Item[]
  it('finds a matching active item', () => {
    expect(findInventoryMatch(items, { name: 'panadol', strength: '500mg' })?.id).toBe(1)
    expect(findInventoryMatch(items, { name: 'Panadol', strength: '1 g' })).toBeUndefined()
  })
  it('ignores disposed items', () => {
    expect(
      findInventoryMatch([{ ...items[0], status: 'disposed' }], {
        name: 'Panadol',
        strength: '500 mg',
      }),
    ).toBeUndefined()
  })
})

describe('confidenceLabel', () => {
  it('never calls a flagged candidate high', () => {
    expect(confidenceLabel({ confidence: 0.99, needsCheck: true })).not.toBe('high')
    expect(confidenceLabel({ confidence: 0.95, needsCheck: false })).toBe('high')
    expect(confidenceLabel({ confidence: 0.3, needsCheck: true })).toBe('low')
  })
})
