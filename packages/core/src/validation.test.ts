import { describe, expect, it } from 'vitest'
import type { ComputedGrid } from './compute.js'
import { addFilter, clearFilters, insertCols } from './edit.js'
import { type Model, getCell } from './model.js'
import { parseLiteral } from './values.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import { isChecked, parseISODate, resolveCheckbox, resolveDate, resolveHiddenRows, resolveValidation } from './styling.js'

const SRC = `## Sheet: S

| Task | Status |
| --- | :-: |
| A | Todo |
| B | Done |

\`\`\`defter-style
validate B2:B3 list=Todo,Doing,Done
\`\`\`
`

function litGrid(m: Model): ComputedGrid {
  const byName = new Map(m.sheets.map((s) => [s.name, s]))
  return { get: (sheet, col, row) => { const s = byName.get(sheet); return s ? parseLiteral(getCell(s, col, row)) : null } }
}

describe('data validation', () => {
  it('parses, round-trips, and resolves the option list', () => {
    const m = parse(SRC)
    expect(m.sheets[0]!.validations).toHaveLength(1)
    expect(resolveValidation(m.sheets[0]!, 1, 2)).toEqual(['Todo', 'Doing', 'Done'])
    expect(resolveValidation(m.sheets[0]!, 0, 2)).toBeNull()
    expect(serialize(parse(serialize(m)))).toBe(serialize(m))
  })

  it('shifts validation ranges on column insert', () => {
    const m = insertCols(parse(SRC), 0, 0, 1) // insert a column at the front
    const v = m.sheets[0]!.validations[0]!
    // B2:B3 → C2:C3 (col index 1 → 2)
    if (v.target.kind === 'range') expect(v.target.range.start.col).toBe(2)
  })
})

describe('checkbox cell type', () => {
  const SRC = `| Task | Done |
| --- | :-: |
| A | TRUE |
| B | FALSE |

\`\`\`defter-style
checkbox B2:B3
\`\`\`
`
  it('round-trips and resolves checkbox cells', () => {
    const m = parse(SRC)
    expect(resolveCheckbox(m.sheets[0]!, 1, 2)).toBe(true) // B2
    expect(resolveCheckbox(m.sheets[0]!, 0, 2)).toBe(false) // A2 (not a checkbox)
    expect(serialize(m)).toBe(serialize(parse(serialize(m))))
    expect(serialize(m)).toContain('checkbox B2:B3')
  })
  it('reference-rewrites the checkbox target on column insert', () => {
    const m = insertCols(parse(SRC), 0, 0, 1) // insert a column before A → B shifts to C
    expect(serialize(m)).toContain('checkbox C2:C3')
  })
  it('reads truthy values as checked', () => {
    expect(isChecked('TRUE')).toBe(true)
    expect(isChecked('yes')).toBe(true)
    expect(isChecked('FALSE')).toBe(false)
    expect(isChecked('')).toBe(false)
  })
})

describe('date cell type', () => {
  const SRC = `| Task | Due |
| --- | --- |
| A | 2026-07-10 |
| B |  |

\`\`\`defter-style
date B2:B3
\`\`\`
`
  it('round-trips and resolves date cells', () => {
    const m = parse(SRC)
    expect(resolveDate(m.sheets[0]!, 1, 2)).toBe(true) // B2
    expect(resolveDate(m.sheets[0]!, 0, 2)).toBe(false) // A2
    expect(serialize(m)).toBe(serialize(parse(serialize(m))))
    expect(serialize(m)).toContain('date B2:B3')
  })
  it('ref-rewrites the date target and parses ISO values', () => {
    const m = insertCols(parse(SRC), 0, 0, 1)
    expect(serialize(m)).toContain('date C2:C3')
    expect(parseISODate('2026-07-10')).toEqual({ year: 2026, month: 7, day: 10 })
    expect(parseISODate('2026-13-01')).toBeNull()
    expect(parseISODate('nope')).toBeNull()
  })
})

describe('row filters (views)', () => {
  const SRC = `| Item | Qty |
| --- | --- |
| A | 5 |
| B | 12 |
| C | 3 |
| D | 20 |

\`\`\`defter-style
filter B >= 10
\`\`\`
`
  it('round-trips and resolves hidden rows against computed values', () => {
    const m = parse(SRC)
    expect(serialize(m)).toBe(serialize(parse(serialize(m))))
    expect(serialize(m)).toContain('filter B >= 10')
    const hidden = resolveHiddenRows(m.sheets[0]!, litGrid(m))
    expect([...hidden].sort((a, b) => a - b)).toEqual([2, 4]) // A(5), C(3) hidden
  })
  it('filters a checkbox column against TRUE/FALSE regardless of case', () => {
    const src = `| Task | Done |\n| --- | :-: |\n| A | TRUE |\n| B | FALSE |\n\n\`\`\`defter-style\ncheckbox B2:B3\nfilter B = FALSE\n\`\`\`\n`
    const m = parse(src)
    const hidden = resolveHiddenRows(m.sheets[0]!, litGrid(m))
    expect([...hidden]).toEqual([2]) // A (TRUE) hidden; B (FALSE) shown
  })
  it('addFilter replaces per column; clearFilters empties; col shifts on insert', () => {
    let m = addFilter(parse(SRC), 0, 1, '=', 12)
    expect(m.sheets[0]!.filters).toEqual([{ col: 1, op: '=', value: 12 }])
    m = insertCols(m, 0, 0, 1) // insert before A → filter col B(1) → C(2)
    expect(m.sheets[0]!.filters[0]!.col).toBe(2)
    expect(clearFilters(m, 0).sheets[0]!.filters).toEqual([])
  })
})
