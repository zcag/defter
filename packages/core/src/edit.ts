/**
 * Structured edit operations. These are the single vocabulary that humans, the renderer, and
 * agents all use to change a sheet — never a full-body rewrite. Each returns a new Model (the
 * input is not mutated). Reference rewriting for structural ops lives in refs.ts and is applied
 * here so formulas and style targets stay correct.
 */

import {
  type CondOp,
  type Model,
  type Sheet,
  type StyleAttrs,
  type StyleTarget,
  cloneModel,
  emptySheet,
} from './model.js'
import { parse } from './parse.js'
import { offsetReferences, shiftReferencesInModel } from './refs.js'
import { serialize } from './serialize.js'

function grow(sheet: Sheet, minWidth: number, minRows: number): void {
  if (minWidth > sheet.width) {
    for (const row of sheet.grid) while (row.length < minWidth) row.push('')
    while (sheet.colAlign.length < minWidth) sheet.colAlign.push(null)
    sheet.width = minWidth
  }
  while (sheet.grid.length < minRows) sheet.grid.push(Array(sheet.width).fill(''))
}

/** Set a single cell's logical text (col 0-based, row 1-based). Auto-expands the grid. */
export function setCell(model: Model, sheetIndex: number, col: number, row: number, text: string): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  grow(sheet, col + 1, row)
  sheet.grid[row - 1]![col] = text
  return next
}

/** Insert `count` blank rows before A1 row `at` (>=2 for data; 1 targets the header region). */
export function insertRows(model: Model, sheetIndex: number, at: number, count = 1): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet || count < 1) return next
  const index = Math.max(0, at - 1)
  const blanks = Array.from({ length: count }, () => Array(sheet.width).fill('') as string[])
  sheet.grid.splice(index, 0, ...blanks)
  shiftReferencesInModel(next, sheet.name, 'row', at, count)
  return next
}

/** Delete `count` rows starting at A1 row `at`. Cannot delete the header (row 1). */
export function deleteRows(model: Model, sheetIndex: number, at: number, count = 1): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet || count < 1 || at < 2) return next
  sheet.grid.splice(at - 1, count)
  shiftReferencesInModel(next, sheet.name, 'row', at, -count)
  return next
}

/** Insert `count` blank columns before 0-based column `at`. */
export function insertCols(model: Model, sheetIndex: number, at: number, count = 1): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet || count < 1) return next
  const index = Math.max(0, Math.min(at, sheet.width))
  for (const row of sheet.grid) row.splice(index, 0, ...Array(count).fill(''))
  sheet.colAlign.splice(index, 0, ...Array(count).fill(null))
  sheet.width += count
  shiftReferencesInModel(next, sheet.name, 'col', at, count)
  return next
}

function fillOne(src: string, dCol: number, dRow: number): string {
  return src.trim().startsWith('=') ? `=${offsetReferences(src.trim().slice(1), dCol, dRow)}` : src
}

/** Fill the top row of the range down into the rows below, adjusting relative references. */
export function fillDown(model: Model, sheetIndex: number, minCol: number, maxCol: number, minRow: number, maxRow: number): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  grow(sheet, maxCol + 1, maxRow)
  for (let c = minCol; c <= maxCol; c++) {
    const src = sheet.grid[minRow - 1]?.[c] ?? ''
    for (let r = minRow + 1; r <= maxRow; r++) sheet.grid[r - 1]![c] = fillOne(src, 0, r - minRow)
  }
  return next
}

/** Fill the left column of the range rightward, adjusting relative references. */
export function fillRight(model: Model, sheetIndex: number, minCol: number, maxCol: number, minRow: number, maxRow: number): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  grow(sheet, maxCol + 1, maxRow)
  for (let r = minRow; r <= maxRow; r++) {
    const src = sheet.grid[r - 1]?.[minCol] ?? ''
    for (let c = minCol + 1; c <= maxCol; c++) sheet.grid[r - 1]![c] = fillOne(src, c - minCol, 0)
  }
  return next
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAYS_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Re-apply the original casing of `sample` (all-caps, Title, or lower) to a lowercase `word`. */
function matchCase(word: string, sample: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase()
  if (sample[0] === sample[0]?.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1)
  return word
}

