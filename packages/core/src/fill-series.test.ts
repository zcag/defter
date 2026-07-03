import { describe, expect, it } from 'vitest'
import { fillSeries } from './edit.js'
import { getCell } from './model.js'
import { parse } from './parse.js'

/** Build a single-column sheet: header + the given data cells starting at row 2. */
const colDoc = (cells: string[]) => `| n |\n|---|\n${cells.map((c) => `| ${c} |\n`).join('')}`

describe('fillSeries — smart fill-handle', () => {
  const down = (cells: string[], minRow: number, maxRow: number, targetRow: number) => {
    const m = fillSeries(parse(colDoc(cells)), 0, 0, minRow, 0, maxRow, 0, targetRow)
    const sheet = m.sheets[0]!
    const out: string[] = []
    for (let r = maxRow + 1; r <= targetRow; r++) out.push(getCell(sheet, 0, r))
    return out
  }

  it('extrapolates an arithmetic run', () => {
    expect(down(['1', '2', '', '', ''], 2, 3, 6)).toEqual(['3', '4', '5'])
    expect(down(['5', '10', '', ''], 2, 3, 5)).toEqual(['15', '20'])
    expect(down(['10', '8', '', ''], 2, 3, 5)).toEqual(['6', '4'])
  })

  it('copies a lone number instead of incrementing it', () => {
    expect(down(['7', '', ''], 2, 2, 4)).toEqual(['7', '7'])
  })

  it('continues month and weekday names, preserving case and wrapping', () => {
    expect(down(['Jan', '', ''], 2, 2, 4)).toEqual(['Feb', 'Mar'])
    expect(down(['November', '', ''], 2, 2, 4)).toEqual(['December', 'January'])
    expect(down(['Monday', '', ''], 2, 2, 4)).toEqual(['Tuesday', 'Wednesday'])
    expect(down(['SUN', '', ''], 2, 2, 3)).toEqual(['MON'])
  })

  it('increments a trailing integer on prefixed text', () => {
    expect(down(['Item 1', 'Item 2', '', ''], 2, 3, 5)).toEqual(['Item 3', 'Item 4'])
    expect(down(['Q1', '', ''], 2, 2, 4)).toEqual(['Q2', 'Q3'])
  })

  it('tiles formulas with references shifted by the offset', () => {
    const m = fillSeries(parse('| a | b |\n|---|---|\n| =B2 |  |\n|  |  |\n|  |  |\n'), 0, 0, 2, 0, 2, 0, 4)
    const sheet = m.sheets[0]!
    expect(getCell(sheet, 0, 3)).toBe('=B3')
    expect(getCell(sheet, 0, 4)).toBe('=B4')
  })

  it('repeats an unrecognised pattern', () => {
    expect(down(['x', 'y', '', '', ''], 2, 3, 6)).toEqual(['x', 'y', 'x'])
  })

  it('fills a row rightward', () => {
    const m = fillSeries(parse('| a | b | c | d | e |\n|---|---|---|---|---|\n| 1 | 2 |  |  |  |\n'), 0, 0, 2, 1, 2, 4, 2)
    const sheet = m.sheets[0]!
    expect([getCell(sheet, 2, 2), getCell(sheet, 3, 2), getCell(sheet, 4, 2)]).toEqual(['3', '4', '5'])
  })
})
