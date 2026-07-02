import { type Model, isError, parse } from '@defter/core'
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
})
