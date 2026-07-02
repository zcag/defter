/**
 * Resolve the presentation layer into per-cell effective styles and merge regions. Rules apply
 * in document order (last-wins per attribute). Merge rules define rectangular spans whose
 * top-left is the anchor; the other covered cells are hidden by the renderer.
 */

import type { Sheet, StyleAttrs, StyleTarget } from './model.js'

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
