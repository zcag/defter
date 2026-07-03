import { getCell, parse, resolveStyles } from '@defterjs/core'
import { describe, expect, it } from 'vitest'
import { exportXlsx, importXlsx } from './index.js'

const SRC = `## Sheet: Data

| Item | Qty | Total |
| --- | ---: | ---: |
| Widget | 3 | =B2*4 |
| Gadget | 5 | =B3*2 |

\`\`\`defter-style
A1:C1  bold fill=surface-3
C2:C3  format=$#,##0.00
A1:C1  merge
\`\`\`
`

describe('xlsx round-trip', () => {
  it('preserves values, formulas, and basic styling through export → import', async () => {
    const model = parse(SRC)
    const buf = await exportXlsx(model)
    const back = await importXlsx(buf)

    const sheet = back.sheets[0]!
    expect(sheet.name).toBe('Data')
    expect(getCell(sheet, 0, 2)).toBe('Widget')
    expect(getCell(sheet, 1, 2)).toBe('3')
    expect(getCell(sheet, 2, 2)).toBe('=B2*4') // formula survived

    const styles = resolveStyles(sheet)
    expect(styles.attrs(0, 1).bold).toBe(true) // header bold survived
    expect(styles.mergeAnchor(0, 1)).not.toBeNull() // merge survived
  })
})
