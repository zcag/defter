/** Built-in worksheet functions. Each takes raw arg nodes + context so it controls evaluation. */

import { type CellValue, ERR, isError, toNumber } from '@defter/core'
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
    return Math.round(x * f) / f
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
