import { getCell, parse, serialize, setCell } from '@defterjs/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { LOCAL_ORIGIN, applyTextToYText } from './index.js'

/** Edit a cell through the full pipeline, tagging the write with a Yjs origin (local by default). */
function editCell(
  ytext: Y.Text,
  col: number,
  row: number,
  value: string,
  origin: unknown = LOCAL_ORIGIN,
) {
  const next = serialize(setCell(parse(ytext.toString()), 0, col, row, value))
  applyTextToYText(ytext, next, origin)
}

const SEED = serialize(
  parse(
    '| Task | Owner | Points |\n| --- | --- | ---: |\n| Parser | Ada | 5 |\n| Engine | Lin | 8 |\n',
  ),
)

// This is the model `useYUndo` wraps: a Y.UndoManager scoped to LOCAL_ORIGIN. It reverts only the
// local user's edits, never a remote peer's concurrent change — the CRDT-correct undo for a shared
// Y.Text. (The hook is a thin React wrapper over exactly this; the logic lives here.)
describe('local-scoped undo (useYUndo model)', () => {
  it("reverts only the local user's edit, never a concurrent remote change", () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    // Live relay: each doc's local updates flow to the other tagged 'remote' (so they don't echo).
    docA.on('update', (u, o) => o !== 'remote' && Y.applyUpdate(docB, u, 'remote'))
    docB.on('update', (u, o) => o !== 'remote' && Y.applyUpdate(docA, u, 'remote'))
    const ta = docA.getText('t')
    const tb = docB.getText('t')
    ta.insert(0, SEED)

    const um = new Y.UndoManager(ta, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 })

    // Rows are 1-based with row 1 = header, so (1,3) is the Engine row's Owner, (2,4) a new row.
    editCell(ta, 1, 3, 'Grace') // local (docA): Owner Lin → Grace — tracked
    editCell(tb, 2, 4, '13') // remote (docB): Points on a fresh row — arrives on A as origin 'remote'

    let m = parse(ta.toString()).sheets[0]!
    expect(getCell(m, 1, 3)).toBe('Grace')
    expect(getCell(m, 2, 4)).toBe('13')

    um.undo()

    m = parse(ta.toString()).sheets[0]!
    expect(getCell(m, 1, 3)).toBe('Lin') // local edit reverted
    expect(getCell(m, 2, 4)).toBe('13') // remote edit untouched
    expect(ta.toString()).toBe(tb.toString()) // replicas still converge

    um.redo()
    m = parse(ta.toString()).sheets[0]!
    expect(getCell(m, 1, 3)).toBe('Grace') // redo restores the local edit
    expect(getCell(m, 2, 4)).toBe('13')
    expect(ta.toString()).toBe(tb.toString())
  })
})
