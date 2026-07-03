import type { StyleAttrs } from '@defterjs/core'
import type { CSSProperties } from 'react'

/** Resolve a fill/color token to a CSS color: hex/rgb/hsl literal, else a `--defter-token-*` var. */
export function resolveColor(token: string): string {
  if (/^(#|rgb|hsl|var\()/.test(token)) return token
  return `var(--defter-token-${token})`
}

/** Translate resolved style attributes into inline CSS for a cell. */
export function styleToCss(attrs: StyleAttrs): CSSProperties {
  const css: CSSProperties = {}
  if (attrs.bold) css.fontWeight = 600
  if (attrs.italic) css.fontStyle = 'italic'
  const deco: string[] = []
  if (attrs.underline) deco.push('underline')
  if (attrs.strike) deco.push('line-through')
  if (deco.length) css.textDecoration = deco.join(' ')
  if (attrs.fill) css.backgroundColor = resolveColor(attrs.fill)
  if (attrs.color) css.color = resolveColor(attrs.color)
  if (attrs.align) css.textAlign = attrs.align
  if (attrs.valign) css.verticalAlign = attrs.valign
  if (attrs.size) css.fontSize = `${attrs.size}px`
  if (attrs.font) css.fontFamily = attrs.font
  if (attrs.border) applyBorder(css, attrs.border)
  return css
}

/** Minimal border spec: `all`, `outer`, or `<side>[,<side>...]` where side ∈ top|right|bottom|left. */
function applyBorder(css: CSSProperties, spec: string): void {
  const line = '1px solid var(--defter-grid-line-strong)'
  const sides = spec === 'all' || spec === 'outer' ? ['top', 'right', 'bottom', 'left'] : spec.split(',')
  for (const s of sides) {
    if (s === 'top') css.borderTop = line
    else if (s === 'right') css.borderRight = line
    else if (s === 'bottom') css.borderBottom = line
    else if (s === 'left') css.borderLeft = line
  }
}
