import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { isError, parse } from '@defter/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createIronCalcEngine, initIronCalcSync } from './index.js'

beforeAll(() => {
  const require = createRequire(import.meta.url)
  const wasmPath = join(dirname(require.resolve('@ironcalc/wasm')), 'wasm_bg.wasm')
  initIronCalcSync(readFileSync(wasmPath))
})

const BUDGET = `## Sheet: Budget

| Item | Qty | Unit | Total |
| --- | ---: | ---: | ---: |
| Widget | 3 | 4 | =B2*C2 |
| Gadget | 5 | 2.5 | =B3*C3 |
| Total |  |  | =SUM(D2:D3) |
`

describe('IronCalc adapter', () => {
  it('computes arithmetic, ranges, and errors', () => {
    const grid = createIronCalcEngine().compute(parse(BUDGET))
    expect(grid.get('Budget', 3, 2)).toBe(12)
    expect(grid.get('Budget', 3, 3)).toBe(12.5)
    expect(grid.get('Budget', 3, 4)).toBe(24.5)

    const err = createIronCalcEngine().compute(parse('| x |\n|---|\n| =1/0 |\n'))
    expect(isError(err.get('Sheet1', 0, 2))).toBe(true)
  })

  it('resolves cross-sheet references', () => {
    const src =
      '## Sheet: One\n\n| v |\n|---|\n| 10 |\n\n## Sheet: Two\n\n| r |\n|---|\n| =One!A2*2 |\n'
    const grid = createIronCalcEngine().compute(parse(src))
    expect(grid.get('Two', 0, 2)).toBe(20)
  })

  it('resolves Defter named ranges (as IronCalc defined names)', () => {
    const src =
      '## Sheet: Data\n\n| m | s |\n|---|---:|\n| Jan | 10 |\n| Feb | 20 |\n\n```defter-style\nname Sales = B2:B3\n```\n\n## Sheet: R\n\n| x | y |\n|---|---:|\n| t | =SUM(Sales) |\n'
    const grid = createIronCalcEngine().compute(parse(src))
    expect(grid.get('R', 1, 2)).toBe(30)
  })

  it('agrees with the default engine on VLOOKUP', () => {
    const src =
      '| Name | Age |\n| --- | ---: |\n| Ada | 36 |\n| Lin | 29 |\n| q | =VLOOKUP("Lin", A2:B3, 2, FALSE) |\n'
    const grid = createIronCalcEngine().compute(parse(src))
    expect(grid.get('Sheet1', 1, 4)).toBe(29)
  })
})
