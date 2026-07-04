import { describe, expect, it } from 'vitest'
import { SHEET_OP_KINDS, SHEET_OP_SCHEMA, type SheetOp, applyOp, applyOps } from './apply.js'
import { parse } from './parse.js'
import { normalize, serialize } from './serialize.js'

const SRC = `## Sheet: Data

| Item | Qty | Price | Total |
| --- | ---: | ---: | ---: |
| Apples | 3 | 2 | =B2*C2 |
| Pears | 5 | 4 | =B3*C3 |
| Grapes | 2 | 6 | =B4*C4 |
| Total |  |  | =SUM(D2:D4) |

\`\`\`defter-style
A1:D1  bold fill=surface-3
D2:D5  format=$#,##0.00
\`\`\`
`

/** Every applyOp result must be canonical (idempotent under a re-serialize round-trip). */
function expectCanonical(text: string): string {
  expect(text).toBe(normalize(text))
  return text
}

describe('applyOp — cells', () => {
  it('setCells writes literals and formulas', () => {
    const out = expectCanonical(
      applyOp(SRC, {
        kind: 'setCells',
        cells: [
          { ref: 'B2', text: '10' },
          { ref: 'E1', text: 'Note' },
        ],
      }),
    )
    const s = parse(out).sheets[0]!
    expect(s.grid[1]![1]).toBe('10')
    expect(s.grid[0]![4]).toBe('Note')
  })
  it('throws on a bad A1 reference', () => {
    expect(() => applyOp(SRC, { kind: 'setCells', cells: [{ ref: 'ZZ', text: 'x' }] })).toThrow()
  })
})

describe('applyOp — rows', () => {
  it('insertRows shifts formula + style references down', () => {
    const out = expectCanonical(applyOp(SRC, { kind: 'insertRows', at: 2 }))
    // A blank row 2 pushes data down: old =B2*C2 becomes =B3*C3, the SUM widens, styles shift.
    expect(out).toContain('=B3*C3')
    expect(out).toContain('=SUM(D3:D5)')
    expect(out).toContain('D3:D6  format=$#,##0.00')
  })
  it('deleteRows shifts references up', () => {
    const out = expectCanonical(applyOp(SRC, { kind: 'deleteRows', at: 2 }))
    expect(out).toContain('=B2*C2') // old row 3's =B3*C3 slides up to row 2
    expect(out).toContain('=SUM(D2:D3)')
  })
})

describe('applyOp — columns', () => {
  it('insertCols accepts a column letter and shifts references right', () => {
    const out = expectCanonical(applyOp(SRC, { kind: 'insertCols', at: 'A' }))
    // Everything shifts one column right: B2*C2 → C2*D2, SUM(D2:D4) → SUM(E2:E4).
    expect(out).toContain('=C2*D2')
    expect(out).toContain('=SUM(E2:E4)')
  })
  it('deleteCols accepts a 0-based index', () => {
    const out = expectCanonical(applyOp(SRC, { kind: 'deleteCols', at: 0 }))
    expect(out).toContain('=A2*B2') // B/C/D all slid left one
  })
})

describe('applyOp — style + freeze', () => {
  it('setStyle merges attributes onto a range', () => {
    const out = expectCanonical(
      applyOp(SRC, { kind: 'setStyle', target: 'A1:D1', attrs: { align: 'center' } }),
    )
    expect(out).toContain('A1:D1  bold fill=surface-3 align=center')
  })
  it('setStyle folds a width attr on a single column into a width rule', () => {
    const out = expectCanonical(
      applyOp(SRC, { kind: 'setStyle', target: 'B:B', attrs: { width: 120 } }),
    )
    expect(out).toContain('B:B  width=120')
  })
  it('setFreeze writes and clears the freeze directive', () => {
    const frozen = expectCanonical(applyOp(SRC, { kind: 'setFreeze', rows: 1, cols: 1 }))
    expect(frozen).toContain('freeze rows=1 cols=1')
    const thawed = expectCanonical(applyOp(frozen, { kind: 'setFreeze', rows: 0, cols: 0 }))
    expect(thawed).not.toContain('freeze')
  })
})

