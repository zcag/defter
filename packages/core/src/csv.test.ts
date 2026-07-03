import { describe, expect, it } from 'vitest'
import { csvToModel, modelToCsv, parseCsv } from './csv.js'
import { getCell } from './model.js'
import { parse } from './parse.js'

describe('CSV', () => {
  it('parses quoted fields with commas, quotes, and newlines', () => {
    const rows = parseCsv('a,"b,c","d""e","f\ng"')
    expect(rows).toEqual([['a', 'b,c', 'd"e', 'f\ng']])
  })

  it('round-trips model → csv → model on values', () => {
    const m = parse('| Name | Note |\n|---|---|\n| Ada | hi, there |\n| Lin | "quoted" |\n')
    const csv = modelToCsv(m)
    const back = csvToModel(csv, 'X')
    expect(getCell(back.sheets[0]!, 0, 2)).toBe('Ada')
    expect(getCell(back.sheets[0]!, 1, 2)).toBe('hi, there')
    expect(getCell(back.sheets[0]!, 1, 3)).toBe('"quoted"')
  })

  it('keeps formulas as source on export without an engine', () => {
    const m = parse('| a | b |\n|---|---|\n| 2 | =A2*3 |\n')
    expect(modelToCsv(m)).toContain('=A2*3')
  })
})
