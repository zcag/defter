/** Built-in worksheet functions. Each takes raw arg nodes + context so it controls evaluation. */

import { type CellValue, ERR, formatValue, isError, toNumber } from '@defter/core'
import { type EvalContext, stringify } from './evaluator.js'
import type { Node } from './parser.js'

type Fn = (args: Node[], ctx: EvalContext) => CellValue

/** Flatten args to numbers, ignoring blanks/text (Excel aggregate semantics). Errors propagate. */
function numbers(args: Node[], ctx: EvalContext): number[] | CellValue {
  const out: number[] = []
  for (const arg of args) {
    for (const v of ctx.spill(arg)) {
      if (isError(v)) return v
      if (typeof v === 'number') out.push(v)
      else if (typeof v === 'boolean') out.push(v ? 1 : 0)
      // strings and blanks are ignored by SUM/AVERAGE/etc.
    }
  }
  return out
}

function firstError(values: CellValue[]): CellValue | null {
  for (const v of values) if (isError(v)) return v
  return null
}

function toBool(v: CellValue): boolean | CellValue {
  if (isError(v)) return v
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null) return false
  const s = v.toUpperCase()
  if (s === 'TRUE') return true
  if (s === 'FALSE') return false
  return ERR.value
}

function num1(args: Node[], ctx: EvalContext, f: (x: number) => CellValue): CellValue {
  const v = ctx.eval(args[0]!)
  if (isError(v)) return v
  const n = toNumber(v)
  return n === null ? ERR.value : f(n)
}

export const FUNCTIONS: Record<string, Fn> = {
  SUM(args, ctx) {
    const ns = numbers(args, ctx)
    if (!Array.isArray(ns)) return ns
    return ns.reduce((a, b) => a + b, 0)
  },
  PRODUCT(args, ctx) {
    const ns = numbers(args, ctx)
    if (!Array.isArray(ns)) return ns
    return ns.reduce((a, b) => a * b, 1)
  },
  AVERAGE(args, ctx) {
    const ns = numbers(args, ctx)
    if (!Array.isArray(ns)) return ns
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : ERR.div0
  },
  MIN(args, ctx) {
    const ns = numbers(args, ctx)
    if (!Array.isArray(ns)) return ns
    return ns.length ? Math.min(...ns) : 0
  },
  MAX(args, ctx) {
    const ns = numbers(args, ctx)
    if (!Array.isArray(ns)) return ns
    return ns.length ? Math.max(...ns) : 0
  },
  COUNT(args, ctx) {
    let c = 0
    for (const arg of args) for (const v of ctx.spill(arg)) if (typeof v === 'number') c++
    return c
  },
  COUNTA(args, ctx) {
    let c = 0
    for (const arg of args) for (const v of ctx.spill(arg)) if (v !== null) c++
    return c
  },
  IF(args, ctx) {
    const cond = toBool(ctx.eval(args[0]!))
    if (isError(cond)) return cond
    if (cond) return args[1] ? ctx.eval(args[1]) : true
    return args[2] ? ctx.eval(args[2]) : false
  },
  IFERROR(args, ctx) {
    const v = ctx.eval(args[0]!)
    return isError(v) ? (args[1] ? ctx.eval(args[1]) : '') : v
  },
  AND(args, ctx) {
    for (const arg of args) {
      for (const v of ctx.spill(arg)) {
        const b = toBool(v)
        if (isError(b)) return b
        if (!b) return false
      }
    }
    return true
  },
  OR(args, ctx) {
    for (const arg of args) {
      for (const v of ctx.spill(arg)) {
        const b = toBool(v)
        if (isError(b)) return b
        if (b) return true
      }
    }
    return false
  },
  NOT(args, ctx) {
    const b = toBool(ctx.eval(args[0]!))
    return isError(b) ? b : !b
  },
  ROUND(args, ctx) {
    const x = toNumber(ctx.eval(args[0]!))
    const d = args[1] ? toNumber(ctx.eval(args[1])) : 0
    if (x === null || d === null) return ERR.value
    const f = 10 ** d
    // Excel rounds halves away from zero, not toward +∞ (Math.round).
    return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f
  },
  ROUNDUP(args, ctx) {
    const x = toNumber(ctx.eval(args[0]!))
    const d = args[1] ? toNumber(ctx.eval(args[1])) : 0
    if (x === null || d === null) return ERR.value
    const f = 10 ** d
    return (x < 0 ? -1 : 1) * Math.ceil(Math.abs(x) * f) / f
  },
  ROUNDDOWN(args, ctx) {
    const x = toNumber(ctx.eval(args[0]!))
    const d = args[1] ? toNumber(ctx.eval(args[1])) : 0
    if (x === null || d === null) return ERR.value
    const f = 10 ** d
    return (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * f) / f
  },
  ABS: (a, c) => num1(a, c, Math.abs),
  SQRT: (a, c) => num1(a, c, (x) => (x < 0 ? ERR.num : Math.sqrt(x))),
  INT: (a, c) => num1(a, c, Math.floor),
  TRUNC: (a, c) => num1(a, c, Math.trunc),
  POWER(args, ctx) {
    const x = toNumber(ctx.eval(args[0]!))
    const y = toNumber(ctx.eval(args[1]!))
    if (x === null || y === null) return ERR.value
    return x ** y
  },
  MOD(args, ctx) {
    const a = toNumber(ctx.eval(args[0]!))
    const b = toNumber(ctx.eval(args[1]!))
    if (a === null || b === null) return ERR.value
    return b === 0 ? ERR.div0 : ((a % b) + b) % b
  },
  CONCAT: concat,
  CONCATENATE: concat,
  LEN(args, ctx) {
    const v = ctx.eval(args[0]!)
    return isError(v) ? v : stringify(v).length
  },
  UPPER(args, ctx) {
    const v = ctx.eval(args[0]!)
    return isError(v) ? v : stringify(v).toUpperCase()
  },
  LOWER(args, ctx) {
    const v = ctx.eval(args[0]!)
    return isError(v) ? v : stringify(v).toLowerCase()
  },
  TRIM(args, ctx) {
    const v = ctx.eval(args[0]!)
    return isError(v) ? v : stringify(v).trim()
  },
}

