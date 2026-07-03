/**
 * Reference rewriting on structural edits. Inserting/deleting rows or columns shifts every
 * reference that points into the edited sheet — in formulas, and in `defter-style` targets.
 * A reference landing inside a deleted span becomes `#REF!` (formulas) or is dropped/clamped
 * (style targets). Cross-sheet references to *other* sheets are untouched.
 *
 * This is the hard problem #2 from the design seed. It is deterministic and text-directed:
 * the model's cell text is the truth, so we rewrite the formula strings in place.
 */

import type { Range } from './coords.js'
import { columnIndex, columnLabel } from './coords.js'
import type { ChartSpec, Model, StyleRule, StyleTarget } from './model.js'

export type Axis = 'row' | 'col'

/** Shift a single 1-D position. `delta > 0` inserts before `at`; `delta < 0` deletes `-delta`. */
function shiftPoint(pos: number, at: number, delta: number): number | null {
  if (delta >= 0) return pos >= at ? pos + delta : pos
  const end = at - delta - 1 // deleted span [at, end]
  if (pos >= at && pos <= end) return null // inside deletion → #REF!
  if (pos > end) return pos + delta
  return pos
}

/** Shift a span [lo, hi] as a unit, clamping to the surviving portion. Null if fully deleted. */
function shiftSpan(lo: number, hi: number, at: number, delta: number): [number, number] | null {
  if (delta >= 0) {
    return [lo >= at ? lo + delta : lo, hi >= at ? hi + delta : hi]
  }
  const end = at - delta - 1
  const nlo = lo < at ? lo : lo > end ? lo + delta : at
  const nhi = hi < at ? hi : hi > end ? hi + delta : at - 1
  return nhi < nlo ? null : [nlo, nhi]
}

const REF_TOKEN = /^((?:'(?:[^']|'')*'|[A-Za-z_]\w*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)/

export function shiftReferencesInModel(
  model: Model,
  editedSheet: string,
  axis: Axis,
  at: number,
  delta: number,
): void {
  for (const sheet of model.sheets) {
    for (let r = 0; r < sheet.grid.length; r++) {
      const rowCells = sheet.grid[r]!
      for (let c = 0; c < rowCells.length; c++) {
        const raw = rowCells[c]!
        if (raw.trim().startsWith('=')) {
          rowCells[c] = rewriteFormula(raw, sheet.name, editedSheet, axis, at, delta)
        }
      }
    }
    if (sameSheet(sheet.name, editedSheet)) {
      sheet.styles = shiftStyleTargets(sheet.styles, axis, at, delta)
      sheet.charts = sheet.charts
        .map((ch) => shiftChart(ch, editedSheet, axis, at, delta))
        .filter((ch): ch is ChartSpec => ch !== null)
    }
  }
}

function shiftRange(range: Range, axis: Axis, at: number, delta: number): Range | null {
  const { start, end } = range
  if (axis === 'row') {
    const s = shiftSpan(start.row, end.row, at, delta)
    if (!s) return null
    return { start: { ...start, row: s[0] }, end: { ...end, row: s[1] }, sheet: range.sheet }
  }
  const s = shiftSpan(start.col, end.col, at, delta)
  if (!s) return null
  return { start: { ...start, col: s[0] }, end: { ...end, col: s[1] }, sheet: range.sheet }
}

function shiftChart(
  chart: ChartSpec,
  editedSheet: string,
  axis: Axis,
  at: number,
  delta: number,
): ChartSpec | null {
  const shiftIfLocal = (r: Range | undefined): Range | null | undefined => {
    if (!r) return undefined
    if (r.sheet && !sameSheet(r.sheet, editedSheet)) return r
    return shiftRange(r, axis, at, delta)
  }
  const values = shiftIfLocal(chart.values)
  if (values === null) return null // the data range was deleted → drop the chart
  const labels = shiftIfLocal(chart.labels)
  return { ...chart, values: values!, labels: labels === null ? undefined : labels }
}

function sameSheet(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Rewrite the references inside one formula string, skipping quoted string literals. */
export function rewriteFormula(
  src: string,
  containingSheet: string,
  editedSheet: string,
  axis: Axis,
  at: number,
  delta: number,
): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]!
    if (ch === '"') {
      out += ch
      i++
      while (i < n) {
        out += src[i]
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            out += src[i + 1]
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      continue
    }
    const prev = i > 0 ? src[i - 1]! : ''
    if (!/[A-Za-z0-9_$.!']/.test(prev)) {
      const m = REF_TOKEN.exec(src.slice(i))
      if (m) {
        const after = src[i + m[0].length] ?? ''
        if (after !== '(' && !/[A-Za-z0-9_]/.test(after)) {
          out += rewriteRefToken(m, containingSheet, editedSheet, axis, at, delta)
          i += m[0].length
          continue
        }
      }
    }
    out += ch
    i++
  }
  return out
}

function rewriteRefToken(
  m: RegExpExecArray,
  containingSheet: string,
  editedSheet: string,
  axis: Axis,
  at: number,
  delta: number,
): string {
  const sheetPrefix = m[1] ?? ''
  const colAbs = m[2] === '$'
  const rowAbs = m[4] === '$'
  const col = columnIndex(m[3]!)
  const row = Number.parseInt(m[5]!, 10)

  const sheetName = sheetPrefix
    ? sheetPrefix.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'")
    : containingSheet
  if (!sameSheet(sheetName, editedSheet)) return m[0]

  let newCol = col
  let newRow = row
  if (axis === 'row') {
    const s = shiftPoint(row, at, delta)
    if (s === null) return '#REF!'
    newRow = s
  } else {
    const s = shiftPoint(col, at, delta)
    if (s === null) return '#REF!'
    newCol = s
  }
  return `${sheetPrefix}${colAbs ? '$' : ''}${columnLabel(newCol)}${rowAbs ? '$' : ''}${newRow}`
}

function shiftStyleTargets(rules: StyleRule[], axis: Axis, at: number, delta: number): StyleRule[] {
  const out: StyleRule[] = []
  for (const rule of rules) {
    const shifted = shiftStyleTarget(rule.target, axis, at, delta)
    if (shifted) out.push({ target: shifted, attrs: rule.attrs })
  }
  return out
}

function shiftStyleTarget(target: StyleTarget, axis: Axis, at: number, delta: number): StyleTarget | null {
  if (target.kind === 'cols') {
    if (axis !== 'col') return target
    const s = shiftSpan(target.start, target.end, at, delta)
    return s ? { kind: 'cols', start: s[0], end: s[1] } : null
  }
  if (target.kind === 'rows') {
    if (axis !== 'row') return target
    const s = shiftSpan(target.start, target.end, at, delta)
    return s ? { kind: 'rows', start: s[0], end: s[1] } : null
  }
  // range
  const { start, end } = target.range
  if (axis === 'row') {
    const s = shiftSpan(start.row, end.row, at, delta)
    if (!s) return null
    return {
      kind: 'range',
      range: { start: { ...start, row: s[0] }, end: { ...end, row: s[1] }, sheet: target.range.sheet },
    }
  }
  const s = shiftSpan(start.col, end.col, at, delta)
  if (!s) return null
  return {
    kind: 'range',
    range: { start: { ...start, col: s[0] }, end: { ...end, col: s[1] }, sheet: target.range.sheet },
  }
}
