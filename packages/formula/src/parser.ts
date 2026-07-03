/** Pratt parser: tokens → AST. Handles refs, ranges, sheet-qualified refs, calls, operators. */

import { type Range, type Ref, parseRef } from '@defterjs/core'
import { type Token, lex } from './lexer.js'

export type Node =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'ref'; ref: Ref }
  | { type: 'range'; range: Range }
  | { type: 'name'; name: string }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'postfix'; op: string; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

const LBP: Record<string, number> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 15,
  '+': 20,
  '-': 20,
  '*': 30,
  '/': 30,
  '^': 40,
}

export function parseFormula(src: string): Node {
  const tokens = lex(src)
  const p = new Parser(tokens)
  const node = p.expr(0)
  p.expectEnd()
  return node
}

class Parser {
  private i = 0
  constructor(private toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i]
  }
  private next(): Token | undefined {
    return this.toks[this.i++]
  }
  expectEnd(): void {
    if (this.i !== this.toks.length) throw new SyntaxError('trailing tokens in formula')
  }

  expr(minBp: number): Node {
    let left = this.nud()
    for (;;) {
      const t = this.peek()
      if (!t) break
      if (t.kind === 'op' && t.value === '%') {
        this.next()
        left = { type: 'postfix', op: '%', operand: left }
        continue
      }
      if (t.kind !== 'op') break
      const bp = LBP[t.value]
      if (bp === undefined || bp <= minBp) break
      this.next()
      const right = this.expr(bp)
      left = { type: 'binary', op: t.value, left, right }
    }
    return left
  }

  private nud(): Node {
    const t = this.next()
    if (!t) throw new SyntaxError('unexpected end of formula')
    switch (t.kind) {
      case 'num':
        return { type: 'num', value: Number(t.value) }
      case 'str':
        return { type: 'str', value: t.value }
      case 'op':
        if (t.value === '-') return { type: 'unary', op: '-', operand: this.expr(50) }
        if (t.value === '+') return this.expr(50)
        throw new SyntaxError(`unexpected operator '${t.value}'`)
      case 'lparen': {
        const inner = this.expr(0)
        this.expectKind('rparen')
        return inner
      }
      case 'sqstr':
        return this.sheetQualified(t.value)
      case 'ref':
        // A ref token directly followed by '(' is really a function name (e.g. LOG10).
        if (this.peek()?.kind === 'lparen') return this.call(t.value)
        return this.refOrRange(parseRef(t.value))
      case 'ident': {
        const up = t.value.toUpperCase()
        if (this.peek()?.kind === 'lparen') return this.call(t.value)
        if (this.peek()?.kind === 'bang') return this.sheetQualified(t.value)
        if (up === 'TRUE') return { type: 'bool', value: true }
        if (up === 'FALSE') return { type: 'bool', value: false }
        return { type: 'name', name: t.value }
      }
      default:
        throw new SyntaxError(`unexpected token '${t.value}'`)
    }
  }

  private sheetQualified(sheet: string): Node {
    this.expectKind('bang')
    const refTok = this.next()
    if (!refTok || refTok.kind !== 'ref') throw new SyntaxError('expected reference after sheet')
    const ref = { ...parseRef(refTok.value), sheet }
    return this.refOrRange(ref)
  }

  private refOrRange(start: Ref): Node {
    if (this.peek()?.kind === 'colon') {
      this.next()
      const endTok = this.next()
      if (!endTok || endTok.kind !== 'ref') throw new SyntaxError('expected reference after :')
      const end = parseRef(endTok.value)
      return {
        type: 'range',
        range: normalize({ start, end: { ...end, sheet: undefined }, sheet: start.sheet }),
      }
    }
    return { type: 'ref', ref: start }
  }

  private call(name: string): Node {
    this.expectKind('lparen')
    const args: Node[] = []
    if (this.peek()?.kind !== 'rparen') {
      args.push(this.expr(0))
      while (this.peek()?.kind === 'comma') {
        this.next()
        args.push(this.expr(0))
      }
    }
    this.expectKind('rparen')
    return { type: 'call', name: name.toUpperCase(), args }
  }

  private expectKind(kind: Token['kind']): Token {
    const t = this.next()
    if (!t || t.kind !== kind) throw new SyntaxError(`expected ${kind}`)
    return t
  }
}

function normalize(r: Range): Range {
  const minCol = Math.min(r.start.col, r.end.col)
  const maxCol = Math.max(r.start.col, r.end.col)
  const minRow = Math.min(r.start.row, r.end.row)
  const maxRow = Math.max(r.start.row, r.end.row)
  return {
    sheet: r.sheet,
    start: { col: minCol, row: minRow, colAbs: r.start.colAbs, rowAbs: r.start.rowAbs },
    end: { col: maxCol, row: maxRow, colAbs: r.end.colAbs, rowAbs: r.end.rowAbs },
  }
}