function concat(args: Node[], ctx: EvalContext): CellValue {
  let s = ''
  for (const arg of args) {
    for (const v of ctx.spill(arg)) {
      if (isError(v)) return v
      s += stringify(v)
    }
  }
  return s
}

/** Build a predicate from an Excel-style criterion (">5", "<=3", "abc", 42). */
function criterion(crit: CellValue): (v: CellValue) => boolean {
  if (typeof crit === 'number') return (v) => toNumber(v) === crit
  const s = stringify(crit)
  const m = /^(<=|>=|<>|=|<|>)?\s*(.*)$/.exec(s)!
  const op = m[1] || '='
  const rhs = m[2]!
  const rhsNum = Number(rhs)
  const numeric = rhs !== '' && !Number.isNaN(rhsNum)
  return (v) => {
    if (numeric) {
      const n = toNumber(v)
      if (n === null) return false
      switch (op) {
        case '=':
          return n === rhsNum
        case '<>':
          return n !== rhsNum
        case '<':
          return n < rhsNum
        case '>':
          return n > rhsNum
        case '<=':
          return n <= rhsNum
        case '>=':
          return n >= rhsNum
      }
    }
    const sv = stringify(v).toLowerCase()
    const r = rhs.toLowerCase()
    return op === '<>' ? sv !== r : sv === r
  }
}

function str1(args: Node[], ctx: EvalContext, f: (s: string) => CellValue): CellValue {
  const v = ctx.eval(args[0]!)
  return isError(v) ? v : f(stringify(v))
}

