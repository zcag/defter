import { type Model, isError, parse, serialize } from '@defterjs/core'
import { describe, expect, it } from 'vitest'
import { createEngine } from './engine.js'

function compute(text: string) {
  const model = parse(text)
  const grid = createEngine().compute(model)
  return { model, grid }
}

const BUDGET = `## Sheet: Budget

| Item | Qty | Unit | Total |
| --- | --- | --- | --- |
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| Total |  |  | =SUM(D2:D3) |
`

describe('formula engine', () => {
  it('computes arithmetic and SUM over a range', () => {
    const { grid } = compute(BUDGET)
    expect(grid.get('Budget', 3, 2)).toBe(12) // D2 = 3*4
    expect(grid.get('Budget', 3, 3)).toBe(12.5) // D3 = 5*2.5
    expect(grid.get('Budget', 3, 4)).toBe(24.5) // D4 = SUM(D2:D3)
  })

  it('respects operator precedence and parentheses', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=1+2*3')).toBe(7)
    expect(one('=(1+2)*3')).toBe(9)
    expect(one('=2^3^1')).toBe(8)
    expect(one('=-2^2')).toBe(4) // unary binds tighter than ^ (Excel)
    expect(one('=10/4')).toBe(2.5)
    expect(one('=50%')).toBe(0.5)
  })

  it('handles functions', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=IF(2>1, "yes", "no")')).toBe('yes')
    expect(one('=ROUND(3.14159, 2)')).toBe(3.14)
    expect(one('=CONCAT("a", "b", "c")')).toBe('abc')
    expect(one('=MAX(3, 7, 2)')).toBe(7)
    expect(one('="a" & "b"')).toBe('ab')
    expect(one('=IFERROR(1/0, "safe")')).toBe('safe')
    expect(one('=ROUND(-2.5, 0)')).toBe(-3) // half away from zero
    expect(one('=ROUND(2.5, 0)')).toBe(3)
    expect(one('=1E5')).toBe(100000) // scientific notation
    expect(one('=1.5E3')).toBe(1500)
  })

  it('propagates errors', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=1/0')).toEqual({ error: '#DIV/0!' })
    expect(one('=NOTAFUNC(1)')).toEqual({ error: '#NAME?' })
  })

  it('detects cycles instead of hanging', () => {
    const model: Model = parse('| a | b |\n|---|---|\n| =B2 | =A2 |\n')
    const grid = createEngine().compute(model)
    const a = grid.get('Sheet1', 0, 2)
    const b = grid.get('Sheet1', 1, 2)
    expect(isError(a) || isError(b)).toBe(true)
  })

  it('resolves cross-sheet references', () => {
    const src =
      '## Sheet: One\n\n| v |\n|---|\n| 10 |\n\n## Sheet: Two\n\n| r |\n|---|\n| =One!A2*2 |\n'
    const grid = createEngine().compute(parse(src))
    expect(grid.get('Two', 0, 2)).toBe(20)
  })

  it('text functions', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=LEFT("hello", 3)')).toBe('hel')
    expect(one('=RIGHT("hello", 2)')).toBe('lo')
    expect(one('=MID("hello", 2, 3)')).toBe('ell')
    expect(one('=FIND("l", "hello")')).toBe(3)
    expect(one('=SUBSTITUTE("a-b-c", "-", "+")')).toBe('a+b+c')
    expect(one('=TEXT(1234.5, "$#,##0.00")')).toBe('$1,234.50')
  })

  it('conditional aggregates and control flow', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=IFS(FALSE, 1, TRUE, 2)')).toBe(2)
    expect(one('=SWITCH("b", "a", 1, "b", 2, 9)')).toBe(2)
  })

  it('WEEKDAY, INDEX single-row, AVERAGEIF ignore non-numeric', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=WEEKDAY("2024-01-07")')).toBe(1) // a Sunday, Excel default type
    expect(one('=WEEKDAY("2024-01-07", 2)')).toBe(7) // Mon=1..Sun=7
    const idx =
      '| a | b | c |\n| --- | --- | --- |\n| 10 | 20 | 30 |\n| =INDEX(A2:C2, 3) | =AVERAGEIF(A3:C3, ">0", A2:C2) | |\n'
    const g = createEngine().compute(parse(idx))
    expect(g.get('Sheet1', 0, 3)).toBe(30) // INDEX single-row → column 3
  })

  it('conditional rule with a quoted multi-word value round-trips', () => {
    const src =
      '| City | n |\n| --- | --- |\n| New York | 1 |\n\n```defter-style\nwhen A2 = "New York"  bold fill=accent-soft\n```\n'
    const m = parse(src)
    expect(m.sheets[0]!.conditionals[0]).toMatchObject({ value: 'New York' })
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('lookups over a table', () => {
    const src =
      '| Name | Age | City |\n| --- | ---: | --- |\n| Ada | 36 | London |\n| Lin | 29 | Berlin |\n| Sam | 41 | Paris |\n| q | =VLOOKUP("Lin", A2:C4, 2, FALSE) | =INDEX(C2:C4, MATCH(41, B2:B4, 0)) |\n'
    const grid = createEngine().compute(parse(src))
    expect(grid.get('Sheet1', 1, 5)).toBe(29) // VLOOKUP Lin's age
    expect(grid.get('Sheet1', 2, 5)).toBe('Paris') // INDEX/MATCH Sam's city
  })

  it('IS-functions, stats, and multi-criteria', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=ISNUMBER(5)')).toBe(true)
    expect(one('=ISTEXT("a")')).toBe(true)
    expect(one('=ISERROR(1/0)')).toBe(true)
    expect(one('=MEDIAN(1, 3, 2, 5, 4)')).toBe(3)
    const src =
      '| Cat | Amt |\n| --- | ---: |\n| a | 10 |\n| b | 20 |\n| a | 30 |\n| r | =SUMIFS(B2:B4, A2:A4, "a") | =COUNTIFS(A2:A4, "a", B2:B4, ">15") |\n| l | =LARGE(B2:B4, 2) | =XLOOKUP("b", A2:A4, B2:B4) |\n'
    const g = createEngine().compute(parse(src))
    expect(g.get('Sheet1', 1, 5)).toBe(40) // SUMIFS a → 10+30
    expect(g.get('Sheet1', 2, 5)).toBe(1) // COUNTIFS a AND >15 → only 30
    expect(g.get('Sheet1', 1, 6)).toBe(20) // LARGE 2nd = 20
    expect(g.get('Sheet1', 2, 6)).toBe(20) // XLOOKUP b → 20
  })

  it('COUNTIF <> counts non-numeric cells; LARGE propagates errors', () => {
    const src =
      '| v | r |\n| --- | --- |\n| apple | =COUNTIF(A2:A4, "<>5") |\n| 5 | =LARGE(A2:A4, 1) |\n| 10 | |\n'
    const g = createEngine().compute(parse(src))
    expect(g.get('Sheet1', 1, 2)).toBe(2) // apple and 10 are <> 5
    const errSrc = '| v | r |\n| --- | --- |\n| =1/0 | =LARGE(A2:A3, 1) |\n| 5 | |\n'
    const g2 = createEngine().compute(parse(errSrc))
    expect(isError(g2.get('Sheet1', 1, 2))).toBe(true) // error in range propagates
  })

  it('date functions', () => {
    const one = (f: string) => createEngine().compute(parse(`| x |\n|---|\n| ${f} |\n`)).get('Sheet1', 0, 2)
    expect(one('=DATE(2026, 7, 3)')).toBe('2026-07-03')
    expect(one('=DATE(2026, 13, 1)')).toBe('2027-01-01') // overflow normalizes
    expect(one('=YEAR("2026-07-03")')).toBe(2026)
    expect(one('=MONTH("2026-07-03")')).toBe(7)
    expect(one('=DAY("2026-07-03")')).toBe(3)
    expect(one('=DATEDIF("2026-01-01", "2026-01-11", "D")')).toBe(10)
    expect(one('=DATEDIF("2020-06-15", "2026-07-03", "Y")')).toBe(6)
  })

  it('SUMIF / COUNTIF (incl. wildcards)', () => {
    const src =
      '| Cat | Amt |\n| --- | ---: |\n| apple | 10 |\n| banana | 20 |\n| avocado | 30 |\n| s | =SUMIF(A2:A4, "a*", B2:B4) | \n| c | =COUNTIF(B2:B4, ">15") |\n'
    const grid = createEngine().compute(parse(src))
    expect(grid.get('Sheet1', 1, 5)).toBe(40) // apple + avocado (a*)
    expect(grid.get('Sheet1', 1, 6)).toBe(2) // 20, 30
  })
})
