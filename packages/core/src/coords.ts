/**
 * A1 coordinate system.
 *
 * Convention (see docs/FORMAT.md): columns are 0-based indices (A = 0) exposed as
 * bijective base-26 letters; rows are the 1-based A1 row numbers (row 1 = header,
 * row 2 = first data row). Array access into a sheet grid is `grid[row - 1][col]`.
 */

/** A single cell reference, possibly absolute in either axis and possibly cross-sheet. */
export interface Ref {
  col: number
  row: number
  colAbs: boolean
  rowAbs: boolean
  sheet?: string
}

/** A rectangular range, normalized so start is the top-left and end the bottom-right. */
export interface Range {
  start: Ref
  end: Ref
  sheet?: string
}

/** Convert a 0-based column index to its bijective base-26 label. 0→A, 25→Z, 26→AA. */
export function columnLabel(index: number): string {
  if (index < 0 || !Number.isInteger(index)) throw new RangeError(`bad column index: ${index}`)
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

/** Convert a column label (case-insensitive) to a 0-based index. A→0, Z→25, AA→26. */
export function columnIndex(label: string): number {
  const s = label.toUpperCase()
  if (!/^[A-Z]+$/.test(s)) throw new SyntaxError(`bad column label: ${label}`)
  let n = 0
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64)
  }
  return n - 1
}

const REF_RE = /^(?:(?:'([^']*)'|([A-Za-z_][\w]*))!)?(\$?)([A-Za-z]+)(\$?)(\d+)$/

/**
 * Parse a single reference. Accepts optional `Sheet!` or `'Sheet name'!` prefix and
 * `$` absolute markers. Throws on malformed input.
 */
export function parseRef(text: string): Ref {
  const m = REF_RE.exec(text.trim())
  if (!m) throw new SyntaxError(`bad cell reference: ${text}`)
  const [, quotedSheet, bareSheet, colAbs, colLetters, rowAbs, rowDigits] = m
  const sheet = quotedSheet ?? bareSheet
  const row = Number.parseInt(rowDigits!, 10)
  if (row < 1) throw new RangeError(`row must be >= 1: ${text}`)
  return {
    col: columnIndex(colLetters!),
    row,
    colAbs: colAbs === '$',
    rowAbs: rowAbs === '$',
    sheet: sheet || undefined,
  }
}

/** Serialize a reference back to A1 text, including `$` markers and sheet prefix. */
export function formatRef(ref: Ref): string {
  const sheet = ref.sheet ? `${quoteSheet(ref.sheet)}!` : ''
  return `${sheet}${ref.colAbs ? '$' : ''}${columnLabel(ref.col)}${ref.rowAbs ? '$' : ''}${ref.row}`
}

/** A sheet name needs quoting in a reference if it isn't a bare identifier. */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][\w]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

/** Parse a range `A1:B4` (or a single cell, treated as a 1×1 range). Normalizes corners. */
export function parseRange(text: string): Range {
  const t = text.trim()
  const colon = splitTopLevelColon(t)
  if (!colon) {
    const ref = parseRef(t)
    return { start: ref, end: { ...ref, sheet: undefined }, sheet: ref.sheet }
  }
  const start = parseRef(colon[0])
  const end = parseRef(colon[1])
  return normalizeRange({ start, end, sheet: start.sheet })
}

function splitTopLevelColon(t: string): [string, string] | null {
  const i = t.indexOf(':')
  if (i < 0) return null
  return [t.slice(0, i), t.slice(i + 1)]
}

/** Reorder corners so start ≤ end on both axes; carry the sheet from start. */
export function normalizeRange(r: Range): Range {
  const minCol = Math.min(r.start.col, r.end.col)
  const maxCol = Math.max(r.start.col, r.end.col)
  const minRow = Math.min(r.start.row, r.end.row)
  const maxRow = Math.max(r.start.row, r.end.row)
  return {
    sheet: r.sheet ?? r.start.sheet,
    start: { col: minCol, row: minRow, colAbs: r.start.colAbs, rowAbs: r.start.rowAbs },
    end: { col: maxCol, row: maxRow, colAbs: r.end.colAbs, rowAbs: r.end.rowAbs },
  }
}

/** Serialize a range. A 1×1 range collapses to a single cell. */
export function formatRange(r: Range): string {
  const sheet = r.sheet ? `${quoteSheet(r.sheet)}!` : ''
  const start = formatRef({ ...r.start, sheet: undefined })
  if (r.start.col === r.end.col && r.start.row === r.end.row) return `${sheet}${start}`
  const end = formatRef({ ...r.end, sheet: undefined })
  return `${sheet}${start}:${end}`
}

/** Iterate every cell ref inside a range (row-major). */
export function* cellsInRange(r: Range): Generator<{ col: number; row: number }> {
  for (let row = r.start.row; row <= r.end.row; row++) {
    for (let col = r.start.col; col <= r.end.col; col++) {
      yield { col, row }
    }
  }
}
