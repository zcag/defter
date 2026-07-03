/** AST evaluator. Resolves refs/ranges via an injected resolver; delegates calls to functions. */

import {
  type CellValue,
  ERR,
  type Range,
  type Ref,
  cellsInRange,
  isError,
  toNumber,
} from '@defterjs/core'
import { FUNCTIONS } from './functions.js'
import type { Node } from './parser.js'

export interface Resolver {
  cell(col: number, row: number, sheet: string): CellValue
}

export interface NameEntry {
  sheet: string
  range: Range
}

export interface EvalContext {
  sheet: string
  resolver: Resolver
  names: Map<string, NameEntry>
  eval(node: Node): CellValue
  /** Flatten a node into scalar values (range → its cells, ref → one cell, scalar → itself). */
  spill(node: Node): CellValue[]
  /** A node as a 2-D matrix (range → rows×cols; anything else → a 1×1 matrix). */
  matrix(node: Node): CellValue[][]
}

export function makeContext(
  sheet: string,
  resolver: Resolver,
  names: Map<string, NameEntry> = new Map(),
): EvalContext {
  const ctx: EvalContext = {
    sheet,
    resolver,
    names,
    eval: (node) => evalNode(node, ctx),
    spill: (node) => spillNode(node, ctx),
    matrix: (node) => matrixNode(node, ctx),
  }
  return ctx
}

/** Resolve a named range to a range node (with its owning sheet), or null. */
function nameRange(name: string, ctx: EvalContext): { sheet: string; range: Range } | null {
  return ctx.names.get(name.toLowerCase()) ?? null
}

function matrixNode(node: Node, ctx: EvalContext): CellValue[][] {
  let range: Range | undefined
  let sheet = ctx.sheet
  if (node.type === 'range') {
    range = node.range
    sheet = node.range.sheet ?? ctx.sheet
  } else if (node.type === 'name') {
    const nr = nameRange(node.name, ctx)
    if (nr) {
      range = nr.range
      sheet = nr.sheet
    }
  }
  if (range) {
    const rows: CellValue[][] = []
    for (let r = range.start.row; r <= range.end.row; r++) {
      const row: CellValue[] = []
      for (let c = range.start.col; c <= range.end.col; c++) row.push(ctx.resolver.cell(c, r, sheet))
      rows.push(row)
    }
    return rows
  }
  return [[ctx.eval(node)]]
}

function refSheet(ref: Ref | Range, ctx: EvalContext): string {
  return ref.sheet ?? ctx.sheet
}

function evalNode(node: Node, ctx: EvalContext): CellValue {
  switch (node.type) {
    case 'num':
      return node.value
    case 'str':
      return node.value
    case 'bool':
      return node.value
    case 'name': {
      const nr = nameRange(node.name, ctx)
      if (!nr) return ERR.name
      return ctx.resolver.cell(nr.range.start.col, nr.range.start.row, nr.sheet)
    }
    case 'ref':
      return ctx.resolver.cell(node.ref.col, node.ref.row, refSheet(node.ref, ctx))
    case 'range':
      // A bare range used as a scalar takes its top-left cell (Excel-like implicit intersection).
      return ctx.resolver.cell(node.range.start.col, node.range.start.row, refSheet(node.range, ctx))
    case 'unary': {
      const v = ctx.eval(node.operand)
      if (isError(v)) return v
      const n = toNumber(v)
      return n === null ? ERR.value : -n
    }
    case 'postfix': {
      const v = ctx.eval(node.operand)
      if (isError(v)) return v
      const n = toNumber(v)
      return n === null ? ERR.value : n / 100
    }
    case 'binary':
      return evalBinary(node.op, node.left, node.right, ctx)
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) return ERR.name
      return fn(node.args, ctx)
    }
  }
}

function evalBinary(op: string, leftNode: Node, rightNode: Node, ctx: EvalContext): CellValue {
  const l = ctx.eval(leftNode)
  if (isError(l)) return l
  const r = ctx.eval(rightNode)
  if (isError(r)) return r

  if (op === '&') return stringify(l) + stringify(r)

  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    return compare(op, l, r)
  }

  const a = toNumber(l)
  const b = toNumber(r)
  if (a === null || b === null) return ERR.value
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return b === 0 ? ERR.div0 : a / b
    case '^':
      return b === 0 && a === 0 ? 1 : a ** b
    default:
      return ERR.value
  }
}

function compare(op: string, l: CellValue, r: CellValue): boolean {
  let cmp: number
  const an = toNumber(l)
  const bn = toNumber(r)
  if (typeof l !== 'string' && typeof r !== 'string' && an !== null && bn !== null) {
    cmp = an < bn ? -1 : an > bn ? 1 : 0
  } else {
    const ls = stringify(l).toLowerCase()
    const rs = stringify(r).toLowerCase()
    cmp = ls < rs ? -1 : ls > rs ? 1 : 0
  }
  switch (op) {
    case '=':
      return cmp === 0
    case '<>':
      return cmp !== 0
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
    default:
      return false
  }
}

export function stringify(v: CellValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (isError(v)) return v.error
  return String(v)
}

function spillNode(node: Node, ctx: EvalContext): CellValue[] {
  if (node.type === 'range') {
    const sheet = refSheet(node.range, ctx)
    const out: CellValue[] = []
    for (const { col, row } of cellsInRange(node.range)) out.push(ctx.resolver.cell(col, row, sheet))
    return out
  }
  if (node.type === 'name') {
    const nr = nameRange(node.name, ctx)
    if (!nr) return [ERR.name]
    const out: CellValue[] = []
    for (const { col, row } of cellsInRange(nr.range)) out.push(ctx.resolver.cell(col, row, nr.sheet))
    return out
  }
  return [ctx.eval(node)]
}
