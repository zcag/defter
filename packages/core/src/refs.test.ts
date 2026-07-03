import { describe, expect, it } from 'vitest'
import { parseRange } from './coords.js'
import { deleteCols, deleteRows, fillDown, insertCols, insertRows, setCell, setStyle, sortRows } from './edit.js'
import { getCell } from './model.js'
import { parse } from './parse.js'
import { offsetReferences, rewriteFormula } from './refs.js'
import { serialize } from './serialize.js'

describe('rewriteFormula', () => {
  const rw = (f: string, axis: 'row' | 'col', at: number, delta: number) =>
    rewriteFormula(f, 'S', 'S', axis, at, delta)

  it('shifts rows on insert', () => {
    expect(rw('=A2+B2', 'row', 2, 1)).toBe('=A3+B3')
    expect(rw('=A1+A5', 'row', 3, 1)).toBe('=A1+A6') // A1 above insert stays
  })
  it('shifts cols on insert', () => {
    expect(rw('=B2*C2', 'col', 1, 1)).toBe('=C2*D2')
  })
  it('marks deleted refs as #REF!', () => {
    expect(rw('=A2+A3', 'row', 3, -1)).toBe('=A2+#REF!')
  })
  it('preserves $ absolutes and other sheets', () => {
    expect(rw('=$A$2', 'row', 2, 1)).toBe('=$A$3')
    expect(rw('=Other!A2', 'row', 2, 1)).toBe('=Other!A2')
  })
  it('shifts both endpoints of a cross-sheet range (end inherits the sheet)', () => {
    expect(rewriteFormula('=SUM(Sheet1!A1:A10)', 'Sheet2', 'Sheet1', 'row', 1, 5)).toBe(
      '=SUM(Sheet1!A6:A15)',
    )
    // A range on another sheet is untouched when editing this sheet.
    expect(rewriteFormula('=SUM(Sheet2!A1:A10)', 'Sheet1', 'Sheet1', 'row', 1, 5)).toBe(
      '=SUM(Sheet2!A1:A10)',
    )
  })
  it('shrinks a range when its boundary is deleted (not #REF!)', () => {
    expect(rw('=SUM(B1:D1)', 'col', 1, -1)).toBe('=SUM(B1:C1)')
    expect(rw('=SUM(A2:A4)', 'row', 2, -1)).toBe('=SUM(A2:A3)')
    // whole range deleted → #REF!
    expect(rw('=SUM(A2:A4)', 'row', 2, -3)).toBe('=SUM(#REF!)')
  })
  it('does not touch string literals or function names', () => {
    expect(rw('=CONCAT("A2 is here", A2)', 'row', 2, 1)).toBe('=CONCAT("A2 is here", A3)')
    expect(rw('=SUM(A2:A3)', 'row', 2, 1)).toBe('=SUM(A3:A4)')
  })
})

describe('structural edits keep formulas correct', () => {
  it('insertRows shifts a SUM range', () => {
    const src = '| Item | N |\n|---|---|\n| a | 1 |\n| b | 2 |\n| T | =SUM(B2:B3) |\n'
    const m = insertRows(parse(src), 0, 2, 1) // insert a row before row 2
    const sheet = m.sheets[0]!
    expect(getCell(sheet, 1, 5)).toBe('=SUM(B3:B4)') // total moved down and range shifted
  })

  it('deleteCols removes a column and shifts refs', () => {
    const src = '| a | b | c |\n|---|---|---|\n| 1 | 2 | =A2+C2 |\n'
    const m = deleteCols(parse(src), 0, 1, 1) // delete column B
    const sheet = m.sheets[0]!
    expect(sheet.width).toBe(2)
    expect(getCell(sheet, 1, 2)).toBe('=A2+B2') // former C2 is now B2, refs shifted
  })

  it('setCell auto-expands and round-trips', () => {
    const m = setCell(parse('| a |\n|---|\n| 1 |\n'), 0, 2, 3, 'hi')
    expect(getCell(m.sheets[0]!, 2, 3)).toBe('hi')
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('offsetReferences adjusts only relative parts', () => {
    expect(offsetReferences('B2*C2', 0, 1)).toBe('B3*C3')
    expect(offsetReferences('B$2*$C2', 0, 1)).toBe('B$2*$C3')
    expect(offsetReferences('SUM(A1:A3)', 1, 0)).toBe('SUM(B1:B3)')
  })

  it('fillDown copies the top cell with relative refs shifted', () => {
    const src = '| n | sq |\n|---|---|\n| 2 | =A2*A2 |\n| 3 |  |\n| 4 |  |\n'
    const m = fillDown(parse(src), 0, 1, 1, 2, 4)
    const sheet = m.sheets[0]!
    expect(getCell(sheet, 1, 3)).toBe('=A3*A3')
    expect(getCell(sheet, 1, 4)).toBe('=A4*A4')
  })

  it('setStyle merges into a same-target rule instead of duplicating', () => {
    let m = parse('| a | b |\n|---|---|\n| 1 | 2 |\n')
    const target = { kind: 'range' as const, range: parseRange('B2') }
    m = setStyle(m, 0, target, { format: '0%' })
    m = setStyle(m, 0, target, { format: '0.0%', bold: true })
    const rules = m.sheets[0]!.styles.filter((r) => r.target.kind === 'range')
    expect(rules).toHaveLength(1)
    expect(rules[0]!.attrs).toMatchObject({ format: '0.0%', bold: true })
  })

  it('sortRows reorders rows and keeps per-row formulas correct', () => {
    const src =
      '| Name | Score | Bonus |\n| --- | ---: | ---: |\n| Ada | 5 | =B2*2 |\n| Zoe | 9 | =B3*2 |\n| Lin | 1 | =B4*2 |\n'
    const m = sortRows(parse(src), 0, 1, true, 2, 4) // ascending by Score
    const s = m.sheets[0]!
    expect([getCell(s, 0, 2), getCell(s, 0, 3), getCell(s, 0, 4)]).toEqual(['Lin', 'Ada', 'Zoe'])
    expect([getCell(s, 1, 2), getCell(s, 1, 3), getCell(s, 1, 4)]).toEqual(['1', '5', '9'])
    // each Bonus formula references its own (new) row
    expect([getCell(s, 2, 2), getCell(s, 2, 3), getCell(s, 2, 4)]).toEqual(['=B2*2', '=B3*2', '=B4*2'])
  })

  it('insertCols shifts style targets', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |\n\n```defter-style\nB1:B2  bold\n```\n'
    const m = insertCols(parse(src), 0, 0, 1) // insert a column at the front
    const rule = m.sheets[0]!.styles[0]!
    expect(rule.target).toMatchObject({ kind: 'range' })
  })
})
