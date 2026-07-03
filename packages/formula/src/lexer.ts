/** Tokenizer for the formula grammar. */

export type TokKind =
  | 'num'
  | 'str'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'bang'
  | 'sqstr'
  | 'ref'
  | 'ident'

export interface Token {
  kind: TokKind
  value: string
  pos: number
}

const OPS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%']

export function lex(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let str = ''
      while (j < n) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            str += '"'
            j += 2
            continue
          }
          break
        }
        str += input[j]
        j++
      }
      tokens.push({ kind: 'str', value: str, pos: i })
      i = j + 1
      continue
    }
    if (ch === "'") {
      let j = i + 1
      let str = ''
      while (j < n && input[j] !== "'") {
        str += input[j]
        j++
      }
      tokens.push({ kind: 'sqstr', value: str, pos: i })
      i = j + 1
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, pos: i++ })
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, pos: i++ })
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch, pos: i++ })
      continue
    }
    if (ch === ':') {
      tokens.push({ kind: 'colon', value: ch, pos: i++ })
      continue
    }
    if (ch === '!') {
      tokens.push({ kind: 'bang', value: ch, pos: i++ })
      continue
    }
    const two = input.slice(i, i + 2)
    if (OPS.includes(two)) {
      tokens.push({ kind: 'op', value: two, pos: i })
      i += 2
      continue
    }
    if (OPS.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i++ })
      continue
    }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(input.slice(i))
    if (num && ch >= '0' && ch <= '9') {
      tokens.push({ kind: 'num', value: num[0], pos: i })
      i += num[0].length
      continue
    }
    if (ch === '.' && /^\.\d/.test(input.slice(i))) {
      const m = /^\.\d+([eE][+-]?\d+)?/.exec(input.slice(i))!
      tokens.push({ kind: 'num', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    // A cell ref: optional $, 1-3 col letters, optional $, row digits.
    const ref = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(input.slice(i))
    if (ref) {
      tokens.push({ kind: 'ref', value: ref[0], pos: i })
      i += ref[0].length
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(i))
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0], pos: i })
      i += ident[0].length
      continue
    }
    throw new SyntaxError(`unexpected character '${ch}' at ${i}`)
  }
  return tokens
}
