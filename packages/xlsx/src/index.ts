/**
 * XLSX ↔ Defter. Import maps worksheets, cell values/formulas, merges, and basic styling into the
 * Defter model; export writes them back. exceljs is loaded dynamically so hosts only pay for it
 * when import/export is actually used.
 */

import {
  type ComputedGrid,
  type Locale,
  type Model,
  type Sheet,
  type StyleAttrs,
  type StyleRule,
  emptySheet,
  formatRange,
  getCell,
  parseLiteral,
  resolveStyles,
} from '@defterjs/core'

const TOKEN_HEX: Record<string, string> = {
  'surface-1': 'FFFFFFFF',
  'surface-2': 'FFF3F4F6',
  'surface-3': 'FFE5E7EB',
  accent: 'FF2F6DF6',
  'accent-soft': 'FFDBE7FF',
  success: 'FF1A7F47',
  'success-soft': 'FFD7F0E0',
  warning: 'FFA8760A',
  'warning-soft': 'FFFBEDCF',
  danger: 'FFC02636',
  'danger-soft': 'FFFADADD',
  muted: 'FF6B7280',
}

function toArgb(token: string | undefined): string | undefined {
  if (!token) return undefined
  if (TOKEN_HEX[token]) return TOKEN_HEX[token]
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(token)
  if (hex) return `FF${hex[1]!.toUpperCase()}`
  return undefined
}

export interface XlsxExportOptions {
  computed?: ComputedGrid
  locale?: Locale
}

/** Export a Defter model to an XLSX ArrayBuffer. */
export async function exportXlsx(model: Model, opts: XlsxExportOptions = {}): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Defter'

  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name)
    const styles = resolveStyles(sheet)

    for (let r = 0; r < sheet.grid.length; r++) {
      for (let c = 0; c < sheet.width; c++) {
        if (styles.isCovered(c, r + 1)) continue
        const raw = getCell(sheet, c, r + 1)
        const cell = ws.getCell(r + 1, c + 1)
        if (raw.trim().startsWith('=')) {
          cell.value = { formula: raw.trim().slice(1), date1904: false } as never
        } else {
          const v = parseLiteral(raw, opts.locale)
          cell.value = v === null || typeof v === 'object' ? (raw === '' ? null : raw) : v
        }
        applyStyle(cell, styles.attrs(c, r + 1))
      }
    }

    // Merges
    for (const rule of sheet.styles) {
      if (rule.attrs.merge && rule.target.kind === 'range') {
        ws.mergeCells(formatRange(rule.target.range))
      }
      if (rule.target.kind === 'cols' && rule.attrs.width) {
        for (let c = rule.target.start; c <= rule.target.end; c++) {
          ws.getColumn(c + 1).width = rule.attrs.width / 7
        }
      }
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

function applyStyle(cell: any, a: StyleAttrs): void {
  const font: Record<string, unknown> = {}
  if (a.bold) font.bold = true
  if (a.italic) font.italic = true
  if (a.underline) font.underline = true
  if (a.strike) font.strike = true
  if (a.color) {
    const argb = toArgb(a.color)
    if (argb) font.color = { argb }
  }
  if (a.size) font.size = a.size
  if (Object.keys(font).length) cell.font = font

  const fillArgb = toArgb(a.fill)
  if (fillArgb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  if (a.format) cell.numFmt = a.format
  if (a.align || a.valign || a.wrap) {
    cell.alignment = {
      horizontal: a.align,
      vertical: a.valign === 'middle' ? 'middle' : a.valign,
      wrapText: a.wrap || undefined,
    }
  }
}

/** Import an XLSX file (ArrayBuffer/Uint8Array) into a Defter model. */
export async function importXlsx(data: ArrayBuffer | Uint8Array): Promise<Model> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as ArrayBuffer)
  const sheets: Sheet[] = []

  wb.eachSheet((ws) => {
    const maxRow = Math.max(1, ws.rowCount)
    const maxCol = Math.max(1, ws.columnCount)
    const grid: string[][] = []
    const styles: StyleRule[] = []

    for (let r = 1; r <= maxRow; r++) {
      const cells: string[] = []
      for (let c = 1; c <= maxCol; c++) {
        const cell = ws.getCell(r, c)
        cells.push(cellText(cell, ExcelJS))
        const attrs = readStyle(cell)
        if (attrs) {
          styles.push({
            target: { kind: 'range', range: singleRange(c - 1, r) },
            attrs,
          })
        }
      }
      grid.push(cells)
    }

    // Merges
    const merges = (ws.model as { merges?: string[] }).merges ?? []
    for (const m of merges) {
      const [a, b] = m.split(':')
      if (a && b) styles.push({ target: { kind: 'range', range: rangeFromA1(a, b) }, attrs: { merge: true } })
    }

    const sheet = emptySheet(ws.name, true)
    sheet.grid = grid.length ? grid : [['']]
    sheet.width = maxCol
    sheet.colAlign = Array(maxCol).fill(null)
    sheet.styles = styles
    sheets.push(sheet)
  })

  return { sheets: sheets.length ? sheets : [emptySheet('Sheet1', false)] }
}

function cellText(cell: any, ExcelJS: any): string {
  if (cell.type === ExcelJS.ValueType.Formula) return `=${cell.formula}`
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && 'text' in v) return String(v.text)
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
  return String(v)
}

function readStyle(cell: any): StyleAttrs | null {
  const a: StyleAttrs = {}
  const f = cell.font
  if (f?.bold) a.bold = true
  if (f?.italic) a.italic = true
  if (f?.strike) a.strike = true
  const fill = cell.fill
  if (fill?.type === 'pattern' && fill.fgColor?.argb && fill.pattern === 'solid') {
    a.fill = `#${String(fill.fgColor.argb).slice(-6)}`
  }
  if (cell.numFmt && cell.numFmt !== 'General') a.format = cell.numFmt
  const al = cell.alignment
  if (al?.horizontal && ['left', 'center', 'right'].includes(al.horizontal)) a.align = al.horizontal
  if (al?.wrapText) a.wrap = true
  return Object.keys(a).length ? a : null
}

function singleRange(col: number, row: number) {
  const ref = { col, row, colAbs: false, rowAbs: false }
  return { start: ref, end: { ...ref }, sheet: undefined }
}

function rangeFromA1(a: string, b: string) {
  const pa = parseA1(a)
  const pb = parseA1(b)
  return {
    start: { col: Math.min(pa.col, pb.col), row: Math.min(pa.row, pb.row), colAbs: false, rowAbs: false },
    end: { col: Math.max(pa.col, pb.col), row: Math.max(pa.row, pb.row), colAbs: false, rowAbs: false },
    sheet: undefined,
  }
}

function parseA1(a1: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(a1)!
  let col = 0
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number.parseInt(m[2]!, 10) }
}
