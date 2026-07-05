/**
 * Op dispatcher — the single entry point a host wraps to expose structured sheet editing (e.g.
 * over MCP). A {@link SheetOp} is a JSON-serializable, discriminated-union edit that maps 1:1 to the
 * structured operations in edit.ts; {@link applyOp} parses the canonical text, resolves the target
 * sheet, dispatches to the matching edit function, and serializes back to byte-stable Defter
 * markdown. All reference rewriting (formulas + style targets on insert/delete) flows through
 * unchanged — this file adds no editing logic of its own, only parse → dispatch → serialize glue.
 *
 * The op shape is published as a JSON Schema ({@link SHEET_OP_SCHEMA}) a host can drop straight into
 * an MCP tool's parameter schema. See docs/MCP.md for the host recipe.
 */

import { columnIndex, parseRef } from './coords.js'
import {
  addSheet,
  deleteCols,
  deleteRows,
  deleteSheet,
  insertCols,
  insertRows,
  renameSheet,
  setCell,
  setColumnWidth,
  setFreeze,
  setRowHeight,
  setStyle,
} from './edit.js'
import type { Model, StyleAttrs } from './model.js'
import { parse } from './parse.js'
import { serialize } from './serialize.js'
import { parseStyleTarget } from './style.js'

/** A sheet, addressed by 0-based index or by name (case-insensitive). Omitted ⇒ the first sheet. */
export type SheetRef = number | string

/**
 * A single structured edit. The discriminant is `kind`; each variant maps 1:1 to a function in
 * edit.ts. `sheet` defaults to the first sheet (index 0) when omitted.
 */
export type SheetOp =
  /** Batch-set cell text. `ref` is A1 (`"B2"`), `text` a literal (`"42"`) or a `=formula`. */
  | { kind: 'setCells'; sheet?: SheetRef; cells: { ref: string; text: string }[] }
  /** Insert `count` (default 1) blank rows before 1-based A1 row `at`. Rewrites references. */
  | { kind: 'insertRows'; sheet?: SheetRef; at: number; count?: number }
  /** Delete `count` (default 1) rows starting at 1-based A1 row `at` (row 1 is the header). */
  | { kind: 'deleteRows'; sheet?: SheetRef; at: number; count?: number }
  /** Insert `count` (default 1) blank columns before column `at` (letter `"C"` or 0-based index). */
  | { kind: 'insertCols'; sheet?: SheetRef; at: string | number; count?: number }
  /** Delete `count` (default 1) columns starting at column `at` (letter `"C"` or 0-based index). */
  | { kind: 'deleteCols'; sheet?: SheetRef; at: string | number; count?: number }
  /**
   * Apply style attributes to a target: a cell/range (`"A1"`, `"A1:D9"`), a whole column (`"C:C"`),
   * or whole rows (`"2:9"`). A column width is a `width` attr on a single-column target.
   */
  | { kind: 'setStyle'; sheet?: SheetRef; target: string; attrs: StyleAttrs }
  /** Freeze the first `rows` rows and/or `cols` columns. Both 0/omitted removes the freeze. */
  | { kind: 'setFreeze'; sheet?: SheetRef; rows?: number; cols?: number }
  /** Append a new sheet named `name`; if `after` is given, place it right after that sheet. */
  | { kind: 'addSheet'; name: string; after?: SheetRef }
  /** Rename a sheet. */
  | { kind: 'renameSheet'; sheet: SheetRef; name: string }
  /** Delete a sheet (no-op if it's the only sheet). */
  | { kind: 'deleteSheet'; sheet: SheetRef }

/** Every `SheetOp` discriminant, kept in sync with the union above and with SHEET_OP_SCHEMA. */
export const SHEET_OP_KINDS = [
  'setCells',
  'insertRows',
  'deleteRows',
  'insertCols',
  'deleteCols',
  'setStyle',
  'setFreeze',
  'addSheet',
  'renameSheet',
  'deleteSheet',
] as const

/** Resolve a {@link SheetRef} to a 0-based sheet index. Throws if it names no existing sheet. */
function resolveSheet(model: Model, ref: SheetRef | undefined): number {
  if (ref === undefined) return 0
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || ref < 0 || ref >= model.sheets.length)
      throw new Error(`sheet index out of range: ${ref}`)
    return ref
  }
  const exact = model.sheets.findIndex((s) => s.name === ref)
  if (exact >= 0) return exact
  const ci = model.sheets.findIndex((s) => s.name.toLowerCase() === ref.toLowerCase())
  if (ci >= 0) return ci
  throw new Error(`unknown sheet: ${ref}`)
}