Object.assign(FUNCTIONS, {
  LEFT: (a: Node[], c: EvalContext) =>
    str1(a, c, (s) => s.slice(0, a[1] ? (toNumber(c.eval(a[1])) ?? 0) : 1)),
  RIGHT: (a: Node[], c: EvalContext) =>
    str1(a, c, (s) => {
      const n = a[1] ? (toNumber(c.eval(a[1])) ?? 0) : 1
      return n <= 0 ? '' : s.slice(-n)
    }),
  MID: (a: Node[], c: EvalContext) =>
    str1(a, c, (s) => {
      const start = toNumber(c.eval(a[1]!)) ?? 1
      const len = toNumber(c.eval(a[2]!)) ?? 0
      return s.slice(start - 1, start - 1 + len)
    }),
  FIND: (a: Node[], c: EvalContext) => {
    const sub = stringify(c.eval(a[0]!))
    const s = stringify(c.eval(a[1]!))
    const from = a[2] ? (toNumber(c.eval(a[2])) ?? 1) : 1
    const idx = s.indexOf(sub, from - 1)
    return idx < 0 ? ERR.value : idx + 1
  },
  SUBSTITUTE: (a: Node[], c: EvalContext) => {
    const s = stringify(c.eval(a[0]!))
    const oldT = stringify(c.eval(a[1]!))
    const newT = stringify(c.eval(a[2]!))
    return oldT === '' ? s : s.split(oldT).join(newT)
  },
  TEXT: (a: Node[], c: EvalContext) => {
    const v = c.eval(a[0]!)
    const fmt = stringify(c.eval(a[1]!))
    return formatValue(v, { format: fmt })
  },
  SUMIF: (a: Node[], c: EvalContext) => conditionalAgg(a, c, 'sum'),
  COUNTIF: (a: Node[], c: EvalContext) => conditionalAgg(a, c, 'count'),
  AVERAGEIF: (a: Node[], c: EvalContext) => conditionalAgg(a, c, 'avg'),
  IFS: (a: Node[], c: EvalContext) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const cond = c.eval(a[i]!)
      if (isError(cond)) return cond
      if (cond === true || (typeof cond === 'number' && cond !== 0)) return c.eval(a[i + 1]!)
    }
    return ERR.na
  },
  SWITCH: (a: Node[], c: EvalContext) => {
    const subject = stringify(c.eval(a[0]!))
    let i = 1
    for (; i + 1 < a.length; i += 2) {
      if (stringify(c.eval(a[i]!)) === subject) return c.eval(a[i + 1]!)
    }
    return i < a.length ? c.eval(a[i]!) : ERR.na
  },
  INDEX: (a: Node[], c: EvalContext) => {
    const m = c.matrix(a[0]!)
    const rowNum = a[1] ? (toNumber(c.eval(a[1])) ?? 0) : 0
    const colNum = a[2] ? (toNumber(c.eval(a[2])) ?? 0) : 0
    const r = rowNum > 0 ? rowNum - 1 : 0
    const col = colNum > 0 ? colNum - 1 : 0
    return m[r]?.[col] ?? ERR.ref
  },
  MATCH: (a: Node[], c: EvalContext) => {
    const target = c.eval(a[0]!)
    const flat = c.matrix(a[1]!).flat()
    const type = a[2] ? (toNumber(c.eval(a[2])) ?? 1) : 1
    const tn = toNumber(target)
    if (type === 0) {
      const ts = stringify(target).toLowerCase()
      for (let i = 0; i < flat.length; i++) if (stringify(flat[i]!).toLowerCase() === ts) return i + 1
      return ERR.na
    }
    let best = -1
    for (let i = 0; i < flat.length; i++) {
      const n = toNumber(flat[i]!)
      if (n === null || tn === null) continue
      if (type === 1 && n <= tn) best = i
      if (type === -1 && n >= tn) best = i
    }
    return best < 0 ? ERR.na : best + 1
  },
  VLOOKUP: (a: Node[], c: EvalContext) => {
    const target = c.eval(a[0]!)
    const m = c.matrix(a[1]!)
    const colIdx = (toNumber(c.eval(a[2]!)) ?? 1) - 1
    const exact = a[3] ? c.eval(a[3]) === false || toNumber(c.eval(a[3])) === 0 : false
    const ts = stringify(target).toLowerCase()
    const tn = toNumber(target)
    let hit = -1
    for (let i = 0; i < m.length; i++) {
      const cell = m[i]![0]!
      if (exact) {
        if (stringify(cell).toLowerCase() === ts) {
          hit = i
          break
        }
      } else {
        const n = toNumber(cell)
        if (n !== null && tn !== null && n <= tn) hit = i
      }
    }
    if (hit < 0) return ERR.na
    return m[hit]?.[colIdx] ?? ERR.ref
  },
  HLOOKUP: (a: Node[], c: EvalContext) => {
    const target = c.eval(a[0]!)
    const m = c.matrix(a[1]!)
    const rowIdx = (toNumber(c.eval(a[2]!)) ?? 1) - 1
    const exact = a[3] ? c.eval(a[3]) === false || toNumber(c.eval(a[3])) === 0 : false
    const ts = stringify(target).toLowerCase()
    const tn = toNumber(target)
    const header = m[0] ?? []
    let hit = -1
    for (let j = 0; j < header.length; j++) {
      if (exact) {
        if (stringify(header[j]!).toLowerCase() === ts) {
          hit = j
          break
        }
      } else {
        const nn = toNumber(header[j]!)
        if (nn !== null && tn !== null && nn <= tn) hit = j
      }
    }
    if (hit < 0) return ERR.na
    return m[rowIdx]?.[hit] ?? ERR.ref
  },
})

function conditionalAgg(args: Node[], ctx: EvalContext, mode: 'sum' | 'count' | 'avg'): CellValue {
  const range = ctx.spill(args[0]!)
  const pred = criterion(ctx.eval(args[1]!))
  const sumRange = args[2] ? ctx.spill(args[2]) : range
  let total = 0
  let count = 0
  for (let i = 0; i < range.length; i++) {
    if (!pred(range[i]!)) continue
    count++
    const n = toNumber(sumRange[i] ?? null)
    if (n !== null) total += n
  }
  if (mode === 'count') return count
  if (mode === 'avg') return count ? total / count : ERR.div0
  return total
}
