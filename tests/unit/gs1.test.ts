import { describe, expect, it } from 'vitest'
import {
  interpretBarcode,
  isValidGtin,
  looksLikeGs1,
  parseGs1,
  parseGs1Date,
} from '../../src/lib/gs1/parse'

const GS = '\x1d'
const NOW = new Date(2026, 9, 22)

describe('GTIN check digit', () => {
  it('accepts valid GTINs', () => {
    expect(isValidGtin('09501101530003')).toBe(true)
    expect(isValidGtin('5012345678900')).toBe(true)
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
  })
  it('rejects a wrong check digit or wrong length', () => {
    expect(isValidGtin('09501101530004')).toBe(false)
    expect(isValidGtin('123')).toBe(false)
  })
})

describe('GS1 dates (YYMMDD)', () => {
  it('parses a normal date', () => {
    expect(parseGs1Date('270315', NOW)).toBe('2027-03-15')
  })
  it('treats day 00 as the last day of the month', () => {
    expect(parseGs1Date('270300', NOW)).toBe('2027-03-31')
    expect(parseGs1Date('280200', NOW)).toBe('2028-02-29') // leap year
    expect(parseGs1Date('270200', NOW)).toBe('2027-02-28')
    expect(parseGs1Date('261100', NOW)).toBe('2026-11-30')
  })
  it('applies the GS1 century window', () => {
    expect(parseGs1Date('760101', NOW)).toBe('2076-01-01') // +50 -> same century
    expect(parseGs1Date('770101', NOW)).toBe('1977-01-01') // +51 -> previous century
    expect(parseGs1Date('010101', NOW)).toBe('2001-01-01')
  })
  it('rejects impossible dates', () => {
    expect(parseGs1Date('271301', NOW)).toBeUndefined()
    expect(parseGs1Date('270230', NOW)).toBeUndefined()
    expect(parseGs1Date('27AB01', NOW)).toBeUndefined()
  })
})

describe('parseGs1', () => {
  it('parses GTIN, expiry, batch and serial separated by FNC1/GS', () => {
    const r = parseGs1(`010950110153000317270331` + `10LOT42A${GS}21SN0012345678`, NOW)
    expect(r.errors).toEqual([])
    expect(r.gtin).toBe('09501101530003')
    expect(r.gtinValid).toBe(true)
    expect(r.expiryDate).toBe('2027-03-31')
    expect(r.batch).toBe('LOT42A')
    expect(r.serial).toBe('SN0012345678')
    expect(r.elements.map((e) => e.ai)).toEqual(['01', '17', '10', '21'])
  })

  it('handles a variable-length element at the very end with no trailing GS', () => {
    const r = parseGs1('01095011015300031727033110BATCH9', NOW)
    expect(r.batch).toBe('BATCH9')
  })

  it('reads UAE-style order: GTIN, serial, expiry, batch', () => {
    const r = parseGs1(`0106291100123454` + `21A1B2C3D4E5F6${GS}17250930${GS}10XY-77`, NOW)
    expect(r.gtin).toBe('06291100123454')
    expect(r.serial).toBe('A1B2C3D4E5F6')
    expect(r.expiryDate).toBe('2025-09-30')
    expect(r.batch).toBe('XY-77')
  })

  it('strips a symbology identifier and a leading FNC1', () => {
    const r = parseGs1(`]d2${GS}0109501101530003172703001` + '0L1', NOW)
    expect(r.gtin).toBe('09501101530003')
    expect(r.expiryDate).toBe('2027-03-31')
    expect(r.batch).toBe('L1')
  })

  it('parses human-readable (AI) form', () => {
    const r = parseGs1('(01)09501101530003(17)271100(10)AB123(21)99', NOW)
    expect(r.errors).toEqual([])
    expect(r.expiryDate).toBe('2027-11-30')
    expect(r.batch).toBe('AB123')
    expect(r.serial).toBe('99')
  })

  it('accepts <GS> and escaped GS substitutes', () => {
    const r = parseGs1('10ABC<GS>21XYZ', NOW)
    expect(r.batch).toBe('ABC')
    expect(r.serial).toBe('XYZ')
  })

  it('flags a bad GTIN check digit without discarding the other data', () => {
    const r = parseGs1('010950110153000417270331', NOW)
    expect(r.gtinValid).toBe(false)
    expect(r.expiryDate).toBe('2027-03-31')
  })

  it('reports truncated fixed-length elements', () => {
    const r = parseGs1('0109501101', NOW)
    expect(r.errors[0]).toMatch(/truncated/)
    expect(r.gtin).toBeUndefined()
  })

  it('reports unknown AIs and stops', () => {
    const r = parseGs1('99' + 'X'.repeat(5) + `${GS}ZZ`, NOW)
    // 99 is an internal AI so this parses; a truly unknown AI is "09..."
    expect(r.elements[0].ai).toBe('99')
    const bad = parseGs1('0912345', NOW)
    expect(bad.errors[0]).toMatch(/Unknown application identifier/)
  })

  it('reports an invalid expiry date', () => {
    const r = parseGs1('0109501101530003171399' + '99', NOW)
    expect(r.errors.join()).toMatch(/Invalid expiry/)
    expect(r.expiryDate).toBeUndefined()
  })
})

describe('interpretBarcode', () => {
  it('uses GS1 parsing for a DataMatrix with GS1 symbology id', () => {
    const r = interpretBarcode(
      {
        format: 'DataMatrix',
        text: `010950110153000317270331${'10A1'}`,
        symbologyIdentifier: ']d2',
      },
      NOW,
    )
    expect(r?.expiryDate).toBe('2027-03-31')
  })
  it('turns a bare EAN-13 into a GTIN-14', () => {
    const r = interpretBarcode({ format: 'EAN13', text: '5012345678900' }, NOW)
    expect(r?.gtin).toBe('05012345678900')
    expect(r?.gtinValid).toBe(true)
  })
  it('ignores unrelated codes', () => {
    expect(interpretBarcode({ format: 'QRCode', text: 'https://example.com' }, NOW)).toBeNull()
  })
  it('detects GS1-looking text', () => {
    expect(looksLikeGs1('0109501101530003')).toBe(true)
    expect(looksLikeGs1('hello world')).toBe(false)
  })
})