/** Resolve a column address (letter `"C"` or 0-based index) to a 0-based index. */
function resolveCol(at: string | number): number {
  if (typeof at === 'number') {
    if (!Number.isInteger(at) || at < 0) throw new Error(`bad column index: ${at}`)
    return at
  }
  return columnIndex(at) // throws SyntaxError on a bad label
}

/**
 * Apply one {@link SheetOp} to canonical Defter markdown and return the new canonical markdown.
 * Throws a clear, host-surfaceable Error on invalid input (bad A1 ref, unknown sheet, out-of-range
 * index, malformed op) — a host relays the message to the agent.
 */
export function applyOp(text: string, op: SheetOp): string {
  const model = parse(text)
  switch (op.kind) {
    case 'setCells': {
      const idx = resolveSheet(model, op.sheet)
      let m = model
      for (const { ref, text: cellText } of op.cells) {
        const r = parseRef(ref) // throws on a bad A1 reference
        m = setCell(m, idx, r.col, r.row, cellText)
      }
      return serialize(m)
    }
    case 'insertRows':
      return serialize(insertRows(model, resolveSheet(model, op.sheet), op.at, op.count ?? 1))
    case 'deleteRows':
      return serialize(deleteRows(model, resolveSheet(model, op.sheet), op.at, op.count ?? 1))
    case 'insertCols':
      return serialize(
        insertCols(model, resolveSheet(model, op.sheet), resolveCol(op.at), op.count ?? 1),
      )
    case 'deleteCols':
      return serialize(
        deleteCols(model, resolveSheet(model, op.sheet), resolveCol(op.at), op.count ?? 1),
      )
    case 'setStyle': {
      const idx = resolveSheet(model, op.sheet)
      const target = parseStyleTarget(op.target) // throws on a bad target
      const attrs = op.attrs ?? {}
      // Pure single-column width → reuse setColumnWidth's dedup; anything else via setStyle
      // (which folds a `width` attr into the mixed rule fine).
      if (
        target.kind === 'cols' &&
        target.start === target.end &&
        attrs.width !== undefined &&
        Object.keys(attrs).length === 1
      ) {
        return serialize(setColumnWidth(model, idx, target.start, attrs.width))
      }
      // Pure single-row height → reuse setRowHeight's dedup; mixed rules fold height in fine.
      if (
        target.kind === 'rows' &&
        target.start === target.end &&
        attrs.height !== undefined &&
        Object.keys(attrs).length === 1
      ) {
        return serialize(setRowHeight(model, idx, target.start, attrs.height))
      }
      return serialize(setStyle(model, idx, target, attrs))
    }
    case 'setFreeze':
      // setFreeze is already text-in/text-out; feed it the original text and the resolved index.
      return setFreeze(text, { rows: op.rows, cols: op.cols }, resolveSheet(model, op.sheet))
    case 'addSheet': {
      const m = addSheet(model, op.name)
      if (op.after !== undefined) {
        const afterIdx = resolveSheet(model, op.after)
        const added = m.sheets.pop() // addSheet appends; move it into place
        if (added) m.sheets.splice(afterIdx + 1, 0, added)
      }
      return serialize(m)
    }
    case 'renameSheet':
      return serialize(renameSheet(model, resolveSheet(model, op.sheet), op.name))
    case 'deleteSheet':
      return serialize(deleteSheet(model, resolveSheet(model, op.sheet)))
    default: {
      const bad = op as { kind?: unknown }
      throw new Error(`unknown op kind: ${String(bad.kind)}`)
    }
  }
}

/**
 * Apply a sequence of ops left-to-right — each op sees the previous op's result. A throwing op
 * aborts the whole batch (the error propagates and nothing is returned), so a host can reject the
 * entire edit atomically.
 */
export function applyOps(text: string, ops: SheetOp[]): string {
  let cur = text
  for (const op of ops) cur = applyOp(cur, op)
  return cur
}

// --- Published JSON Schema for a SheetOp -------------------------------------------------------

const sheetRefSchema = {
  oneOf: [
    { type: 'integer', minimum: 0, description: '0-based sheet index' },
    { type: 'string', description: 'sheet name (case-insensitive)' },
  ],
  description: 'Target sheet by 0-based index or name; defaults to the first sheet when omitted.',
}

