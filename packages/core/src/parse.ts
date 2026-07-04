/**
 * Lenient parser: text → Model. Tolerates ragged rows, loose whitespace, a missing delimiter
 * row, and content with or without `## Sheet:` headings. Normalization happens here (padding
 * rows to a common width); byte-stability is serialize's job.
 */

import { unescapeCell } from './escape.js'
import { type Model, type Sheet, emptySheet } from './model.js'
import { parseStyleBlock } from './style.js'

const HEADING_RE = /^#{1,6}\s*Sheet:\s*(.*)$/i
const FENCE_RE = /^(`{3,}|~{3,})\s*(.*)$/
const DELIM_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/

export function parse(text: string): Model {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const model: Model = { sheets: [] }
  const filled = new WeakSet<Sheet>()
  const usedNames = new Set<string>()
  let current: Sheet | null = null

  const autoName = (): string => {
    let n = 1
    let name = `Sheet${n}`
    while (usedNames.has(name)) name = `Sheet${++n}`
    return name
  }
  const register = (sheet: Sheet) => {
    usedNames.add(sheet.name)
    model.sheets.push(sheet)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    const heading = HEADING_RE.exec(trimmed)
    if (heading) {
      const name = heading[1]!.trim() || autoName()
      current = emptySheet(name, true)
      register(current)
      continue
    }

    const fence = FENCE_RE.exec(trimmed)
    if (fence) {
      const marker = fence[1]!
      const info = fence[2]!.trim()
      const bodyLines: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const f = FENCE_RE.exec(lines[j]!.trim())
        if (f && lines[j]!.trim().startsWith(marker[0]!) && f[2]!.trim() === '') break
        bodyLines.push(lines[j]!)
      }
      if (info === 'defter-style') {
        let target: Sheet | undefined = current ?? model.sheets[model.sheets.length - 1]
        if (!target) {
          target = emptySheet(autoName(), false)
          register(target)
          current = target
        }
        const parsed = parseStyleBlock(bodyLines.join('\n'))
        target.styles.push(...parsed.rules)
        target.charts.push(...parsed.charts)
        target.conditionals.push(...parsed.conditionals)
        target.validations.push(...parsed.validations)
        target.checkboxes.push(...parsed.checkboxes)
        target.dates.push(...parsed.dates)
        target.filters.push(...parsed.filters)
        target.names.push(...parsed.names)
        if (parsed.freeze) target.freeze = parsed.freeze
      }
      i = j // skip past closing fence
      continue
    }

    if (line.includes('|') && trimmed !== '') {
      // Collect a contiguous block of table lines.
      const tableLines: string[] = [line]
      let j = i + 1
      for (; j < lines.length; j++) {
        const l = lines[j]!
        if (!l.includes('|') || l.trim() === '' || HEADING_RE.test(l.trim())) break
        if (FENCE_RE.test(l.trim())) break
        tableLines.push(l)
      }
      i = j - 1

      let sheet: Sheet | null = current
      if (!sheet || filled.has(sheet)) {
        sheet = emptySheet(autoName(), false)
        register(sheet)
        current = sheet
      }
      fillSheetFromTable(sheet, tableLines)
      filled.add(sheet)
      continue
    }
    // Any other line (prose, blank, unrelated markdown) is ignored between sheets.
  }

  if (model.sheets.length === 0) model.sheets.push(emptySheet('Sheet1', false))
  for (const sheet of model.sheets) normalizeSheet(sheet)
  return model
}

/** Ensure a sheet has at least a 1-wide header row so serialize↔parse is idempotent. */
function normalizeSheet(sheet: Sheet): void {
  if (sheet.width < 1 || sheet.grid.length === 0) {
    sheet.grid = [['']]
    sheet.width = 1
    sheet.colAlign = [null]
    return
  }
  for (const r of sheet.grid) {
    while (r.length < sheet.width) r.push('')
  }
  while (sheet.colAlign.length < sheet.width) sheet.colAlign.push(null)
}

function fillSheetFromTable(sheet: Sheet, tableLines: string[]): void {
  const header = splitRow(tableLines[0]!)
  let dataStart = 1
  let colAlign: (('left' | 'center' | 'right') | null)[] = []
  if (tableLines.length > 1 && DELIM_RE.test(tableLines[1]!)) {
    colAlign = parseAlignRow(tableLines[1]!)
    dataStart = 2
  }
  const dataRows: string[][] = []
  for (let k = dataStart; k < tableLines.length; k++) {
    dataRows.push(splitRow(tableLines[k]!))
  }

  const width = Math.max(header.length, colAlign.length, ...dataRows.map((r) => r.length), 0)
  const pad = (row: string[]) => {
    const r = row.slice(0, width)
    while (r.length < width) r.push('')
    return r
  }
  sheet.grid = [pad(header), ...dataRows.map(pad)]
  sheet.width = width
  sheet.colAlign = Array.from({ length: width }, (_, c) => colAlign[c] ?? null)
}

/** Split a table row on unescaped `|`, dropping the surrounding-pipe artifacts, and unescape. */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  const s = line.trim()
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1]!
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  if (cells.length > 1 && cells[0]!.trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1]!.trim() === '') cells.pop()
  return cells.map((c) => unescapeCell(c.trim()))
}

function parseAlignRow(line: string): (('left' | 'center' | 'right') | null)[] {
  const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return raw.split('|').map((cell) => {
    const c = cell.trim()
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}
