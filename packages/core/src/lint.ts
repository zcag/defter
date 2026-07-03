/**
 * Cheap self-verification for a generated document: which formula cells evaluate to an error.
 * An agent (or a host) can run this after authoring to catch `#REF!` / `#NAME?` / `#DIV/0!`
 * before saving.
 */

import type { ComputedGrid } from './compute.js'
import { columnLabel } from './coords.js'
import type { Model } from './model.js'
import { isError } from './values.js'

export interface CellIssue {
  sheet: string
  a1: string
  formula: string
  error: string
}

/** Return every formula cell whose computed value is an error. */
export function findErrors(model: Model, computed: ComputedGrid): CellIssue[] {
  const issues: CellIssue[] = []
  for (const sheet of model.sheets) {
    for (let r = 0; r < sheet.grid.length; r++) {
      for (let c = 0; c < sheet.width; c++) {
        const raw = (sheet.grid[r]![c] ?? '').trim()
        if (!raw.startsWith('=')) continue
        const v = computed.get(sheet.name, c, r + 1)
        if (isError(v)) {
          issues.push({ sheet: sheet.name, a1: `${columnLabel(c)}${r + 1}`, formula: raw, error: v.error })
        }
      }
    }
  }
  return issues
}
