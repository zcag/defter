/**
 * The `defter-style` presentation layer: parse/serialize of style rules and their A1 targets.
 * One rule per line: `<target>  <attr> <attr> ...`. See docs/FORMAT.md.
 */

import { columnIndex, columnLabel, formatRange, parseRange } from './coords.js'
import type {
  ChartSpec,
  CondOp,
  CondRule,
  StyleAttrs,
  StyleRule,
  StyleTarget,
  ValidationRule,
} from './model.js'

const FLAGS = ['bold', 'italic', 'underline', 'strike', 'wrap', 'merge'] as const
const KEYS = [
  'fill',
  'color',
  'align',
  'valign',
  'format',
  'border',
  'font',
  'size',
  'width',
] as const

const NUMERIC_KEYS = new Set(['size', 'width'])

export function parseStyleTarget(text: string): StyleTarget {
  const t = text.trim()
  if (/^[A-Za-z]+:[A-Za-z]+$/.test(t)) {
    const [a, b] = t.split(':')
    return { kind: 'cols', start: columnIndex(a!), end: columnIndex(b!) }
  }
  if (/^\d+:\d+$/.test(t)) {
    const [a, b] = t.split(':')
    return { kind: 'rows', start: Number.parseInt(a!, 10), end: Number.parseInt(b!, 10) }
  }
  return { kind: 'range', range: parseRange(t) }
}

export function formatStyleTarget(target: StyleTarget): string {
  switch (target.kind) {
    case 'cols':
      return `${columnLabel(target.start)}:${columnLabel(target.end)}`
    case 'rows':
      return `${target.start}:${target.end}`
    case 'range':
      return formatRange(target.range)
  }
}

function parseAttrs(tokens: string[]): StyleAttrs {
  const attrs: StyleAttrs = {}
  for (const tok of tokens) {
    if (!tok) continue
    const eq = tok.indexOf('=')
    if (eq < 0) {
      if ((FLAGS as readonly string[]).includes(tok)) {
        ;(attrs as Record<string, unknown>)[tok] = true
      }
      continue
    }
    const key = tok.slice(0, eq)
    const value = tok.slice(eq + 1)
    if (!(KEYS as readonly string[]).includes(key)) continue
    if (NUMERIC_KEYS.has(key)) {
      const n = Number.parseFloat(value)
      if (!Number.isNaN(n)) (attrs as Record<string, unknown>)[key] = n
    } else {
      ;(attrs as Record<string, unknown>)[key] = value
    }
  }
  return attrs
}

/** Deterministic attribute serialization: flags in fixed order, then keyed attrs in fixed order. */
export function formatAttrs(attrs: StyleAttrs): string {
  const out: string[] = []
  for (const flag of FLAGS) {
    if ((attrs as Record<string, unknown>)[flag]) out.push(flag)
  }
  for (const key of KEYS) {
    const v = (attrs as Record<string, unknown>)[key]
    if (v !== undefined && v !== null && v !== '') out.push(`${key}=${v}`)
  }
  return out.join(' ')
}

export interface ParsedStyleBlock {
  rules: StyleRule[]
  charts: ChartSpec[]
  conditionals: CondRule[]
  validations: ValidationRule[]
}

function parseValidateLine(line: string): ValidationRule | null {
  // validate <target> list=A,B,C
  const rest = line.slice(9).trim() // drop "validate "
  const m = /^(\S+)\s+list=(.+)$/.exec(rest)
  if (!m) return null
  let target: StyleTarget
  try {
    target = parseStyleTarget(m[1]!)
  } catch {
    return null
  }
  const list = m[2]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? { target, list } : null
}