const styleAttrsSchema = {
  type: 'object',
  description:
    'Presentation attributes; a `width` (px) on a single-column target sets column width.',
  properties: {
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    strike: { type: 'boolean' },
    wrap: { type: 'boolean' },
    merge: { type: 'boolean' },
    fill: { type: 'string', description: 'theme token (e.g. surface-3, accent-soft) or #hex' },
    color: { type: 'string', description: 'theme token or #hex' },
    align: { enum: ['left', 'center', 'right'] },
    valign: { enum: ['top', 'middle', 'bottom'] },
    format: { type: 'string', description: 'number format, e.g. #,##0.00 or $#,##0.00 or 0%' },
    border: { type: 'string', description: 'all|top|right|bottom|left' },
    font: { type: 'string' },
    size: { type: 'number', description: 'font size in px' },
    width: { type: 'number', description: 'column width in px (single-column target only)' },
    height: { type: 'number', description: 'row height in px (single-row target only)' },
  },
  additionalProperties: false,
}

const colAddress = {
  oneOf: [
    { type: 'string', description: 'column letter, e.g. "C"' },
    { type: 'integer', minimum: 0, description: '0-based column index' },
  ],
}

/**
 * JSON Schema (a `oneOf` over the `kind` variants) for a {@link SheetOp}. Drop it straight into an
 * MCP tool's parameter schema so the agent gets the op shape + descriptions. Kept exactly in sync
 * with the {@link SheetOp} type (a test asserts every kind is represented).
 */
export const SHEET_OP_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SheetOp',
  description:
    'A single structured Defter sheet edit. Apply with @defterjs/core applyOp(text, op) → new canonical markdown.',
  oneOf: [
    {
      type: 'object',
      title: 'setCells',
      description: 'Batch-set cell text (literal or =formula).',
      properties: {
        kind: { const: 'setCells' },
        sheet: sheetRefSchema,
        cells: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'A1 cell reference, e.g. "B2"' },
              text: { type: 'string', description: 'literal value or "=formula"' },
            },
            required: ['ref', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'cells'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'insertRows',
      description: 'Insert blank rows; references shift automatically.',
      properties: {
        kind: { const: 'insertRows' },
        sheet: sheetRefSchema,
        at: { type: 'integer', minimum: 1, description: '1-based row to insert before' },
        count: { type: 'integer', minimum: 1, description: 'default 1' },
      },
      required: ['kind', 'at'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'deleteRows',
      description: 'Delete rows (row 1 is the header); references shift automatically.',
      properties: {
        kind: { const: 'deleteRows' },
        sheet: sheetRefSchema,
        at: { type: 'integer', minimum: 2, description: '1-based first row to delete' },
        count: { type: 'integer', minimum: 1, description: 'default 1' },
      },
      required: ['kind', 'at'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'insertCols',
      description: 'Insert blank columns; references shift automatically.',
      properties: {
        kind: { const: 'insertCols' },
        sheet: sheetRefSchema,
        at: colAddress,
        count: { type: 'integer', minimum: 1, description: 'default 1' },
      },
      required: ['kind', 'at'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'deleteCols',
      description: 'Delete columns; references shift automatically.',
      properties: {
        kind: { const: 'deleteCols' },
        sheet: sheetRefSchema,
        at: colAddress,
        count: { type: 'integer', minimum: 1, description: 'default 1' },
      },
      required: ['kind', 'at'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'setStyle',
      description: 'Apply style attributes to a cell/range/column/row target.',
      properties: {
        kind: { const: 'setStyle' },
        sheet: sheetRefSchema,
        target: {
          type: 'string',
          description: 'cell "A1", range "A1:D9", column "C:C", or rows "2:9"',
        },
        attrs: styleAttrsSchema,
      },
      required: ['kind', 'target', 'attrs'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'setFreeze',
      description: 'Freeze first N rows / M columns; both 0 or omitted removes the freeze.',
      properties: {
        kind: { const: 'setFreeze' },
        sheet: sheetRefSchema,
        rows: { type: 'integer', minimum: 0 },
        cols: { type: 'integer', minimum: 0 },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'addSheet',
      description: 'Append a new sheet, optionally right after another sheet.',
      properties: {
        kind: { const: 'addSheet' },
        name: { type: 'string' },
        after: sheetRefSchema,
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'renameSheet',
      description: 'Rename a sheet.',
      properties: {
        kind: { const: 'renameSheet' },
        sheet: sheetRefSchema,
        name: { type: 'string' },
      },
      required: ['kind', 'sheet', 'name'],
      additionalProperties: false,
    },
    {
      type: 'object',
      title: 'deleteSheet',
      description: 'Delete a sheet (no-op if it is the only sheet).',
      properties: {
        kind: { const: 'deleteSheet' },
        sheet: sheetRefSchema,
      },
      required: ['kind', 'sheet'],
      additionalProperties: false,
    },
  ],
} as const
