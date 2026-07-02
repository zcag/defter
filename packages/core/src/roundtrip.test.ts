import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { getCell } from './model.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'

const WORKED_EXAMPLE = `## Sheet: Budget

| Item | Qty | Unit | Total |
| --- | --- | --- | --- |
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| **Total** |  |  | =SUM(D2:D3) |

\`\`\`defter-style
A1:D1  bold fill=surface-2 align=center
C2:D4  format=#,##0.00
\`\`\`
`

describe('round-trip', () => {
  it('parses the worked example coordinates correctly', () => {
    const m = parse(WORKED_EXAMPLE)
    const s = m.sheets[0]!
    expect(s.name).toBe('Budget')
    expect(getCell(s, 0, 1)).toBe('Item') // A1 header
    expect(getCell(s, 0, 2)).toBe('Widget') // A2 first data row
    expect(getCell(s, 3, 2)).toBe('=B2*C2') // D2 formula preserved
    expect(getCell(s, 3, 4)).toBe('=SUM(D2:D3)')
    expect(s.styles).toHaveLength(2)
  })

  it('serialize is idempotent (one normalization pass reaches a fixed point)', () => {
    const once = serialize(parse(WORKED_EXAMPLE))
    const twice = serialize(parse(once))
    expect(twice).toBe(once)
  })

  it('a bare markdown table is a valid one-sheet document', () => {
    const m = parse('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(m.sheets).toHaveLength(1)
    expect(m.sheets[0]!.name).toBe('Sheet1')
    expect(m.sheets[0]!.headed).toBe(false)
    expect(getCell(m.sheets[0]!, 1, 2)).toBe('2')
  })

  it('preserves escaped pipes and column alignment', () => {
    const src = '| a | b |\n| :-- | --: |\n| x \\| y | 2 |\n'
    const m = parse(src)
    expect(getCell(m.sheets[0]!, 0, 2)).toBe('x | y')
    expect(m.sheets[0]!.colAlign).toEqual(['left', 'right'])
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('multi-sheet round-trips', () => {
    const src =
      '## Sheet: One\n\n| a |\n| --- |\n| 1 |\n\n## Sheet: Two\n\n| b |\n| --- |\n| 2 |\n'
    const m = parse(src)
    expect(m.sheets.map((s) => s.name)).toEqual(['One', 'Two'])
    expect(serialize(m)).toBe(src)
  })

  it('idempotent on arbitrary small grids', () => {
    const cell = fc.stringMatching(/^[a-zA-Z0-9 =+*().]{0,6}$/)
    const grid = fc.array(fc.array(cell, { minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 4,
    })
    fc.assert(
      fc.property(grid, (rows) => {
        const width = Math.max(...rows.map((r) => r.length))
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
        const body = rows.map((r) => `| ${pad(r).join(' | ')} |`)
        const src = `${body[0]}\n| ${Array(width).fill('---').join(' | ')} |\n${body.slice(1).join('\n')}\n`
        const once = serialize(parse(src))
        const twice = serialize(parse(once))
        expect(twice).toBe(once)
      }),
    )
  })
})
