import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applySplice, diffSplice } from './splice.js'

describe('diffSplice', () => {
  it('is minimal for a single-cell change', () => {
    const a = '| a | 1 |\n| --- | --- |\n| x | 2 |\n'
    const b = '| a | 1 |\n| --- | --- |\n| x | 9 |\n'
    const s = diffSplice(a, b)
    expect(s.remove).toBe(1)
    expect(s.insert).toBe('9')
    expect(applySplice(a, s)).toBe(b)
  })

  it('handles pure insertion and deletion', () => {
    expect(diffSplice('ab', 'axb')).toEqual({ index: 1, remove: 0, insert: 'x' })
    expect(diffSplice('axb', 'ab')).toEqual({ index: 1, remove: 1, insert: '' })
    expect(diffSplice('same', 'same')).toEqual({ index: 0, remove: 0, insert: '' })
  })

  it('applySplice(a, diffSplice(a,b)) === b for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(applySplice(a, diffSplice(a, b))).toBe(b)
      }),
    )
  })
})
