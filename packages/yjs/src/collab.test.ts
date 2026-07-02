import { getCell, parse, serialize, setCell } from '@defter/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyTextToYText } from './index.js'

/** Edit a cell through the full pipeline: parse → setCell → serialize → minimal splice into Y.Text. */
function editCell(ytext: Y.Text, col: number, row: number, value: string) {
  const next = serialize(setCell(parse(ytext.toString()), 0, col, row, value))
  applyTextToYText(ytext, next, 'local')
}

// The canonical text bound to a CRDT must be normalized first, so edits are minimal splices
// rather than carrying one-time normalization churn. serialize(parse(...)) is that pass.
const SEED = serialize(
  parse('| Task | Owner | Points |\n| --- | --- | ---: |\n| Parser | Ada | 5 |\n| Engine | Lin | 8 |\n'),
)

describe('CRDT convergence', () => {
  it('merges concurrent edits to different cells without clobbering', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const ta = docA.getText('t')
    const tb = docB.getText('t')
    ta.insert(0, SEED)
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    expect(tb.toString()).toBe(SEED)

    // Go "offline": edit different cells on each replica.
    editCell(ta, 1, 3, 'Grace') // A changes Owner of row 3 (Ada→Grace)
    editCell(tb, 2, 4, '13') // B changes Points of row 4 (8→13)

    // Exchange only the missing updates (real CRDT sync).
    const svA = Y.encodeStateVector(docA)
    const svB = Y.encodeStateVector(docB)
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, svB))
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, svA))

    // Converged to identical bytes...
    expect(ta.toString()).toBe(tb.toString())
    // ...and both edits survived (parses to a valid grid carrying both changes).
    const merged = parse(ta.toString()).sheets[0]!
    expect(getCell(merged, 1, 3)).toBe('Grace')
    expect(getCell(merged, 2, 4)).toBe('13')
  })

  it('a live relay keeps two replicas in lockstep', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    docA.on('update', (u, o) => o !== 'remote' && Y.applyUpdate(docB, u, 'remote'))
    docB.on('update', (u, o) => o !== 'remote' && Y.applyUpdate(docA, u, 'remote'))
    const ta = docA.getText('t')
    const tb = docB.getText('t')
    ta.insert(0, SEED)

    editCell(ta, 2, 3, '21')
    editCell(tb, 0, 3, 'Lexer')
    expect(ta.toString()).toBe(tb.toString())
    const m = parse(ta.toString()).sheets[0]!
    expect(getCell(m, 2, 3)).toBe('21')
    expect(getCell(m, 0, 3)).toBe('Lexer')
  })
})
