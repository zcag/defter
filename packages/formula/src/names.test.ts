import { insertRows, parse, serialize } from '@defter/core'
import { describe, expect, it } from 'vitest'
import { createEngine } from './engine.js'

const SRC = `## Sheet: Data

| Month | Sales |
| --- | ---: |
| Jan | 10 |
| Feb | 20 |
| Mar | 30 |

\`\`\`defter-style
name Sales = B2:B4
\`\`\`

## Sheet: Report

| Metric | Value |
| --- | ---: |
| Total | =SUM(Sales) |
| Top | =MAX(Sales) |
`

describe('named ranges', () => {
  it('parses, round-trips, and resolves in formulas across sheets', () => {
    const m = parse(SRC)
    expect(m.sheets[0]!.names[0]).toMatchObject({ name: 'Sales' })
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))

    const grid = createEngine().compute(m)
    expect(grid.get('Report', 1, 2)).toBe(60) // SUM(Sales) = 10+20+30
    expect(grid.get('Report', 1, 3)).toBe(30) // MAX(Sales)
  })

  it('shifts the named range definition on structural edits', () => {
    const m = insertRows(parse(SRC), 0, 2, 1) // insert a row on the Data sheet
    // Sales B2:B4 → B3:B5; still sums the same numbers
    expect(m.sheets[0]!.names[0]!.range.start.row).toBe(3)
    const grid = createEngine().compute(m)
    expect(grid.get('Report', 1, 2)).toBe(60)
  })
})
