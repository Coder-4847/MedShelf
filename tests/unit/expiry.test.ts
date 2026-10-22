import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  endOfMonth,
  expiryStatus,
  formatExpiry,
  isLowStock,
  parseExpiryInput,
  todayIso,
} from '../../src/lib/expiry'

const NOW = new Date(2026, 9, 22, 23, 30) // 22 Oct 2026, late evening local

describe('expiryStatus', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(todayIso(NOW)).toBe('2026-10-22')
    expect(daysUntil('2026-10-22', NOW)).toBe(0)
  })
  it('treats today as still valid and yesterday as expired', () => {
    expect(expiryStatus('2026-10-22', 60, NOW)).toBe('soon')
    expect(expiryStatus('2026-10-21', 60, NOW)).toBe('expired')
  })
  it('flags items inside the warning window', () => {
    expect(expiryStatus('2026-12-21', 60, NOW)).toBe('soon') // exactly 60 days
    expect(expiryStatus('2026-12-22', 60, NOW)).toBe('ok')
    expect(expiryStatus('2026-12-22', 90, NOW)).toBe('soon')
  })
  it('handles missing or invalid dates', () => {
    expect(expiryStatus(undefined, 60, NOW)).toBe('none')
    expect(expiryStatus('not a date', 60, NOW)).toBe('none')
    expect(expiryStatus('2026-02-30', 60, NOW)).toBe('none')
  })
  it('counts days across a leap year', () => {
    expect(daysUntil('2028-03-01', new Date(2028, 1, 28))).toBe(2)
  })
})

describe('parseExpiryInput', () => {
  it.each([
    ['2027-03-31', '2027-03-31'],
    ['31/03/2027', '2027-03-31'],
    ['3.2027', '2027-03-31'],
    ['03/2027', '2027-03-31'],
    ['03/27', '2027-03-31'],
    ['2027-03', '2027-03-31'],
    ['Mar 2027', '2027-03-31'],
    ['MAR-27', '2027-03-31'],
    ['February 2028', '2028-02-29'],
    ['15 Jun 2027', '2027-06-15'],
  ])('%s -> %s', (input, expected) => {
    expect(parseExpiryInput(input)).toBe(expected)
  })
  it('rejects nonsense', () => {
    expect(parseExpiryInput('')).toBeUndefined()
    expect(parseExpiryInput('13/2027')).toBeUndefined()
    expect(parseExpiryInput('31/02/2027')).toBeUndefined()
    expect(parseExpiryInput('abc')).toBeUndefined()
  })
  it('computes end of month', () => {
    expect(endOfMonth(2024, 2)).toBe('2024-02-29')
    expect(endOfMonth(2025, 2)).toBe('2025-02-28')
  })
})

describe('formatting and stock', () => {
  it('formats dates', () => {
    expect(formatExpiry('2027-03-05')).toBe('05 Mar 2027')
    expect(formatExpiry(undefined)).toBe('')
  })
  it('low stock uses item threshold over default', () => {
    expect(isLowStock(1, undefined, 1)).toBe(true)
    expect(isLowStock(2, undefined, 1)).toBe(false)
    expect(isLowStock(2, 3, 1)).toBe(true)
    expect(isLowStock(0, 0, 1)).toBe(true)
  })
})
