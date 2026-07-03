import { describe, expect, it } from 'vitest'
import { formatNumber, formatValue } from './format.js'
import { ERR, LOCALE_EN, LOCALE_TR } from './values.js'

describe('number formatting', () => {
  it('handles grouping, decimals, percent, currency', () => {
    expect(formatNumber(1234.5, '#,##0.00', LOCALE_EN)).toBe('1,234.50')
    expect(formatNumber(1234.5, '$#,##0.00', LOCALE_EN)).toBe('$1,234.50')
    expect(formatNumber(0.5, '0%', LOCALE_EN)).toBe('50%')
    expect(formatNumber(1234, '#,##0', LOCALE_EN)).toBe('1,234')
  })

  it('uses locale separators (Turkish decimal comma)', () => {
    expect(formatNumber(1234.5, '#,##0.00', LOCALE_TR)).toBe('1.234,50')
  })

  it('multi-section: negatives in parentheses', () => {
    expect(formatNumber(-1234.5, '#,##0.00;(#,##0.00)', LOCALE_EN)).toBe('(1,234.50)')
    expect(formatNumber(1234.5, '#,##0.00;(#,##0.00)', LOCALE_EN)).toBe('1,234.50')
    expect(formatNumber(-5, '$#,##0.00', LOCALE_EN)).toBe('-$5.00') // no neg section → leading minus
    expect(formatNumber(-5, '[Red]#,##0;[Red](#,##0)', LOCALE_EN)).toBe('(5)') // color tokens stripped
  })

  it('passes through errors and text', () => {
    expect(formatValue(ERR.div0)).toBe('#DIV/0!')
    expect(formatValue('hello')).toBe('hello')
    expect(formatValue(true)).toBe('TRUE')
  })
})
