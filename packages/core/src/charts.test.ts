import { describe, expect, it } from 'vitest'
import { resolveChartData } from './charts.js'
import type { ComputedGrid } from './compute.js'
import { insertRows } from './edit.js'
import { type Model, getCell } from './model.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import { parseLiteral } from './values.js'

// A trivial computed grid that just types literal cells (no formulas in these fixtures).
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

| Month | Sales |
| --- | ---: |
| Jan | 10 |
| Feb | 20 |
| Mar | 30 |

\`\`\`defter-style
A1:B1  bold
chart type=bar title="Monthly sales" x=A2:A4 y=B2:B4
\`\`\`
`

describe('charts', () => {
  it('parses and round-trips a chart spec', () => {
    const m = parse(SRC)
    const chart = m.sheets[0]!.charts[0]!
    expect(chart.type).toBe('bar')
    expect(chart.title).toBe('Monthly sales')
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('shifts chart ranges when a row is inserted', () => {
    const m = insertRows(parse(SRC), 0, 2, 1) // insert a blank row before row 2
    const chart = m.sheets[0]!.charts[0]!
    // labels A2:A4 → A3:A5, values B2:B4 → B3:B5
    expect(chart.labels?.start.row).toBe(3)
    expect(chart.values[0]!.end.row).toBe(5)
  })

  it('resolves chart data via a computed grid', () => {
    const m = parse(SRC)
    const data = resolveChartData('S', m.sheets[0]!.charts[0]!, literalGrid(m))
    expect(data.labels).toEqual(['Jan', 'Feb', 'Mar'])
    expect(data.series[0]).toEqual([10, 20, 30])
  })

  it('supports multiple series (y=B..,C..)', () => {
    const src =
      '## Sheet: S\n\n| m | a | b |\n|---|---:|---:|\n| Jan | 1 | 4 |\n| Feb | 2 | 5 |\n\n```defter-style\nchart type=bar x=A2:A3 y=B2:B3,C2:C3\n```\n'
    const m = parse(src)
    expect(m.sheets[0]!.charts[0]!.values).toHaveLength(2)
    const data = resolveChartData('S', m.sheets[0]!.charts[0]!, literalGrid(m))
    expect(data.series).toEqual([[1, 2], [4, 5]])
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })
})