/** If every value is a name from `list` (case-insensitive), extend the sequence with wrap-around. */
function nameSeries(vals: string[], list: string[], count: number): string[] | null {
  const idx = vals.map((v) => list.indexOf(v.trim().toLowerCase()))
  if (idx.some((i) => i < 0)) return null
  const step = idx.length >= 2 ? idx[idx.length - 1]! - idx[idx.length - 2]! : 1
  const s = step === 0 ? 1 : step
  const out: string[] = []
  let cur = idx[idx.length - 1]!
  for (let i = 0; i < count; i++) {
    cur = (((cur + s) % list.length) + list.length) % list.length
    out.push(matchCase(list[cur]!, vals[vals.length - 1]!))
  }
  return out
}

/**
 * Continue a series of source values for `count` more cells (a smart fill-handle drag):
 * arithmetic number runs extrapolate, month/weekday names and `prefix<int>` text (e.g. "Item 3",
 * "Q1") increment, and anything else tiles/repeats. `dCol`/`dRow` are the per-step direction so
 * tiled formulas keep their relative references shifting correctly.
 */
function continueSeries(vals: string[], count: number, dCol: number, dRow: number): string[] {
  const L = vals.length
  // Formula pattern: tile the block, shifting refs by the offset from the original.
  if (vals.some((v) => v.trim().startsWith('='))) {
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const abs = L + i
      const shift = abs - (abs % L)
      out.push(fillOne(vals[abs % L]!, dCol * shift, dRow * shift))
    }
    return out
  }
  const nums = vals.map((v) => (v.trim() !== '' && /^-?\d*\.?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN))
  if (nums.every((n) => !Number.isNaN(n)) && L >= 2) {
    const d = nums[1]! - nums[0]!
    if (nums.every((n, i) => i === 0 || Math.abs(n - nums[i - 1]! - d) < 1e-9)) {
      const out: string[] = []
      let last = nums[L - 1]!
      for (let i = 0; i < count; i++) {
        last += d
        out.push(String(Math.round(last * 1e9) / 1e9))
      }
      return out
    }
  }
  for (const list of [MONTHS, MONTHS_ABBR, DAYS, DAYS_ABBR]) {
    const s = nameSeries(vals, list, count)
    if (s) return s
  }
  // Text with a trailing integer and a shared, non-empty prefix: increment the number.
  // (A bare number with no prefix falls through to a copy — matching a plain drag of one number.)
  const parts = vals.map((v) => /^(.*?)(-?\d+)$/.exec(v))
  const prefix = parts[0]?.[1] ?? ''
  if (parts.every((p) => p) && prefix !== '' && parts.every((p) => p![1] === prefix)) {
    const seq = parts.map((p) => Number(p![2]))
    let d = L >= 2 ? seq[L - 1]! - seq[L - 2]! : 1
    if (!Number.isFinite(d) || d === 0) d = 1
    const out: string[] = []
    let last = seq[L - 1]!
    for (let i = 0; i < count; i++) {
      last += d
      out.push(prefix + last)
    }
    return out
  }
  // Fallback: tile/repeat the source values.
  return Array.from({ length: count }, (_, i) => vals[(L + i) % L]!)
}

/**
 * Smart fill-handle drag: extend the selected block [minCol..maxCol]×[minRow..maxRow] to the drag
 * target (further down if `targetRow > maxRow`, or further right if `targetCol > maxCol`),
 * continuing whatever series each source line represents. Copies degrade gracefully to a repeat.
 */
