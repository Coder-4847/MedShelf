import { describe, expect, it } from 'vitest'
import {
  extractBatch,
  extractDetails,
  extractExpiry,
  extractForm,
  extractPackSize,
  extractStrengths,
} from '../../src/lib/match/extract'

describe('strength extraction', () => {
  it.each([
    ['Paracetamol 500 mg tablets', '500 mg'],
    ['PARACETAMOL 500MG', '500 mg'],
    ['Amoxicillin 250 mg/5 ml oral suspension', '250 mg/5 ml'],
    ['10mg/5ml', '10 mg/5 ml'],
    ['Cetirizine 1 mg / ml', '1 mg/ml'],
    ['Augmentin 500 mg/125 mg', '500 mg/125 mg'],
    ['Vitamin D3 50,000 IU', '50000 IU'],
    ['Folic acid 400 mcg', '400 mcg'],
    ['Folic acid 400 µg', '400 mcg'],
    ['Hydrocortisone cream 1%', '1%'],
    ['Levothyroxine 0,5 mg', '0.5 mg'],
    ['Ibuprofen 4OO mg', '400 mg'],
    ['Paracetamol 1 g', '1 g'],
  ])('%s -> %s', (text, expected) => {
    expect(extractStrengths(text).primary).toBe(expected)
  })

  it('does not treat pack volume as strength', () => {
    const r = extractStrengths('Cough syrup 100 ml')
    expect(r.primary).toBeUndefined()
    expect(r.packVolume).toBe('100 ml')
  })
  it('prefers mass strength over grams in a combined text', () => {
    expect(extractStrengths('Paracetamol 500 mg  net 20 g').primary).toBe('500 mg')
  })
  it('lists alternatives', () => {
    const r = extractStrengths('Tablet 200 mg and 400 mg')
    expect(r.all).toEqual(['200 mg', '400 mg'])
  })
  it('ignores bare numbers', () => {
    expect(extractStrengths('Batch 12345 24 tablets').primary).toBeUndefined()
  })
})

describe('form and pack size', () => {
  it.each([
    ['Film-coated tablets', 'Tablet'],
    ['Hard capsules', 'Capsule'],
    ['Oral suspension', 'Suspension'],
    ['Eye drops', 'Drops'],
    ['Solution for injection', 'Injection'],
    ['Antiseptic cream', 'Cream'],
    ['Nasal spray', 'Spray'],
    ['Sachets', 'Sachet'],
  ])('%s -> %s', (text, form) => {
    expect(extractForm(text)).toBe(form)
  })
  it('extracts pack sizes', () => {
    expect(extractPackSize('24 tablets')).toBe('24 tablets')
    expect(extractPackSize('24 film-coated tablets')).toBe('24 tablets')
    expect(extractPackSize('Paracetamol 500 mg tablets')).toBeUndefined()
    expect(extractPackSize('Box of 30 capsules')).toBe('30 capsules')
    expect(extractPackSize("20's")).toBe("20's")
    expect(extractPackSize('x 10')).toBe('10 units')
    expect(extractPackSize('syrup', '120 ml')).toBe('120 ml')
  })
})

describe('expiry and batch from text', () => {
  it('reads EXP lines', () => {
    expect(extractExpiry('EXP: 03/2027').date).toBe('2027-03-31')
    expect(extractExpiry('Exp. 12-2026').date).toBe('2026-12-31')
    expect(extractExpiry('EXP 2027/05').date).toBe('2027-05-31')
    expect(extractExpiry('Expiry Date: 15/06/2027').date).toBe('2027-06-15')
    expect(extractExpiry('EXP MAR 2027').date).toBe('2027-03-31')
  })
  it('does not invent an expiry', () => {
    expect(extractExpiry('Paracetamol 500 mg').date).toBeUndefined()
  })
  it('reads batch numbers', () => {
    expect(extractBatch('Batch No: AB1234')).toBe('AB1234')
    expect(extractBatch('LOT 77X9')).toBe('77X9')
    expect(extractBatch('B.N. K2025-3')).toBe('K2025-3')
    expect(extractBatch('Batch No')).toBeUndefined()
  })
  it('combines everything', () => {
    const d = extractDetails('Paracetamol 500 mg\n24 film-coated tablets\nB.N. A12B\nEXP 03/2027')
    expect(d).toMatchObject({
      strength: '500 mg',
      form: 'Tablet',
      packSize: '24 tablets',
      batch: 'A12B',
      expiryDate: '2027-03-31',
    })
  })
})
