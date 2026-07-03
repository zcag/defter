/**
 * The in-memory model. This is the *ephemeral projection* of the text — parse produces it,
 * serialize turns it back into byte-stable text. Cell text is stored in its **logical** form
 * (real `|` and newline characters, not the `\|` / `\n` escapes used in the serialized form).
 */

import type { Range } from './coords.js'

export interface Model {
  sheets: Sheet[]
}

export interface Sheet {
  name: string
  /**
   * Row-major grid of raw cell text. `grid[0]` is the header (A1 row 1); `grid[r]` is A1
   * row `r + 1`. Formula cells keep their leading `=`. All rows are padded to `width`.
   */
  grid: string[][]
  width: number
  /** Per-column alignment from the GFM delimiter row (native, content-layer). `null` = default. */
  colAlign: (('left' | 'center' | 'right') | null)[]
  styles: StyleRule[]
  /** Whether the sheet was introduced by an explicit `## Sheet:` heading. */
  headed: boolean
}

export interface StyleRule {
  target: StyleTarget
  attrs: StyleAttrs
}

export type StyleTarget =
  | { kind: 'range'; range: Range }
  | { kind: 'cols'; start: number; end: number }
  | { kind: 'rows'; start: number; end: number }

export interface StyleAttrs {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  wrap?: boolean
  merge?: boolean
  fill?: string
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  format?: string
  border?: string
  font?: string
  size?: number
  /** Column width in px. Only meaningful on a `cols` target; persists resize in the text layer. */
  width?: number
}

export function emptyModel(): Model {
  return { sheets: [] }
}

export function emptySheet(name: string, headed = true): Sheet {
  return { name, grid: [[]], width: 0, colAlign: [], styles: [], headed }
}

/** Read a cell's logical text by A1 (col 0-based, row 1-based). Empty string if out of range. */
export function getCell(sheet: Sheet, col: number, row: number): string {
  return sheet.grid[row - 1]?.[col] ?? ''
}

/** Deep clone a model. The model is plain JSON-safe data (strings, numbers, booleans, arrays). */
export function cloneModel(model: Model): Model {
  return JSON.parse(JSON.stringify(model)) as Model
}
