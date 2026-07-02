/**
 * Minimal-splice diffing. Because `serialize` is byte-stable and compact, a single-cell edit
 * changes one small contiguous span of the text. `diffSplice` recovers that span as a single
 * replace (shared prefix + shared suffix), which is exactly what a text CRDT (Yjs `Y.Text`)
 * needs to merge concurrent edits to different cells without clobbering.
 */

export interface Splice {
  /** Start offset of the replaced region. */
  index: number
  /** Number of characters removed. */
  remove: number
  /** Text inserted at `index`. */
  insert: string
}

/** Compute the minimal single-region splice turning `a` into `b`. */
export function diffSplice(a: string, b: string): Splice {
  if (a === b) return { index: 0, remove: 0, insert: '' }
  let start = 0
  const min = Math.min(a.length, b.length)
  while (start < min && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  return { index: start, remove: endA - start, insert: b.slice(start, endB) }
}

/** Apply a splice to a string (for testing / non-CRDT hosts). */
export function applySplice(text: string, s: Splice): string {
  return text.slice(0, s.index) + s.insert + text.slice(s.index + s.remove)
}