const MULTI = `## Sheet: One

| A | B |
| --- | --- |
| 1 | 2 |

## Sheet: Two

| C | D |
| --- | --- |
| 3 | 4 |
`

describe('applyOp — sheet ops + resolution', () => {
  it('addSheet appends by default and can place after a sheet', () => {
    const appended = parse(expectCanonical(applyOp(MULTI, { kind: 'addSheet', name: 'Zed' })))
    expect(appended.sheets.map((s) => s.name)).toEqual(['One', 'Two', 'Zed'])
    const placed = parse(
      expectCanonical(applyOp(MULTI, { kind: 'addSheet', name: 'Mid', after: 'One' })),
    )
    expect(placed.sheets.map((s) => s.name)).toEqual(['One', 'Mid', 'Two'])
  })
  it('renameSheet / deleteSheet resolve by name and index', () => {
    const renamed = parse(applyOp(MULTI, { kind: 'renameSheet', sheet: 'Two', name: 'Second' }))
    expect(renamed.sheets[1]!.name).toBe('Second')
    const deleted = parse(applyOp(MULTI, { kind: 'deleteSheet', sheet: 1 }))
    expect(deleted.sheets.map((s) => s.name)).toEqual(['One'])
  })
  it('targets a named sheet for a cell edit', () => {
    const out = applyOp(MULTI, {
      kind: 'setCells',
      sheet: 'Two',
      cells: [{ ref: 'A2', text: '99' }],
    })
    expect(parse(out).sheets[1]!.grid[1]![0]).toBe('99')
    expect(parse(out).sheets[0]!.grid[1]![0]).toBe('1') // first sheet untouched
  })
  it('throws on an unknown sheet name and an out-of-range index', () => {
    expect(() => applyOp(MULTI, { kind: 'deleteSheet', sheet: 'Nope' })).toThrow(/unknown sheet/)
    expect(() => applyOp(MULTI, { kind: 'deleteSheet', sheet: 9 })).toThrow(/out of range/)
  })
})

describe('applyOps — batch', () => {
  it('applies a sequence left-to-right, each op seeing the prior result', () => {
    const out = expectCanonical(
      applyOps(SRC, [
        { kind: 'insertRows', at: 2 }, // push data down
        {
          kind: 'setCells',
          cells: [
            { ref: 'A2', text: 'Bananas' },
            { ref: 'B2', text: '7' },
            { ref: 'C2', text: '1' },
            { ref: 'D2', text: '=B2*C2' },
          ],
        },
        { kind: 'setStyle', target: 'A2:D2', attrs: { italic: true } },
      ]),
    )
    const s = parse(out).sheets[0]!
    expect(s.grid[1]![0]).toBe('Bananas')
    expect(out).toContain('=SUM(D3:D5)') // total's range shifted down past the inserted row
    expect(out).toContain('A2:D2  italic')
  })
  it('a throwing op aborts the whole batch', () => {
    expect(() =>
      applyOps(SRC, [
        { kind: 'setCells', cells: [{ ref: 'B2', text: '1' }] },
        { kind: 'setCells', cells: [{ ref: 'nope', text: '2' }] }, // bad ref
      ]),
    ).toThrow()
  })
})

describe('SHEET_OP_SCHEMA', () => {
  it('has a oneOf entry for every SheetOp kind and nothing extra', () => {
    const schemaKinds = SHEET_OP_SCHEMA.oneOf.map((v) => v.properties.kind.const)
    expect(new Set(schemaKinds)).toEqual(new Set(SHEET_OP_KINDS))
    expect(schemaKinds).toHaveLength(SHEET_OP_KINDS.length)
    // Compile-time proof that SHEET_OP_KINDS is exactly the SheetOp discriminant (both directions).
    type Extra = Exclude<(typeof SHEET_OP_KINDS)[number], SheetOp['kind']>
    type Missing = Exclude<SheetOp['kind'], (typeof SHEET_OP_KINDS)[number]>
    const _extraNone: Extra extends never ? true : false = true
    const _missingNone: Missing extends never ? true : false = true
    expect(_extraNone && _missingNone).toBe(true)
  })
})
