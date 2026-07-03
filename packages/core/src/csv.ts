/**
 * CSV import/export. CSV is a single table, so export targets one sheet. Formulas export as their
 * computed value when an engine's `ComputedGrid` is supplied, otherwise as their `=source`.
 */

import type { ComputedGrid } from './compute.js'
import { formatValue } from './format.js'
import { type Model, type Sheet, emptySheet, getCell } from './model.js'
import { type Locale, parseLiteral } from './values.js'

export interface CsvExportOptions {
  sheetIndex?: number
  computed?: ComputedGrid
  locale?: Locale
  delimiter?: string
}

function csvField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || /[\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Export one sheet to CSV. */
export function modelToCsv(model: Model, opts: CsvExportOptions = {}): string {
  const sheet = model.sheets[opts.sheetIndex ?? 0]
  if (!sheet) return ''
  const d = opts.delimiter ?? ','
  const lines: string[] = []
  for (let r = 0; r < sheet.grid.length; r++) {
    const cells: string[] = []
    for (let c = 0; c < sheet.width; c++) {
      const raw = getCell(sheet, c, r + 1)
      let out = raw
      if (raw.trim().startsWith('=') && opts.computed) {
        out = formatValue(opts.computed.get(sheet.name, c, r + 1), { locale: opts.locale })
      }
      cells.push(csvField(out, d))
    }
    lines.push(cells.join(d))
  }
  return lines.join('\n')
}

/** Parse CSV text (RFC-4180-ish: quoted fields, doubled quotes, embedded newlines). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/** Build a single-sheet model from CSV text. Cells starting with `=` are kept as formulas. */
export function csvToModel(text: string, name = 'Sheet1', delimiter = ','): Model {
  const rows = parseCsv(text, delimiter)
  const sheet: Sheet = emptySheet(name, false)
  const width = Math.max(1, ...rows.map((r) => r.length))
  sheet.grid = rows.map((r) => {
    const cells = r.slice()
    while (cells.length < width) cells.push('')
    return cells
  })
  if (sheet.grid.length === 0) sheet.grid = [Array(width).fill('')]
  sheet.width = width
  sheet.colAlign = Array(width).fill(null)
  return { sheets: [sheet] }
}

/** Coerce a raw cell to a typed value for callers that want it (unused by export, handy for hosts). */
export function typedCell(sheet: Sheet, col: number, row: number, locale?: Locale) {
  return parseLiteral(getCell(sheet, col, row), locale)
}
