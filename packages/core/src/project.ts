/**
 * The projection: a derived, values-materialized, style-stripped view of a sheet, for full-text
 * search / RAG / an agent that only needs to *read* the data. It is never canonical, always
 * regenerated, and one-way — never parsed back as truth.
 */

import type { ComputedGrid } from './compute.js'
import { formatValue } from './format.js'
import { type Model, cloneModel, getCell } from './model.js'
import { serialize } from './serialize.js'
import { resolveStyles } from './styling.js'
import { type Locale, parseLiteral } from './values.js'

export interface ProjectOptions {
  computed?: ComputedGrid
  locale?: Locale
}

/** A model with formulas replaced by their computed display values and all styling removed. */
export function projectValuesModel(model: Model, opts: ProjectOptions = {}): Model {
  const next = cloneModel(model)
  for (const sheet of next.sheets) {
    const styles = resolveStyles(sheet)
    for (let r = 0; r < sheet.grid.length; r++) {
      for (let c = 0; c < sheet.width; c++) {
        const raw = sheet.grid[r]![c]!
        const attrs = styles.attrs(c, r + 1)
        if (raw.trim().startsWith('=')) {
          const v = opts.computed ? opts.computed.get(sheet.name, c, r + 1) : null
          sheet.grid[r]![c] = opts.computed
            ? formatValue(v, { format: attrs.format, locale: opts.locale })
            : raw
        } else if (attrs.format) {
          const v = parseLiteral(raw, opts.locale)
          if (typeof v === 'number') {
            sheet.grid[r]![c] = formatValue(v, { format: attrs.format, locale: opts.locale })
          }
        }
      }
    }
    sheet.styles = []
  }
  return next
}

/** Values-materialized markdown — the same clean table, but showing numbers instead of formulas. */
export function projectText(model: Model, opts: ProjectOptions = {}): string {
  return serialize(projectValuesModel(model, opts))
}

/**
 * A flat, prose-like projection: one line per data row, `header: value` pairs. Ideal as RAG chunk
 * units because each row is self-describing without the surrounding table structure.
 */
export function projectProse(model: Model, opts: ProjectOptions = {}): string {
  const lines: string[] = []
  for (const sheet of model.sheets) {
    const headers = sheet.grid[0] ?? []
    for (let r = 1; r < sheet.grid.length; r++) {
      const parts: string[] = []
      for (let c = 0; c < sheet.width; c++) {
        const header = headers[c]?.trim() || columnName(c)
        const raw = getCell(sheet, c, r + 1)
        const styles = resolveStyles(sheet)
        const attrs = styles.attrs(c, r + 1)
        let value: string
        if (raw.trim().startsWith('=')) {
          const v = opts.computed ? opts.computed.get(sheet.name, c, r + 1) : null
          value = opts.computed ? formatValue(v, { format: attrs.format, locale: opts.locale }) : raw
        } else {
          value = raw
        }
        if (value.trim() !== '') parts.push(`${header}: ${value}`)
      }
      if (parts.length) lines.push(`${sheet.name} — ${parts.join(', ')}`)
    }
  }
  return lines.join('\n')
}

function columnName(col: number): string {
  return `Col${col + 1}`
}
