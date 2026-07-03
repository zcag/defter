/**
 * Selection-aware border application. Maps a border "kind" (all/inner/outer/edges/clear) over a
 * rectangular selection to per-cell side sets, unions with existing borders, and writes them back
 * through the style layer in the compact `top,right,bottom,left` / `all` string form.
 */

import { setStyle } from './edit.js'
import type { Model, StyleTarget } from './model.js'
import { cloneModel } from './model.js'
import { resolveStyles } from './styling.js'

export type BorderKind =
  | 'all'
  | 'inner'
  | 'inner-h'
  | 'inner-v'
  | 'outer'
  | 'left'
  | 'top'
  | 'right'
  | 'bottom'
  | 'clear'

export interface BorderRect {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

type Side = 'top' | 'right' | 'bottom' | 'left'
const ORDER: Side[] = ['top', 'right', 'bottom', 'left']

function parseSides(spec: string | undefined): Set<Side> {
  const set = new Set<Side>()
  if (!spec) return set
  if (spec === 'all' || spec === 'outer') return new Set(ORDER)
  for (const s of spec.split(',')) if ((ORDER as string[]).includes(s)) set.add(s as Side)
  return set
}

function serializeSides(set: Set<Side>): string | undefined {
  if (set.size === 0) return undefined
  if (set.size === 4) return 'all'
  return ORDER.filter((s) => set.has(s)).join(',')
}

function cellTarget(col: number, row: number): StyleTarget {
  const ref = (c: number, r: number) => ({ col: c, row: r, colAbs: false, rowAbs: false })
  return { kind: 'range', range: { start: ref(col, row), end: ref(col, row), sheet: undefined } }
}

/** Sides this kind adds to the cell at (col,row) within `rect`. */
function sidesFor(kind: BorderKind, col: number, row: number, rect: BorderRect): Side[] {
  const out: Side[] = []
  const top = row === rect.minRow
  const bottom = row === rect.maxRow
  const left = col === rect.minCol
  const right = col === rect.maxCol
  switch (kind) {
    case 'outer':
      if (top) out.push('top')
      if (bottom) out.push('bottom')
      if (left) out.push('left')
      if (right) out.push('right')
      break
    case 'inner-h':
      if (row < rect.maxRow) out.push('bottom')
      break
    case 'inner-v':
      if (col < rect.maxCol) out.push('right')
      break
    case 'inner':
      if (row < rect.maxRow) out.push('bottom')
      if (col < rect.maxCol) out.push('right')
      break
    case 'left':
      if (left) out.push('left')
      break
    case 'top':
      if (top) out.push('top')
      break
    case 'right':
      if (right) out.push('right')
      break
    case 'bottom':
      if (bottom) out.push('bottom')
      break
  }
  return out
}

export function applyBorders(model: Model, sheetIndex: number, rect: BorderRect, kind: BorderKind): Model {
  // `all`: one compact range rule covering the whole selection.
  if (kind === 'all') return setStyle(model, sheetIndex, rangeTarget(rect), { border: 'all' })

  // `clear`: strip the border attr from every rule fully contained in the selection.
  if (kind === 'clear') {
    const next = cloneModel(model)
    const sheet = next.sheets[sheetIndex]
    if (!sheet) return next
    for (const rule of sheet.styles) {
      if (rule.target.kind !== 'range' || rule.attrs.border === undefined) continue
      const { start, end } = rule.target.range
      if (start.col >= rect.minCol && end.col <= rect.maxCol && start.row >= rect.minRow && end.row <= rect.maxRow) {
        rule.attrs.border = undefined
      }
    }
    sheet.styles = sheet.styles.filter((r) => Object.values(r.attrs).some((v) => v !== undefined))
    return next
  }

  // Otherwise union the added sides into each cell's existing border, per cell.
  const base = model.sheets[sheetIndex]
  if (!base) return model
  const styles = resolveStyles(base)
  let next = model
  for (let row = rect.minRow; row <= rect.maxRow; row++) {
    for (let col = rect.minCol; col <= rect.maxCol; col++) {
      const add = sidesFor(kind, col, row, rect)
      if (add.length === 0) continue
      const sides = parseSides(styles.attrs(col, row).border)
      for (const s of add) sides.add(s)
      next = setStyle(next, sheetIndex, cellTarget(col, row), { border: serializeSides(sides) })
    }
  }
  return next
}

function rangeTarget(rect: BorderRect): StyleTarget {
  const ref = (c: number, r: number) => ({ col: c, row: r, colAbs: false, rowAbs: false })
  return {
    kind: 'range',
    range: { start: ref(rect.minCol, rect.minRow), end: ref(rect.maxCol, rect.maxRow), sheet: undefined },
  }
}
