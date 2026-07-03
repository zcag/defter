import { describe, expect, it } from 'vitest'
import { insertCols } from './edit.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import { resolveValidation } from './styling.js'

const SRC = `## Sheet: S

| Task | Status |
| --- | :-: |
| A | Todo |
| B | Done |

\`\`\`defter-style
validate B2:B3 list=Todo,Doing,Done
\`\`\`
`

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
