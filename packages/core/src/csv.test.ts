import { describe, expect, it } from 'vitest'
import { csvToModel, modelToCsv, modelToCsvSheets, parseCsv } from './csv.js'
import { getCell } from './model.js'
import { parse } from './parse.js'

describe('CSV', () => {
  it('exports each sheet of a workbook to its own named CSV', () => {
    const m = parse('## Sheet: Alpha\n\n| a |\n|---|\n| 1 |\n\n## Sheet: Beta\n\n| b |\n|---|\n| 2 |\n')
    const sheets = modelToCsvSheets(m)
    expect(sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta'])
    expect(sheets[0]!.csv).toBe('a\n1')
    expect(sheets[1]!.csv).toBe('b\n2')
  })

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