export function fillSeries(
  model: Model,
  sheetIndex: number,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
  targetCol: number,
  targetRow: number,
): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  if (targetRow > maxRow) {
    grow(sheet, maxCol + 1, targetRow)
    const count = targetRow - maxRow
    for (let c = minCol; c <= maxCol; c++) {
      const src: string[] = []
      for (let r = minRow; r <= maxRow; r++) src.push(sheet.grid[r - 1]?.[c] ?? '')
      const filled = continueSeries(src, count, 0, 1)
      for (let i = 0; i < count; i++) sheet.grid[maxRow + i]![c] = filled[i]!
    }
  } else if (targetCol > maxCol) {
    grow(sheet, targetCol + 1, maxRow)
    const count = targetCol - maxCol
    for (let r = minRow; r <= maxRow; r++) {
      const src: string[] = []
      for (let c = minCol; c <= maxCol; c++) src.push(sheet.grid[r - 1]?.[c] ?? '')
      const filled = continueSeries(src, count, 1, 0)
      for (let i = 0; i < count; i++) sheet.grid[r - 1]![maxCol + 1 + i] = filled[i]!
    }
  }
  return next
}

/**
 * Sort data rows [fromRow, toRow] by a column. Whole rows move together, and each moved row's
 * formulas have their *relative* references offset by the row delta — so a per-row formula like
 * `=B2*C2` stays correct after the row lands in a new position. (Cross-row aggregate refs in a
 * sorted region are not preserved — sort data ranges, not their totals.)
 */
export function sortRows(
  model: Model,
  sheetIndex: number,
  byCol: number,
  ascending: boolean,
  fromRow: number,
  toRow: number,
): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet || fromRow < 2 || toRow < fromRow) return next

  const entries: { oldRow: number; cells: string[] }[] = []
  for (let r = fromRow; r <= toRow; r++) entries.push({ oldRow: r, cells: sheet.grid[r - 1]! })

  const dir = ascending ? 1 : -1
  entries.sort((a, b) => sortCompare(a.cells[byCol] ?? '', b.cells[byCol] ?? '') * dir)

  entries.forEach((entry, i) => {
    const newRow = fromRow + i
    const delta = newRow - entry.oldRow
    sheet.grid[newRow - 1] = entry.cells.map((text) =>
      text.trim().startsWith('=') ? `=${offsetReferences(text.trim().slice(1), 0, delta)}` : text,
    )
  })
  return next
}

function sortCompare(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  const aNum = a.trim() !== '' && !Number.isNaN(na)
  const bNum = b.trim() !== '' && !Number.isNaN(nb)
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a.localeCompare(b)
}

/** Append a new empty sheet with a unique name. Returns the new model (heading forced on serialize). */
export function addSheet(model: Model, name?: string): Model {
  const next = cloneModel(model)
  const used = new Set(next.sheets.map((s) => s.name.toLowerCase()))
  let finalName = name?.trim() || ''
  if (!finalName || used.has(finalName.toLowerCase())) {
    let n = next.sheets.length + 1
    finalName = `Sheet${n}`
    while (used.has(finalName.toLowerCase())) finalName = `Sheet${++n}`
  }
  const sheet = emptySheet(finalName, true)
  sheet.grid = [['', '', '']]
  sheet.width = 3
  sheet.colAlign = [null, null, null]
  next.sheets.push(sheet)
  return next
}

/** Rename a sheet. No-op if the name collides with another sheet. */
export function renameSheet(model: Model, sheetIndex: number, name: string): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  const trimmed = name.trim()
  if (!sheet || !trimmed) return next
  if (next.sheets.some((s, i) => i !== sheetIndex && s.name.toLowerCase() === trimmed.toLowerCase()))
    return next
  sheet.name = trimmed
  sheet.headed = true
  return next
}