function parseCondLine(line: string): CondRule | null {
  // when <target> <op> <value>  <attr> <attr> ...
  const rest = line.slice(5).trim() // drop "when "
  const opMatch = /(>=|<=|<>|>|<|=)/.exec(rest)
  if (!opMatch) return null
  const targetText = rest.slice(0, opMatch.index).trim()
  const afterOp = rest.slice(opMatch.index + opMatch[0].length).trim()
  const parts = afterOp.split(/\s+/)
  const valueTok = parts[0] ?? ''
  const value = valueTok.startsWith('"') ? valueTok.replace(/^"|"$/g, '') : Number(valueTok)
  let target: StyleTarget
  try {
    target = parseStyleTarget(targetText)
  } catch {
    return null
  }
  const attrs = parseAttrs(parts.slice(1))
  if (Object.keys(attrs).length === 0) return null
  return { target, op: opMatch[0] as CondOp, value: Number.isNaN(value as number) ? valueTok : value, attrs }
}

/** Parse a whole `defter-style` block body (without the fences). Lenient. */
export function parseStyleBlock(body: string): ParsedStyleBlock {
  const rules: StyleRule[] = []
  const charts: ChartSpec[] = []
  const conditionals: CondRule[] = []
  const validations: ValidationRule[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.toLowerCase().startsWith('when ')) {
      const cond = parseCondLine(line)
      if (cond) conditionals.push(cond)
      continue
    }
    if (line.toLowerCase().startsWith('validate ')) {
      const val = parseValidateLine(line)
      if (val) validations.push(val)
      continue
    }
    if (line.toLowerCase().startsWith('chart ') || line.toLowerCase() === 'chart') {
      const chart = parseChartLine(line)
      if (chart) charts.push(chart)
      continue
    }
    const parts = line.split(/\s+/)
    const targetText = parts[0]!
    let target: StyleTarget
    try {
      target = parseStyleTarget(targetText)
    } catch {
      continue // skip a rule with an unparseable target rather than throwing
    }
    const attrs = parseAttrs(parts.slice(1))
    if (Object.keys(attrs).length > 0) rules.push({ target, attrs })
  }
  return { rules, charts, conditionals, validations }
}

const CHART_ATTR = /(\w+)=(?:"([^"]*)"|(\S+))/g

function parseChartLine(line: string): ChartSpec | null {
  const rest = line.slice(line.toLowerCase().indexOf('chart') + 5)
  const kv: Record<string, string> = {}
  for (const m of rest.matchAll(CHART_ATTR)) kv[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? ''
  const type = (kv.type ?? 'bar') as ChartSpec['type']
  if (!['bar', 'line', 'pie', 'area'].includes(type)) return null
  if (!kv.y && !kv.values) return null
  try {
    return {
      type,
      title: kv.title || undefined,
      labels: kv.x ? parseRange(kv.x) : undefined,
      values: parseRange(kv.y ?? kv.values!),
    }
  } catch {
    return null
  }
}

/** Serialize rules, conditionals, and charts to a block body (without fences). */
export function serializeStyleBlock(
  rules: StyleRule[],
  charts: ChartSpec[] = [],
  conditionals: CondRule[] = [],
  validations: ValidationRule[] = [],
): string {
  const lines = rules.map((r) => `${formatStyleTarget(r.target)}  ${formatAttrs(r.attrs)}`)
  for (const cond of conditionals) {
    const v = typeof cond.value === 'number' ? cond.value : `"${cond.value}"`
    lines.push(`when ${formatStyleTarget(cond.target)} ${cond.op} ${v}  ${formatAttrs(cond.attrs)}`)
  }
  for (const val of validations) {
    lines.push(`validate ${formatStyleTarget(val.target)} list=${val.list.join(',')}`)
  }
  for (const ch of charts) lines.push(serializeChart(ch))
  return lines.join('\n')
}

function serializeChart(ch: ChartSpec): string {
  const parts = [`chart type=${ch.type}`]
  if (ch.title) parts.push(`title="${ch.title}"`)
  if (ch.labels) parts.push(`x=${formatRange(ch.labels)}`)
  parts.push(`y=${formatRange(ch.values)}`)
  return parts.join(' ')
}
