/**
 * Resolve the presentation layer into per-cell effective styles and merge regions. Rules apply
 * in document order (last-wins per attribute). Merge rules define rectangular spans whose
 * top-left is the anchor; the other covered cells are hidden by the renderer.
 */

import type { ComputedGrid } from './compute.js'
import type { CondOp, Sheet, StyleAttrs, StyleTarget } from './model.js'
import { type CellValue, isError, toNumber } from './values.js'

export interface MergeSpan {
  colspan: number
  rowspan: number
}

export interface ResolvedStyles {
  /** Effective merged attributes for a cell (col 0-based, row 1-based). */
  attrs(col: number, row: number): StyleAttrs
  /** If this cell is the top-left of a merge, its span; otherwise null. */
  mergeAnchor(col: number, row: number): MergeSpan | null
  /** True if this cell is covered by (but not the anchor of) a merge. */
  isCovered(col: number, row: number): boolean
}

function targetCovers(target: StyleTarget, col: number, row: number): boolean {
  switch (target.kind) {
    case 'range': {
      const { start, end } = target.range
      return col >= start.col && col <= end.col && row >= start.row && row <= end.row
    }
    case 'cols':
      return col >= target.start && col <= target.end
    case 'rows':
      return row >= target.start && row <= target.end
  }
}

function condMatches(v: CellValue, op: CondOp, value: number | string): boolean {
  if (isError(v)) return false
  const vn = toNumber(v)
  if (typeof value === 'number' && vn !== null && typeof v !== 'string') {
    switch (op) {
      case '>':
        return vn > value
      case '<':
        return vn < value
      case '>=':
        return vn >= value
      case '<=':
        return vn <= value
      case '=':
        return vn === value
      case '<>':
        return vn !== value
    }
  }
  const s = v === null ? '' : String(v)
  const t = String(value)
  return op === '<>' ? s !== t : op === '=' ? s === t : false
}

/**
 * Conditional-formatting attributes for a cell, evaluated against the computed value. Merged on
 * top of the static styles by the renderer (conditionals win).
 */
export function resolveConditionalAttrs(
  sheet: Sheet,
  computed: ComputedGrid,
  col: number,
  row: number,
): StyleAttrs {
  const out: StyleAttrs = {}
  if (sheet.conditionals.length === 0) return out
  let value: CellValue | undefined
  for (const cond of sheet.conditionals) {
    if (!targetCovers(cond.target, col, row)) continue
    if (value === undefined) value = computed.get(sheet.name, col, row)
    if (condMatches(value, cond.op, cond.value)) Object.assign(out, cond.attrs)
  }
  return out
}

/** The dropdown option list for a cell, if a `validate` rule covers it; otherwise null. */
export function resolveValidation(sheet: Sheet, col: number, row: number): string[] | null {
  for (let i = sheet.validations.length - 1; i >= 0; i--) {
    const v = sheet.validations[i]!
    if (targetCovers(v.target, col, row)) return v.list
  }
  return null
}

/** Whether a cell is a checkbox (declared via `checkbox <range>` in the style block). */
export function resolveCheckbox(sheet: Sheet, col: number, row: number): boolean {
  return sheet.checkboxes.some((c) => targetCovers(c.target, col, row))
}

/** A checkbox cell counts as checked for these raw values (case-insensitive). */
export function isChecked(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  return t === 'true' || t === 'yes' || t === '1' || t === 'x' || t === '✓' || t === 'checked'
}

export function resolveStyles(sheet: Sheet): ResolvedStyles {
  const anchors = new Map<string, MergeSpan>()
  const covered = new Set<string>()
  for (const rule of sheet.styles) {
    if (rule.attrs.merge && rule.target.kind === 'range') {
      const { start, end } = rule.target.range
      const colspan = end.col - start.col + 1
      const rowspan = end.row - start.row + 1
      if (colspan < 1 || rowspan < 1) continue
      anchors.set(`${start.col},${start.row}`, { colspan, rowspan })
      for (let r = start.row; r <= end.row; r++) {
        for (let c = start.col; c <= end.col; c++) {
          if (c === start.col && r === start.row) continue
          covered.add(`${c},${r}`)
        }
      }
    }
  }

  return {
    attrs(col, row) {
      const out: StyleAttrs = {}
      for (const rule of sheet.styles) {
        if (targetCovers(rule.target, col, row)) Object.assign(out, rule.attrs)
      }
      return out
    },
    mergeAnchor: (col, row) => anchors.get(`${col},${row}`) ?? null,
    isCovered: (col, row) => covered.has(`${col},${row}`),
  }
}
