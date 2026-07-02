import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  columnIndex,
  columnLabel,
  formatRange,
  formatRef,
  parseRange,
  parseRef,
} from './coords.js'

describe('column labels', () => {
  it('maps known boundaries', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(701)).toBe('ZZ')
    expect(columnLabel(702)).toBe('AAA')
  })
  it('round-trips index↔label', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20000 }), (i) => {
        expect(columnIndex(columnLabel(i))).toBe(i)
      }),
    )
  })
})

describe('refs', () => {
  it('parses plain, absolute and cross-sheet', () => {
    expect(parseRef('A1')).toMatchObject({ col: 0, row: 1, colAbs: false, rowAbs: false })
    expect(parseRef('$B$2')).toMatchObject({ col: 1, row: 2, colAbs: true, rowAbs: true })
    expect(parseRef('Sheet2!C3')).toMatchObject({ col: 2, row: 3, sheet: 'Sheet2' })
    expect(parseRef("'my sheet'!D4")).toMatchObject({ col: 3, row: 4, sheet: 'my sheet' })
  })
  it('round-trips ref text', () => {
    for (const t of ['A1', '$A$1', 'A$1', '$A1', 'Z99', 'AA10', 'Sheet2!B3']) {
      expect(formatRef(parseRef(t))).toBe(t)
    }
  })
  it("quotes sheet names that aren't identifiers", () => {
    expect(formatRef(parseRef("'my sheet'!D4"))).toBe("'my sheet'!D4")
  })
})

describe('ranges', () => {
  it('normalizes corners', () => {
    expect(formatRange(parseRange('B4:A1'))).toBe('A1:B4')
  })
  it('collapses 1×1', () => {
    expect(formatRange(parseRange('C3'))).toBe('C3')
  })
  it('round-trips', () => {
    for (const t of ['A1:B4', 'A1', 'Sheet2!A1:C9']) {
      expect(formatRange(parseRange(t))).toBe(t)
    }
  })
})
