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
`@defterjs/react`'s stylesheet. `theme` also accepts any custom string — pair it with your own CSS:

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

## Token reference — the canonical contract

This is the **complete, canonical list** of every `--defter-*` custom property the stylesheet reads.
All variables are declared on `.defter-shell` (the grid's root) and inherit down. Override any of
them by any of the three methods above. A host that maps its own tokens onto Defter's should map
**all** of these; diff your mapping against this list (or the machine-readable block at the end of
this file) to catch any it's missing.

> **Contract stability.** These 33 variables are a stable public interface. **Adding, renaming, or
> removing a `--defter-*` variable is a contract change** — it must be reflected here (table + the
> JSON block below) in the same change, so hosts can diff and update their mappings. Treat the JSON
> block as the source of truth to diff against.

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

## Machine-readable contract

The same 33 variables as data, for a host to diff programmatically. Grouped as in the tables above;
`light`/`dark` are the built-in preset defaults from `@defterjs/react`'s `styles.css`.

```json
{
  "metrics": {
    "--defter-font": { "purpose": "UI/cell font stack", "light": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif" },
    "--defter-font-mono": { "purpose": "monospace (formula source)", "light": "ui-monospace, \"SF Mono\", \"JetBrains Mono\", Menlo, monospace" },
    "--defter-font-size": { "purpose": "base cell font size", "light": "13px" },
    "--defter-row-height": { "purpose": "row height (match rowHeight when virtualizing)", "light": "26px" },
    "--defter-col-width": { "purpose": "default column width", "light": "110px" },
    "--defter-head-width": { "purpose": "row-header gutter width", "light": "44px" }
  },
  "surfaces": {
    "--defter-bg": { "purpose": "cell/grid background", "light": "#ffffff", "dark": "#14161c" },
    "--defter-fg": { "purpose": "cell text", "light": "#1a1a22", "dark": "#e7e9ee" },
    "--defter-muted-fg": { "purpose": "secondary text", "light": "#6b7280", "dark": "#9aa1ad" },
    "--defter-grid-line": { "purpose": "grid lines", "light": "#e6e7eb", "dark": "#262a33" },
    "--defter-grid-line-strong": { "purpose": "outer borders, applied cell borders", "light": "#d1d4db", "dark": "#333844" },
    "--defter-header-bg": { "purpose": "column/row header background", "light": "#f6f7f9", "dark": "#1b1e26" },
    "--defter-header-fg": { "purpose": "column/row header text", "light": "#57606a", "dark": "#9aa1ad" },
    "--defter-header-active-bg": { "purpose": "header bg of the selected column/row", "light": "#e3e9fb", "dark": "#23324f" },
    "--defter-header-active-fg": { "purpose": "header text of the selected column/row", "light": "#1c3e9e", "dark": "#cdd8f5" },
    "--defter-corner-bg": { "purpose": "top-left corner cell", "light": "#eef0f3", "dark": "#20242d" },
    "--defter-bar-bg": { "purpose": "toolbar / formula bar / status bar", "light": "#fbfbfc", "dark": "#191c23" }
  },
  "accent": {
    "--defter-accent": { "purpose": "accent (active toolbar buttons, links)", "light": "#2f6df6", "dark": "#5b8bff" },
    "--defter-selection-border": { "purpose": "selection outline / active-cell ring", "light": "#2f6df6", "dark": "#5b8bff" },
    "--defter-focus-ring": { "purpose": "cell-editor focus ring", "light": "#2f6df6", "dark": "#5b8bff" },
    "--defter-selection-bg": { "purpose": "selection fill tint (rgba with alpha)", "light": "rgba(47, 109, 246, 0.18)", "dark": "rgba(91, 139, 255, 0.26)" }
  },
  "palette": {
    "--defter-token-surface-1": { "purpose": "defter-style fill: surface-1", "light": "#ffffff", "dark": "#14161c" },
    "--defter-token-surface-2": { "purpose": "defter-style fill: surface-2", "light": "#f3f4f6", "dark": "#1e222b" },
    "--defter-token-surface-3": { "purpose": "defter-style fill: surface-3", "light": "#e5e7eb", "dark": "#2a2f3a" },
    "--defter-token-accent": { "purpose": "defter-style fill/text: accent", "light": "#2f6df6", "dark": "#5b8bff" },
    "--defter-token-accent-soft": { "purpose": "defter-style fill: accent-soft", "light": "#dbe7ff", "dark": "#23324f" },
    "--defter-token-success": { "purpose": "defter-style fill/text: success", "light": "#1a7f47", "dark": "#4ac07f" },
    "--defter-token-success-soft": { "purpose": "defter-style fill: success-soft", "light": "#d7f0e0", "dark": "#163a29" },
    "--defter-token-warning": { "purpose": "defter-style fill/text: warning", "light": "#a8760a", "dark": "#d9a441" },
    "--defter-token-warning-soft": { "purpose": "defter-style fill: warning-soft", "light": "#fbedcf", "dark": "#3d2f14" },
    "--defter-token-danger": { "purpose": "defter-style fill/text: danger", "light": "#c02636", "dark": "#f06a78" },
    "--defter-token-danger-soft": { "purpose": "defter-style fill: danger-soft", "light": "#fadadd", "dark": "#3d1a20" },
    "--defter-token-muted": { "purpose": "defter-style fill/text: muted", "light": "#6b7280", "dark": "#9aa1ad" }
  }
}
```
