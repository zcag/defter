/**
 * Byte-stable serializer: Model → text. A given model always produces identical bytes.
 * Tables are compact (single-space cell padding, never alignment padding) and one row = one
 * line, so a single-cell edit maps to a minimal text splice.
 */

import { escapeCell } from './escape.js'
import type { Model, Sheet } from './model.js'
import { serializeStyleBlock } from './style.js'

export function serialize(model: Model): string {
  const multi = model.sheets.length > 1
  const blocks = model.sheets.map((sheet) => serializeSheet(sheet, multi))
  return `${blocks.join('\n\n')}\n`
}

function serializeSheet(sheet: Sheet, forceHeading: boolean): string {
  const width = Math.max(sheet.width, 1)
  const parts: string[] = []
  if (sheet.headed || forceHeading) parts.push(`## Sheet: ${sheet.name}\n`)

  const row = (cells: string[]): string => {
    const padded = Array.from({ length: width }, (_, c) => escapeCell(cells[c] ?? ''))
    return `| ${padded.join(' | ')} |`
  }

  const header = sheet.grid[0] ?? []
  const delim = Array.from({ length: width }, (_, c) => alignMarker(sheet.colAlign[c] ?? null))
  const lines = [row(header), `| ${delim.join(' | ')} |`]
  for (let r = 1; r < sheet.grid.length; r++) lines.push(row(sheet.grid[r]!))
  parts.push(lines.join('\n'))

  if (sheet.styles.length > 0) {
    parts.push(`\n\`\`\`defter-style\n${serializeStyleBlock(sheet.styles)}\n\`\`\``)
  }
  return parts.join('\n')
}

function alignMarker(align: 'left' | 'center' | 'right' | null): string {
  switch (align) {
    case 'left':
      return ':--'
    case 'center':
      return ':-:'
    case 'right':
      return '--:'
    default:
      return '---'
  }
}
