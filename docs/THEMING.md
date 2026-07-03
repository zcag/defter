# Theming Defter

The grid has **no hard-coded colours**. Every visual value — colours, fonts, metrics — is a CSS
custom property (a `--defter-*` variable). Nothing is painted with a literal colour, so a host page
can remap the entire grid onto its own design tokens, statically or **live at runtime**, without
touching Defter's code or stylesheet.

There are three ways to theme, from least to most dynamic. They compose.

## 1. Built-in presets — `theme`

```tsx
<DefterGrid text={text} theme="light" />   // "light" | "dark" | "paper"
```

Each preset is just a block of `--defter-*` values under a `[data-defter-theme="…"]` selector in
`@defter/react`'s stylesheet. `theme` also accepts any custom string — pair it with your own CSS:

```css
[data-defter-theme="brand"] { --defter-accent: #e0115f; --defter-bg: #0b0b10; /* … */ }
```
```tsx
<DefterGrid text={text} theme="brand" />
```

## 2. Map your tokens in CSS

If your app already themes itself with CSS variables, point Defter's tokens at yours **once**. When
your variables change (a runtime theme switch, a user colour picker writing to `:root`), the grid
follows automatically — CSS variable references are live.

```css
.defter-shell {
  --defter-accent: var(--brand-primary);
  --defter-bg: var(--brand-surface);
  --defter-fg: var(--brand-text);
  --defter-grid-line: var(--brand-border);
}
```

## 3. Drive it from JavaScript — the `style` prop

The `style` prop is forwarded straight to the grid's root element, and inline variables win over
everything (preset themes included) and update the moment you change them. This is the path for
"my page dynamically changes its colours and the sheet should follow":

```tsx
const [brand, setBrand] = useState('#2f6df6')
const rgb = hexToRgb(brand) // "47, 109, 246"

<DefterGrid
  text={text}
  style={{
    '--defter-accent': brand,
    '--defter-selection-border': brand,
    '--defter-focus-ring': brand,
    '--defter-selection-bg': `rgba(${rgb}, 0.18)`,
    '--defter-token-accent': brand,
  } as CSSProperties}
/>
```

Change `brand` and the grid repaints in place — no reload, no re-layout. (The playground's **Accent**
picker on the demo site is exactly this, ~15 lines.) Equivalently, without React:
`gridEl.style.setProperty('--defter-accent', '#e0115f')`.

## Token reference

All variables are declared on `.defter-shell` (the grid's root) and inherit down. Override any of
them by any of the three methods above.

### Metrics & fonts
| Variable | Purpose | Light default |
|---|---|---|
| `--defter-font` | UI/cell font stack | system sans |
| `--defter-font-mono` | monospace (formula source) | system mono |
| `--defter-font-size` | base cell font size | `13px` |
| `--defter-row-height` | row height (match `rowHeight` when virtualizing) | `26px` |
| `--defter-col-width` | default column width | `110px` |
| `--defter-head-width` | row-header gutter width | `44px` |

### Surfaces & structure
| Variable | Purpose | Light default |
|---|---|---|
| `--defter-bg` | cell/grid background | `#ffffff` |
| `--defter-fg` | cell text | `#1a1a22` |
| `--defter-muted-fg` | secondary text | `#6b7280` |
| `--defter-grid-line` | grid lines | `#e6e7eb` |
| `--defter-grid-line-strong` | outer borders, applied cell borders | `#d1d4db` |
| `--defter-header-bg` / `--defter-header-fg` | column/row headers | `#f6f7f9` / `#57606a` |
| `--defter-header-active-bg` / `--defter-header-active-fg` | header of the selected column/row | `#e3e9fb` / `#1c3e9e` |
| `--defter-corner-bg` | top-left corner cell | `#eef0f3` |
| `--defter-bar-bg` | toolbar / formula bar / status bar | `#fbfbfc` |

### Accent & selection
| Variable | Purpose | Light default |
|---|---|---|
| `--defter-accent` | accent (active toolbar buttons, links) | `#2f6df6` |
| `--defter-selection-border` | selection outline / active-cell ring | `#2f6df6` |
| `--defter-focus-ring` | cell-editor focus ring | `#2f6df6` |
| `--defter-selection-bg` | selection fill tint (use an `rgba` with alpha) | `rgba(47,109,246,0.18)` |

### Palette tokens (used by `defter-style` fills & text colours)
Cell fills and font colours in the `defter-style` block reference these by short name (`accent`,
`success-soft`, …), which resolve to `--defter-token-<name>`. Remap them to restyle documents
without editing the document text.

`--defter-token-surface-1|2|3`, `--defter-token-accent`, `--defter-token-accent-soft`,
`--defter-token-success`, `--defter-token-success-soft`, `--defter-token-warning`,
`--defter-token-warning-soft`, `--defter-token-danger`, `--defter-token-danger-soft`,
`--defter-token-muted`.

> Precedence, highest first: inline `style` vars → `[data-defter-theme]` preset → your
> `.defter-shell` overrides → built-in light defaults. So a `style`-prop colour always wins, which
> is why it's the right tool for live, host-driven theming.
