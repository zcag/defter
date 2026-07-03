import { describe, expect, it } from 'vitest'
import type { ComputedGrid } from './compute.js'
import { insertRows } from './edit.js'
import { getCell, type Model } from './model.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import { resolveConditionalAttrs } from './styling.js'
import { parseLiteral } from './values.js'

function literalGrid(model: Model): ComputedGrid {
  const byName = new Map(model.sheets.map((s) => [s.name, s]))
  return {
    get: (sheet, col, row) => {
      const s = byName.get(sheet)
      return s ? parseLiteral(getCell(s, col, row)) : null
    },
  }
}

const SRC = `## Sheet: S

| Team | Var |
| --- | ---: |
| A | 5 |
| B | -3 |
| C | 0 |

\`\`\`defter-style
A1:B1  bold
when B2:B4 < 0  color=danger bold
when B2:B4 >= 0  color=success
\`\`\`
`

describe('conditional formatting', () => {
  it('parses and round-trips conditional rules', () => {
    const m = parse(SRC)
    expect(m.sheets[0]!.conditionals).toHaveLength(2)
    expect(m.sheets[0]!.conditionals[0]).toMatchObject({ op: '<', value: 0 })
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('applies attrs based on the computed value', () => {
    const m = parse(SRC)
    const g = literalGrid(m)
    const sheet = m.sheets[0]!
    expect(resolveConditionalAttrs(sheet, g, 1, 3)).toMatchObject({ color: 'danger', bold: true }) // B3 = -3
    expect(resolveConditionalAttrs(sheet, g, 1, 2)).toMatchObject({ color: 'success' }) // B2 = 5
    expect(resolveConditionalAttrs(sheet, g, 1, 4)).toMatchObject({ color: 'success' }) // B4 = 0
  })

  it('shifts conditional ranges on structural edits', () => {
    const m = insertRows(parse(SRC), 0, 2, 1)
    const cond = m.sheets[0]!.conditionals[0]!
    expect(cond.target).toMatchObject({ kind: 'range' })
    // B2:B4 → B3:B5
    if (cond.target.kind === 'range') expect(cond.target.range.start.row).toBe(3)
  })
})