/**
 * Set (or clear) the frozen-pane directive on a sheet, as a **minimal canonical-text edit** — this
 * is the text-in/text-out helper a host calls to toggle freeze so it travels with the document
 * (export, sync, search). `opts.rows`/`opts.cols` are the desired frozen-row / frozen-column counts;
 * an omitted axis counts as 0. When both resolve to 0 the `freeze` line is removed. To keep one axis
 * while changing the other, pass both (read the current values off the parsed model's `sheet.freeze`).
 */
export function setFreeze(
  text: string,
  opts: { rows?: number; cols?: number },
  sheetIndex = 0,
): string {
  const model = parse(text)
  const sheet = model.sheets[sheetIndex]
  if (!sheet) return serialize(model)
  const rows = Math.max(0, Math.floor(opts.rows ?? 0))
  const cols = Math.max(0, Math.floor(opts.cols ?? 0))
  if (rows <= 0 && cols <= 0) sheet.freeze = undefined
  else sheet.freeze = { rows, cols }
  return serialize(model)
}

/** Delete a sheet. No-op if it's the only sheet. */
export function deleteSheet(model: Model, sheetIndex: number): Model {
  const next = cloneModel(model)
  if (next.sheets.length <= 1) return next
  next.sheets.splice(sheetIndex, 1)
  return next
}

function targetsEqual(a: StyleTarget, b: StyleTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'range' && b.kind === 'range') {
    return (
      a.range.start.col === b.range.start.col &&
      a.range.start.row === b.range.start.row &&
      a.range.end.col === b.range.end.col &&
      a.range.end.row === b.range.end.row
    )
  }
  if (a.kind === 'cols' && b.kind === 'cols') return a.start === b.start && a.end === b.end
  if (a.kind === 'rows' && b.kind === 'rows') return a.start === b.start && a.end === b.end
  return false
}

/**
 * Apply a style to a target. If a rule with the *same* target already exists, its attributes are
 * merged in (keeping the text compact under repeated formatting) rather than appending a duplicate.
 */
export function setStyle(
  model: Model,
  sheetIndex: number,
  target: StyleTarget,
  attrs: StyleAttrs,
): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  const existing = sheet.styles.find((r) => targetsEqual(r.target, target))
  if (existing) Object.assign(existing.attrs, attrs)
  else sheet.styles.push({ target, attrs })
  return next
}

/** Remove style rules whose range target is fully contained in the given range. */
/** Add (or replace) a non-destructive row filter on a column. One filter per column. */
export function addFilter(model: Model, sheetIndex: number, col: number, op: CondOp, value: number | string): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  sheet.filters = sheet.filters.filter((f) => f.col !== col)
  sheet.filters.push({ col, op, value })
  return next
}

/** Remove all row filters from a sheet (show every row). */
export function clearFilters(model: Model, sheetIndex: number): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (sheet) sheet.filters = []
  return next
}

export function clearStylesIn(
  model: Model,
  sheetIndex: number,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  sheet.styles = sheet.styles.filter((r) => {
    if (r.target.kind !== 'range') return true
    const { start, end } = r.target.range
    const contained =
      start.col >= minCol && end.col <= maxCol && start.row >= minRow && end.row <= maxRow
    return !contained
  })
  return next
}

/** Set a column's width (px) in the style layer, replacing any prior single-column width rule. */
export function setColumnWidth(model: Model, sheetIndex: number, col: number, width: number): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  const existing = sheet.styles.find(
    (r) => r.target.kind === 'cols' && r.target.start === col && r.target.end === col && r.attrs.width !== undefined,
  )
  if (existing) existing.attrs.width = width
  else sheet.styles.push({ target: { kind: 'cols', start: col, end: col }, attrs: { width } })
  return next
}

/** Delete `count` columns starting at 0-based column `at`. */
export function deleteCols(model: Model, sheetIndex: number, at: number, count = 1): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet || count < 1) return next
  for (const row of sheet.grid) row.splice(at, count)
  sheet.colAlign.splice(at, count)
  sheet.width = Math.max(0, sheet.width - count)
  shiftReferencesInModel(next, sheet.name, 'col', at, -count)
  return next
}
