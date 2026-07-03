/**
 * Structured edit operations. These are the single vocabulary that humans, the renderer, and
 * agents all use to change a sheet — never a full-body rewrite. Each returns a new Model (the
 * input is not mutated). Reference rewriting for structural ops lives in refs.ts and is applied
 * here so formulas and style targets stay correct.
 */

import {
  type Model,
  type Sheet,
  type StyleAttrs,
  type StyleTarget,
  cloneModel,
  emptySheet,
} from './model.js'
import { shiftReferencesInModel } from './refs.js'

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

/** Delete a sheet. No-op if it's the only sheet. */
export function deleteSheet(model: Model, sheetIndex: number): Model {
  const next = cloneModel(model)
  if (next.sheets.length <= 1) return next
  next.sheets.splice(sheetIndex, 1)
  return next
}

/** Append a style rule (merged last-wins by the renderer) for a target. */
export function setStyle(
  model: Model,
  sheetIndex: number,
  target: StyleTarget,
  attrs: StyleAttrs,
): Model {
  const next = cloneModel(model)
  const sheet = next.sheets[sheetIndex]
  if (!sheet) return next
  sheet.styles.push({ target, attrs })
  return next
}

/** Remove style rules whose range target is fully contained in the given range. */
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
