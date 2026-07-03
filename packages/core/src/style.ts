/**
 * The `defter-style` presentation layer: parse/serialize of style rules and their A1 targets.
 * One rule per line: `<target>  <attr> <attr> ...`. See docs/FORMAT.md.
 */

import { columnIndex, columnLabel, formatRange, parseRange } from './coords.js'
import type { StyleAttrs, StyleRule, StyleTarget } from './model.js'

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

/** Parse a whole `defter-style` block body (without the fences) into rules. Lenient. */
export function parseStyleBlock(body: string): StyleRule[] {
  const rules: StyleRule[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
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
  return rules
}

/** Serialize rules to a block body (without fences). Empty string if there are no rules. */
export function serializeStyleBlock(rules: StyleRule[]): string {
  return rules
    .map((r) => `${formatStyleTarget(r.target)}  ${formatAttrs(r.attrs)}`)
    .join('\n')
}
