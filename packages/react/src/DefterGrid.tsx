import {
  type CellValue,
  type ComputedGrid,
  type FormulaEngine,
  type Locale,
  type BorderKind,
  type Model,
  addSheet,
  applyBorders,
  clearStylesIn,
  columnLabel,
  deleteCols,
  deleteRows,
  extractReferences,
  fillDown,
  fillRight,
  fillSeries,
  formatColor,
  formatValue,
  getCell,
  insertCols,
  insertRows,
  isError,
  offsetReferences,
  parse,
  parseLiteral,
  parseRef,
  renameSheet,
  resolveConditionalAttrs,
  resolveStyles,
  resolveValidation,
  serialize,
  setCell,
  setColumnWidth,
  setFreeze,
  setStyle,
  sortRows,
  toNumber,
} from '@defterjs/core'
import type { StyleAttrs } from '@defterjs/core'
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { renderInline } from './inline.js'
import { resolveColor, styleToCss } from './styleToCss.js'

/**
 * A remote peer's live presence, fed from the host's awareness channel. Render it Google-Sheets
 * style: a coloured outline + name flag on the peer's selection, but only while they're on the
 * currently-viewed sheet.
 */
export interface Collaborator {
  /** Stable per-peer id (used as the React key). */
  id: string
  /** Display name shown on the flag over the peer's active cell. */
  name: string
  /** The peer's presence colour (any CSS colour). The only colour not driven by `--defter-*` tokens. */
  color: string
  /** Which sheet the peer is on; their cursor renders only when it matches the viewed sheet. */
  sheetIndex: number
  /** The peer's selection as A1 (`B3`) or an A1 range (`A1:B4`). */
  selection: string
}

/** The local selection, as handed to `onSelectionChange` for the host to broadcast over awareness. */
export interface SelectionState {
  sheetIndex: number
  /** A1 for a single cell (`B3`), or an A1 range (`A1:B4`) for a multi-cell selection. */
  selection: string
}

export interface DefterGridProps {
  /** Canonical Defter text. The grid is a projection of it. */
  text: string
  /** Called with new canonical text when the user edits. Omit for a read-only grid. */
  onChange?: (text: string) => void
  /** Injected formula engine. Without it, formula cells show their source. */
  engine?: FormulaEngine
  /** Built-in theme, or any custom `data-defter-theme` value the host defines in CSS. */
  theme?: 'light' | 'dark' | 'paper' | (string & {})
  /** Initial active sheet. Sheet switching is managed internally; observe it via `onSheetChange`. */
  sheetIndex?: number
  /** Fired with the active sheet index whenever it changes (e.g. so a host can scope a CSV export). */
  onSheetChange?: (index: number) => void
  locale?: Locale
  showFormulas?: boolean
  /** Show the formula/content bar above the grid. */
  formulaBar?: boolean
  /** Show the selection status bar (sum/avg/count) below the grid. */
  statusBar?: boolean
  /** Show sheet tabs. Defaults to on when the document has more than one sheet. */
  sheetTabs?: boolean
  /** Show the formatting toolbar (bold/align/fill/number-format) above the grid. */
  toolbar?: boolean
  /**
   * Keep the header row (A1 row 1) pinned while scrolling. **Fallback only:** when the document
   * declares its own `freeze` (via the `defter-style` block / the freeze context-menu), that wins
   * and this prop is ignored. Use it for a purely runtime freeze on documents that carry none.
   */
  freezeHeader?: boolean
  /** Keep the first column (A) pinned while scrolling. Fallback only — see {@link DefterGridProps.freezeHeader}. */
  freezeCol?: boolean
  /** Render only the visible rows (windowing) for large sheets. Assumes a fixed row height. */
  virtualize?: boolean
  /** Fixed row height in px used by virtualization; must match `--defter-row-height` (default 26). */
  rowHeight?: number
  /** Function names for formula autocomplete (e.g. `FUNCTION_NAMES` from `@defterjs/formula`). */
  functions?: string[]
  extraRows?: number
  extraCols?: number
  readOnly?: boolean
  /**
   * Remote peers to render as live cursors/selections (from the host's awareness channel). Each
   * peer shows a coloured outline + name flag over `selection`, but only while `sheetIndex` matches
   * the viewed sheet. Purely presentational — never touches the local selection, edit, or clipboard.
   */
  collaborators?: Collaborator[]
  /**
   * Fired (throttled) with the local selection whenever it changes, so the host can broadcast it
   * over awareness. `selection` is A1 (`B3`) or an A1 range (`A1:B4`).
   */
  onSelectionChange?: (sel: SelectionState) => void
  /**
   * Collaborative undo override. Pass a `Y.UndoManager`-backed handler (see `useYUndo` in
   * `@defterjs/yjs`) and the grid drives it for Ctrl/Cmd+Z and the toolbar undo button instead of
   * its built-in text history — so undo reverts only the local user's edits under a shared `Y.Text`.
   * Omit both `undo`/`redo` to keep the built-in local text-history undo.
   */
  undo?: () => void
  /** Collaborative redo override; see {@link DefterGridProps.undo}. */
  redo?: () => void
  /** When an `undo` override is supplied, disables the toolbar undo button while nothing can be undone. */
  canUndo?: boolean
  /** When a `redo` override is supplied, disables the toolbar redo button while nothing can be redone. */
  canRedo?: boolean
  className?: string
  style?: CSSProperties
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A selection rect → A1: a single cell (`B3`) or a range (`A1:B4`). Rows are 1-based A1 numbers. */
function rectToA1(r: { minCol: number; maxCol: number; minRow: number; maxRow: number }): string {
  const tl = `${columnLabel(r.minCol)}${r.minRow}`
  if (r.minCol === r.maxCol && r.minRow === r.maxRow) return tl
  return `${tl}:${columnLabel(r.maxCol)}${r.maxRow}`
}

/** Parse an A1 cell or range (`B3` / `A1:B4`) into a normalized selection rect; null if malformed. */
function a1ToRect(a1: string): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
  try {
    const [start, end] = a1.split(':')
    const s = parseRef(start!.trim())
    const e = end ? parseRef(end.trim()) : s
    return {
      minCol: Math.min(s.col, e.col),
      maxCol: Math.max(s.col, e.col),
      minRow: Math.min(s.row, e.row),
      maxRow: Math.max(s.row, e.row),
    }
  } catch {
    return null
  }
}

/**
 * Increase/decrease the decimal places of a number format, preserving prefix/suffix (currency, %),
 * grouping, and every `;` section — only the digit-skeleton's fractional part changes.
 */
function adjustDecimals(format: string | undefined, delta: number): string {
  const base = format || '#,##0'
  return base.replace(/[#0][#0,]*(?:\.[0#]+)?/g, (skel) => {
    const dot = skel.indexOf('.')
    const intPart = dot >= 0 ? skel.slice(0, dot) : skel
    const cur = dot >= 0 ? (skel.slice(dot + 1).match(/0/g) || []).length : 0
    const dec = Math.max(0, Math.min(9, cur + delta))
    return dec > 0 ? `${intPart}.${'0'.repeat(dec)}` : intPart
  })
}

/** Distinct hues for live formula-reference highlighting (cycled per distinct referenced range). */
const REF_COLORS = ['#2f6df6', '#e0115f', '#1a7f47', '#b0560a', '#7c3aed', '#0e9aa7', '#c026d3', '#ca8a04']

/** Number-format presets for the toolbar picker (value stored on the cell, label shown as a sample). */
const NUMBER_FORMATS: { value: string; label: string; name: string }[] = [
  { value: '', label: '123', name: 'Plain' },
  { value: '#,##0', label: '1,234', name: 'Number' },
  { value: '#,##0.00', label: '1,234.00', name: 'Number (2dp)' },
  { value: '$#,##0.00', label: '$1,234.00', name: 'Currency' },
  { value: '0%', label: '0%', name: 'Percent' },
  { value: '0.00%', label: '0.00%', name: 'Percent (2dp)' },
]

function Icon({ name }: { name: string }): React.JSX.Element {
  const c = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'align-left':
      return (
        <svg {...c}>
          <path d="M4 6h16M4 12h10M4 18h13" />
        </svg>
      )
    case 'align-center':
      return (
        <svg {...c}>
          <path d="M4 6h16M7 12h10M6 18h12" />
        </svg>
      )
    case 'align-right':
      return (
        <svg {...c}>
          <path d="M4 6h16M10 12h10M7 18h13" />
        </svg>
      )
    case 'fill':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M6 4l9 9-6 6a2 2 0 01-3 0l-3-3a2 2 0 010-3z" />
          <path d="M6 4l-1-1" />
          <path d="M19 15s2 2.5 2 4a2 2 0 11-4 0c0-1.5 2-4 2-4z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'text-color':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M6 16L10 6l4 10M7.5 12.5h5" />
        </svg>
      )
    case 'borders':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <path d="M3 12h18M12 3v18" opacity="0.55" />
        </svg>
      )
    case 'border-all':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M3 12h18M12 3v18" />
        </svg>
      )
    case 'border-inner':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M3 12h18M12 3v18" />
        </svg>
      )
    case 'border-inner-h':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M3 12h18" />
        </svg>
      )
    case 'border-inner-v':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M12 3v18" />
        </svg>
      )
    case 'border-outer':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" />
        </svg>
      )
    case 'border-left':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M3 3v18" />
        </svg>
      )
    case 'border-top':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M3 3h18" />
        </svg>
      )
    case 'border-right':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M21 3v18" />
        </svg>
      )
    case 'border-bottom':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M3 21h18" />
        </svg>
      )
    case 'border-clear':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1" opacity="0.3" />
          <path d="M8 8l8 8M16 8l-8 8" opacity="0.7" />
        </svg>
      )
    case 'wrap':
      return (
        <svg {...c}>
          <path d="M4 6h16M4 12h12a3 3 0 010 6h-4m0 0l2-2m-2 2l2 2M4 18h4" />
        </svg>
      )
    case 'merge':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="6" width="18" height="12" rx="1" />
          <path d="M12 6v12M8 12h8m0 0l-2-2m2 2l-2 2M8 12l2-2m-2 2l2 2" opacity="0.7" />
        </svg>
      )
    case 'undo':
      return (
        <svg {...c}>
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 016 6v1" />
        </svg>
      )
    case 'redo':
      return (
        <svg {...c}>
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 00-6 6v1" />
        </svg>
      )
    case 'painter':
      return (
        <svg {...c} strokeWidth={1.7}>
          <rect x="4" y="3" width="14" height="6" rx="1" />
          <path d="M18 6h2v4h-8v3" />
          <rect x="10" y="13" width="4" height="7" rx="1" />
        </svg>
      )
    case 'clear':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M8 5h9l-1 9H9z" />
          <path d="M6 19h12" />
          <path d="M11 8l3 3m0-3l-3 3" opacity="0.6" />
        </svg>
      )
    case 'sigma':
      return (
        <svg {...c} strokeWidth={1.9}>
          <path d="M17 5H7l6 7-6 7h10" />
        </svg>
      )
    default:
      return <svg {...c} />
  }
}

interface Pos {
  col: number
  row: number
}
interface Rect {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

export function DefterGrid(props: DefterGridProps): React.JSX.Element {
  const {
    text,
    onChange,
    engine,
    theme = 'light',
    sheetIndex = 0,
    locale,
    showFormulas = false,
    formulaBar = false,
    statusBar = false,
    sheetTabs,
    toolbar = false,
    freezeHeader = false,
    freezeCol = false,
    virtualize = false,
    rowHeight = 26,
    functions,
    extraRows = 6,

    extraCols = 3,
    readOnly = false,
  } = props

  const model = useMemo<Model>(() => parse(text), [text])
  const computed = useMemo<ComputedGrid | null>(() => (engine ? engine.compute(model) : null), [engine, model])
  const [activeSheet, setActiveSheet] = useState(sheetIndex)
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null)
  const si = model.sheets[activeSheet] ? activeSheet : 0
  const sheet = model.sheets[si]!
  const onSheetChange = props.onSheetChange
  useEffect(() => {
    onSheetChange?.(si)
  }, [si, onSheetChange])
  const styles = useMemo(() => resolveStyles(sheet), [sheet])

  // Frozen panes. The document's `freeze` (parsed from the defter-style block) is the source of
  // truth so it travels on export/sync; the freezeHeader/freezeCol props are a fallback for
  // documents that declare none. Rows are A1 1..freezeRows (row 1 = header); cols are 0..freezeCols-1.
  const docFreeze = sheet.freeze
  const freezeRows = docFreeze ? docFreeze.rows : freezeHeader ? 1 : 0
  const freezeCols = docFreeze ? docFreeze.cols : freezeCol ? 1 : 0

  const totalRows = sheet.grid.length + extraRows
  const totalCols = sheet.width + extraCols
  const editable = Boolean(onChange) && !readOnly
  const OVERSCAN = 8

  const [sel, setSel] = useState<{ anchor: Pos; focus: Pos }>({
    anchor: { col: 0, row: 2 },
    focus: { col: 0, row: 2 },
  })
  const [editing, setEditing] = useState<{ col: number; row: number; value: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const autoScrollRaf = useRef(0)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const copyMarqueeRef = useRef<HTMLDivElement>(null)
  // A focused, editable element is required for the browser to fire copy/cut/paste (a plain focused
  // div with user-select:none never does — esp. Safari). Keyboard focus lives on this hidden
  // textarea; it captures nav keys and clipboard events reliably across browsers.
  const keyCatcherRef = useRef<HTMLTextAreaElement>(null)
  const focusGrid = useCallback(() => keyCatcherRef.current?.focus({ preventScroll: true }), [])
  const [copyRect, setCopyRect] = useState<Rect | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  // Internal clipboard: preserves raw cells (incl. formulas) so an in-app paste keeps formulas and
  // shifts their relative refs by the paste offset. `tsv` fingerprints our own copy so we can tell
  // an internal paste from one pasted in from another app (which only gives us plain text).
  const clip = useRef<{ cells: string[][]; tsv: string; origin: { col: number; row: number }; cut: boolean } | null>(null)
  // `colHead`/`rowHead` carry the 0-based col / 1-based row when the menu was opened on a header,
  // so the freeze items ("Freeze up to this column/row") can target it.
  const [menu, setMenu] = useState<{ x: number; y: number; colHead?: number; rowHead?: number } | null>(null)
  const [localW, setLocalW] = useState<Record<number, number>>({})
  const resizeRef = useRef<{ col: number; startX: number; startW: number } | null>(null)
  const DEFAULT_COL_W = 110
  const HEAD_W = 44 // matches --defter-head-width
  const colWidth = useCallback(
    (c: number) => localW[c] ?? styles.attrs(c, 1).width ?? DEFAULT_COL_W,
    [localW, styles],
  )
  // Sticky-left offset of a frozen column: the row-header gutter plus the widths of the columns
  // pinned before it (columns are variable-width, unlike the fixed row height used for frozen rows).
  const frozenColLeft = useCallback(
    (c: number) => {
      let x = HEAD_W
      for (let i = 0; i < c; i++) x += colWidth(i)
      return x
    },
    [colWidth],
  )

  // History: all mutations route through pushEdit so undo/redo works. This is the built-in *local
  // text* history; a collaborative host passes `undo`/`redo` overrides (a Yjs UndoManager via
  // `@defterjs/yjs`'s `useYUndo`) so undo reverts only the local user's edits under a shared
  // `Y.Text`. When an override is present the built-in stack is bypassed entirely.
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const collabUndo = props.undo
  const collabRedo = props.redo
  const pushEdit = useCallback(
    (next: string) => {
      if (!onChange || next === text) return
      if (!collabUndo) {
        undoStack.current.push(text)
        if (undoStack.current.length > 300) undoStack.current.shift()
        redoStack.current = []
      }
      onChange(next)
    },
    [text, onChange, collabUndo],
  )
  const internalUndo = useCallback(() => {
    if (!onChange || undoStack.current.length === 0) return
    const prev = undoStack.current.pop()!
    redoStack.current.push(text)
    onChange(prev)
  }, [text, onChange])
  const internalRedo = useCallback(() => {
    if (!onChange || redoStack.current.length === 0) return
    const nxt = redoStack.current.pop()!
    undoStack.current.push(text)
    onChange(nxt)
  }, [text, onChange])
  // Collaborative override (Yjs UndoManager) wins when supplied; else the built-in text history.
  const undo = collabUndo ?? internalUndo
  const redo = collabRedo ?? internalRedo
  const undoDisabled = collabUndo ? props.canUndo === false : false
  const redoDisabled = collabRedo ? props.canRedo === false : false

  const [vp, setVp] = useState({ top: 0, height: 0 })
  useEffect(() => {
    if (virtualize && rootRef.current) setVp((v) => ({ ...v, height: rootRef.current!.clientHeight }))
  }, [virtualize])

  // Visible row window (1-based, inclusive). Without virtualize this is the full range → no spacers.
  let winStart = 1
  let winEnd = totalRows
  if (virtualize && vp.height > 0) {
    const visible = Math.ceil(vp.height / rowHeight)
    winStart = Math.max(1, Math.floor(vp.top / rowHeight) + 1 - OVERSCAN)
    winEnd = Math.min(totalRows, winStart + visible + OVERSCAN * 2)
  }
  // Under virtualization, force-render the frozen rows (1..freezeRows) even when scrolled past them.
  const frozenTopRows =
    virtualize && freezeRows > 0 && winStart > 1
      ? Array.from({ length: Math.min(freezeRows, winStart - 1) }, (_, k) => k + 1)
      : []
  const padTop = (winStart - 1 - frozenTopRows.length) * rowHeight
  const padBottom = (totalRows - winEnd) * rowHeight

  const rect: Rect = useMemo(() => {
    const { anchor, focus } = sel
    return {
      minCol: Math.min(anchor.col, focus.col),
      maxCol: Math.max(anchor.col, focus.col),
      minRow: Math.min(anchor.row, focus.row),
      maxRow: Math.max(anchor.row, focus.row),
    }
  }, [sel])

  // Live formula references: while editing a `=`-formula, each distinct referenced range gets a hue,
  // shown as a coloured outline on the grid (and matching token colours in the editor).
  const editingRefs = useMemo(() => {
    if (!editing || !editing.value.trim().startsWith('=')) return []
    const colors = new Map<string, string>()
    const byKey = new Map<string, { rect: Rect; color: string }>()
    for (const ref of extractReferences(editing.value)) {
      if (ref.range.sheet && ref.range.sheet.toLowerCase() !== sheet.name.toLowerCase()) continue
      const r = {
        minCol: Math.min(ref.range.start.col, ref.range.end.col),
        maxCol: Math.max(ref.range.start.col, ref.range.end.col),
        minRow: Math.min(ref.range.start.row, ref.range.end.row),
        maxRow: Math.max(ref.range.start.row, ref.range.end.row),
      }
      const key = `${r.minCol},${r.minRow},${r.maxCol},${r.maxRow}`
      let color = colors.get(key)
      if (!color) {
        color = REF_COLORS[colors.size % REF_COLORS.length]!
        colors.set(key, color)
      }
      byKey.set(key, { rect: r, color })
    }
    return [...byKey.values()]
  }, [editing, sheet.name])

  // Broadcast the local selection to the host (for its awareness channel), throttled. `si` is
  // folded in so a sheet switch re-broadcasts. The A1 string is a single cell or a range.
  const onSelectionChange = props.onSelectionChange
  const selChangeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!onSelectionChange) return
    if (selChangeTimer.current) clearTimeout(selChangeTimer.current)
    selChangeTimer.current = setTimeout(() => {
      onSelectionChange({ sheetIndex: si, selection: rectToA1(rect) })
    }, 60)
    return () => {
      if (selChangeTimer.current) clearTimeout(selChangeTimer.current)
    }
  }, [rect, si, onSelectionChange])

  // Remote peers on the currently-viewed sheet, resolved to grid rects for the overlay layer.
  const collabRects = useMemo(() => {
    const list = props.collaborators
    if (!list?.length) return []
    return list
      .filter((c) => c.sheetIndex === si && c.selection)
      .map((c) => ({ collab: c, r: a1ToRect(c.selection) }))
      .filter((x): x is { collab: Collaborator; r: Rect } => x.r !== null)
  }, [props.collaborators, si])

  // Position an overlay box (selection marquee, copy marching-ants) over a cell range from the corner
  // cells' geometry — so merges/freeze/widths all work and it scrolls locked to the content.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const place = (el: HTMLDivElement | null, r: Rect | null, show: boolean) => {
      if (!el) return
      const a = r && root.querySelector(`td[data-col="${r.minCol}"][data-row="${r.minRow}"]`)
      const b = r && root.querySelector(`td[data-col="${r.maxCol}"][data-row="${r.maxRow}"]`)
      if (!show || !a || !b) {
        el.style.display = 'none'
        return
      }
      const cr = root.getBoundingClientRect()
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      el.style.display = 'block'
      el.style.left = `${ar.left - cr.left + root.scrollLeft}px`
      el.style.top = `${ar.top - cr.top + root.scrollTop}px`
      el.style.width = `${br.right - ar.left}px`
      el.style.height = `${br.bottom - ar.top}px`
    }
    const single = rect.minCol === rect.maxCol && rect.minRow === rect.maxRow
    place(marqueeRef.current, rect, !single && editing === null)
    place(copyMarqueeRef.current, copyRect, copyRect !== null)
    // Remote presence: each peer's overlay carries its rect in data-* attrs (set at render). Position
    // them off the same corner-cell geometry; a peer whose cells aren't rendered (virtualized out)
    // simply hides. Purely presentational — never touches the local selection.
    root.querySelectorAll<HTMLDivElement>('.defter__collab').forEach((el) => {
      place(
        el,
        {
          minCol: Number(el.dataset.minCol),
          maxCol: Number(el.dataset.maxCol),
          minRow: Number(el.dataset.minRow),
          maxRow: Number(el.dataset.maxRow),
        },
        true,
      )
    })
    root.querySelectorAll<HTMLDivElement>('.defter__fref').forEach((el) => {
      place(
        el,
        {
          minCol: Number(el.dataset.mincol),
          maxCol: Number(el.dataset.maxcol),
          minRow: Number(el.dataset.minrow),
          maxRow: Number(el.dataset.maxrow),
        },
        true,
      )
    })
  })

  // Themed tooltips: drive off existing `title` attributes via delegation — suppress the native
  // tooltip on hover (stash/restore the title, so it stays available for focus/screen readers).
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: HTMLElement | null = null
    const restore = (el: HTMLElement) => {
      const t = el.getAttribute('data-tip')
      if (t !== null) {
        el.setAttribute('title', t)
        el.removeAttribute('data-tip')
      }
    }
    const clear = () => {
      if (timer) clearTimeout(timer)
      if (current) restore(current)
      current = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title]')
      if (!el || el === current) return
      if (current) clear()
      const title = el.getAttribute('title') ?? ''
      if (!title) return
      el.setAttribute('data-tip', title)
      el.removeAttribute('title') // suppress the native OS tooltip
      current = el
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect()
        const sr = shell.getBoundingClientRect()
        setTip({ text: title, x: r.left - sr.left + r.width / 2, y: r.bottom - sr.top + 6 })
      }, 380)
    }
    const out = (e: MouseEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) clear()
    }
    shell.addEventListener('mouseover', over)
    shell.addEventListener('mouseout', out)
    return () => {
      shell.removeEventListener('mouseover', over)
      shell.removeEventListener('mouseout', out)
      clear()
    }
  }, [])

  const wasEditing = useRef(false)
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      wasEditing.current = true
    } else if (wasEditing.current) {
      focusGrid() // return keyboard/clipboard focus to the grid when an edit ends
      wasEditing.current = false
    }
  }, [editing, focusGrid])

  const fillDragging = useRef(false)
  const fillTargetRef = useRef<Pos | null>(null)
  useEffect(() => {
    const up = () => {
      if (fillDragging.current) {
        fillDragging.current = false
        const t = fillTargetRef.current
        fillTargetRef.current = null
        if (t && (t.row > rect.maxRow || t.col > rect.maxCol)) {
          pushEdit(serialize(fillSeries(model, si, rect.minCol, rect.minRow, rect.maxCol, rect.maxRow, t.col, t.row)))
        }
      }
      dragging.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [rect, model, si, pushEdit])

  // Column resize (drag the header's right edge); commit persists into the style layer.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const w = Math.max(48, r.startW + (e.clientX - r.startX))
      setLocalW((prev) => ({ ...prev, [r.col]: w }))
    }
    const up = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const w = Math.max(48, Math.round(r.startW + (e.clientX - r.startX)))
      resizeRef.current = null
      pushEdit(serialize(setColumnWidth(model, si, r.col, w)))
      setLocalW((prev) => {
        const n = { ...prev }
        delete n[r.col]
        return n
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [model, pushEdit, si])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const applyModel = useCallback(
    (m: Model) => {
      pushEdit(serialize(m))
      setMenu(null)
    },
    [pushEdit],
  )
  // Toggle frozen panes on the active sheet as a minimal canonical-text edit, so the freeze travels
  // with the document (onChange → the host persists/syncs it). Both axes 0 removes the freeze line.
  const applyFreeze = useCallback(
    (opts: { rows?: number; cols?: number }) => {
      pushEdit(setFreeze(text, opts, si))
      setMenu(null)
    },
    [text, si, pushEdit],
  )

  const rawAt = useCallback((col: number, row: number) => getCell(sheet, col, row), [sheet])

  const valueAt = useCallback(
    (col: number, row: number): CellValue => {
      const raw = rawAt(col, row)
      if (raw.trim().startsWith('=')) return computed ? computed.get(sheet.name, col, row) : raw
      return parseLiteral(raw, locale)
    },
    [rawAt, computed, sheet.name, locale],
  )

  const applyStyle = useCallback(
    (attrs: StyleAttrs) => {
      const range = {
        start: { col: rect.minCol, row: rect.minRow, colAbs: false, rowAbs: false },
        end: { col: rect.maxCol, row: rect.maxRow, colAbs: false, rowAbs: false },
        sheet: undefined,
      }
      pushEdit(serialize(setStyle(model, si, { kind: 'range', range }, attrs)))
    },
    [model, pushEdit, si, rect],
  )
  const clearFormatting = useCallback(() => {
    pushEdit(serialize(clearStylesIn(model, si, rect.minCol, rect.minRow, rect.maxCol, rect.maxRow)))
  }, [model, pushEdit, si, rect])
  const applyBorderKind = useCallback(
    (kind: BorderKind) => {
      pushEdit(serialize(applyBorders(model, si, rect, kind)))
    },
    [model, si, rect, pushEdit],
  )

  const autoSum = useCallback(() => {
    const { col, row } = sel.focus
    const end = row - 1
    if (end < 2) return
    let start = end
    while (start > 2 && typeof parseLiteral(getCell(sheet, col, start - 1), locale) === 'number') start--
    const c = columnLabel(col)
    pushEdit(serialize(setCell(model, si, col, row, `=SUM(${c}${start}:${c}${end})`)))
    setSel({ anchor: { col, row }, focus: { col, row } })
  }, [sel.focus, sheet, locale, model, si, pushEdit])

  const commit = useCallback(
    (col: number, row: number, value: string, move?: Pos) => {
      pushEdit(serialize(setCell(model, si, col, row, value)))
      setEditing(null)
      if (move) setSel({ anchor: move, focus: move })
      focusGrid()
    },
    [model, pushEdit, si],
  )

  const commitMany = useCallback(
    (writes: { col: number; row: number; value: string }[]) => {
      if (writes.length === 0) return
      let m = model
      for (const w of writes) m = setCell(m, si, w.col, w.row, w.value)
      pushEdit(serialize(m))
    },
    [model, pushEdit, si],
  )

  const beginEdit = useCallback(
    (col: number, row: number, initial?: string) => {
      if (!editable) return
      setEditing({ col, row, value: initial ?? rawAt(col, row) })
      setCopyRect(null)
    },
    [editable, rawAt],
  )

  const clampCol = (c: number) => Math.max(0, Math.min(totalCols - 1, c))
  const clampRow = (r: number) => Math.max(1, Math.min(totalRows, r))

  const moveFocus = useCallback(
    (dcol: number, drow: number, extend: boolean) => {
      setSel((s) => {
        const focus = { col: clampCol(s.focus.col + dcol), row: clampRow(s.focus.row + drow) }
        return { anchor: extend ? s.anchor : focus, focus }
      })
    },
    [totalCols, totalRows],
  )

  // Ctrl+Arrow: jump to the edge of the current data block (Sheets behaviour).
  const jump = useCallback(
    (dc: number, dr: number, extend: boolean) => {
      const dataRows = sheet.grid.length
      const dataCols = sheet.width
      const isEmpty = (c: number, r: number) => getCell(sheet, c, r).trim() === ''
      const inB = (c: number, r: number) => c >= 0 && c < dataCols && r >= 1 && r <= dataRows
      let { col: c, row: r } = sel.focus
      if (inB(c, r)) {
        if (!isEmpty(c, r) && inB(c + dc, r + dr) && !isEmpty(c + dc, r + dr)) {
          while (inB(c + dc, r + dr) && !isEmpty(c + dc, r + dr)) {
            c += dc
            r += dr
          }
        } else {
          c += dc
          r += dr
          while (inB(c, r) && isEmpty(c, r)) {
            c += dc
            r += dr
          }
          if (!inB(c, r)) {
            c -= dc
            r -= dr
          }
        }
      } else {
        c += dc
        r += dr
      }
      const p = { col: clampCol(c), row: clampRow(r) }
      setSel((s) => ({ anchor: extend ? s.anchor : p, focus: p }))
    },
    [sheet, sel.focus, totalCols, totalRows],
  )

  // Build the selection's tab-separated text, stash the raw cells for an in-app paste, and light the
  // marching-ants marquee. Returns the TSV so both the clipboard event and the keydown fallback share it.
  const buildClipboard = useCallback(
    (cut: boolean): string => {
      const raws: string[][] = []
      const valLines: string[] = []
      for (let r = rect.minRow; r <= rect.maxRow; r++) {
        const rawRow: string[] = []
        const valRow: string[] = []
        for (let c = rect.minCol; c <= rect.maxCol; c++) {
          const raw = rawAt(c, r)
          rawRow.push(raw)
          valRow.push(raw.trim().startsWith('=') ? formatValue(valueAt(c, r), { locale }) : raw)
        }
        raws.push(rawRow)
        valLines.push(valRow.join('\t'))
      }
      const tsv = valLines.join('\n')
      clip.current = { cells: raws, tsv, origin: { col: rect.minCol, row: rect.minRow }, cut }
      setCopyRect({ ...rect })
      return tsv
    },
    [rect, rawAt, valueAt, locale],
  )

  // Apply pasted plain text at the anchor. Shared by the paste event and the async-clipboard fallback.
  const pasteViaEvent = useRef(false)
  const applyPaste = useCallback(
    (data: string) => {
      if (!editable || !data) return
      setCopyRect(null) // paste consumes the marching-ants marquee
      const writes: { col: number; row: number; value: string }[] = []
      const buf = clip.current
      // Internal paste (our own copy, unchanged): keep raw cells and shift relative refs by the offset.
      if (buf && buf.tsv === data.replace(/\r/g, '').replace(/\n$/, '')) {
        const dCol = rect.minCol - buf.origin.col
        const dRow = rect.minRow - buf.origin.row
        const target = new Set<string>()
        buf.cells.forEach((row, dr) => {
          row.forEach((raw, dc) => {
            const col = rect.minCol + dc
            const r = rect.minRow + dr
            target.add(`${col},${r}`)
            writes.push({ col, row: r, value: raw.trim().startsWith('=') ? offsetReferences(raw, dCol, dRow) : raw })
          })
        })
        if (buf.cut) {
          for (let dr = 0; dr < buf.cells.length; dr++)
            for (let dc = 0; dc < buf.cells[0]!.length; dc++) {
              const col = buf.origin.col + dc
              const r = buf.origin.row + dr
              if (!target.has(`${col},${r}`)) writes.push({ col, row: r, value: '' })
            }
          clip.current = null
        }
        commitMany(writes)
        return
      }
      // External paste: split TSV/newlines into a literal grid at the anchor.
      const rows = data.replace(/\r/g, '').replace(/\n$/, '').split('\n')
      rows.forEach((line, dr) => {
        line.split('\t').forEach((cell, dc) => {
          writes.push({ col: rect.minCol + dc, row: rect.minRow + dr, value: cell })
        })
      })
      commitMany(writes)
    },
    [editable, rect, commitMany],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (editing) return
      if (e.key === 'Escape' && copyRect) {
        setCopyRect(null)
        e.preventDefault()
        return
      }
      // Copy/cut: also mirror the selection into the (selected) keycatcher so the OS's *native* copy
      // grabs it even on browsers that won't fire the copy event on a hidden field (iOS Safari).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[cxCX]$/.test(e.key)) {
        const cut = e.key === 'x' || e.key === 'X'
        if (cut && !editable) return
        const tsv = buildClipboard(cut)
        const ta = keyCatcherRef.current
        if (ta) {
          ta.value = tsv
          ta.select()
        }
        return // do NOT preventDefault — let the native copy/cut of the selected text proceed
      }
      // Paste: the paste event doesn't reliably deliver data on iOS, so also read via the async
      // Clipboard API from this keydown gesture. A flag prevents a double-apply on desktop.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[vV]$/.test(e.key) && editable) {
        pasteViaEvent.current = false
        const ta = keyCatcherRef.current
        if (ta) ta.value = ''
        // Defer, so on desktop the paste event handles it first (no clipboard-read prompt); only if
        // it didn't (iOS: event brings no data) do we fall back to the async Clipboard API.
        setTimeout(() => {
          if (pasteViaEvent.current) return
          navigator.clipboard
            ?.readText?.()
            .then((text) => text && applyPaste(text))
            .catch(() => {})
        }, 50)
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) redo()
        else undo()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        redo()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        setFinder({ query: '', replace: '', replaceMode: false })
        setMatchIdx(0)
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H') && editable) {
        setFinder({ query: '', replace: '', replaceMode: true })
        setMatchIdx(0)
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && editable) {
        const k = e.key.toLowerCase()
        if (k === 'b') {
          applyStyle({ bold: !styles.attrs(sel.focus.col, sel.focus.row).bold })
          e.preventDefault()
          return
        }
        if (k === 'i') {
          applyStyle({ italic: !styles.attrs(sel.focus.col, sel.focus.row).italic })
          e.preventDefault()
          return
        }
        if (k === 'u') {
          applyStyle({ underline: !styles.attrs(sel.focus.col, sel.focus.row).underline })
          e.preventDefault()
          return
        }
        if (k === 'd') {
          pushEdit(serialize(fillDown(model, si, rect.minCol, rect.maxCol, rect.minRow, rect.maxRow)))
          e.preventDefault()
          return
        }
        if (k === 'r') {
          pushEdit(serialize(fillRight(model, si, rect.minCol, rect.maxCol, rect.minRow, rect.maxRow)))
          e.preventDefault()
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        setSel({ anchor: { col: 0, row: 1 }, focus: { col: totalCols - 1, row: totalRows } })
        e.preventDefault()
        return
      }
      const { col, row } = sel.focus
      const shift = e.shiftKey
      const mod = e.ctrlKey || e.metaKey
      const lastCol = Math.max(0, sheet.width - 1)
      const lastRow = Math.max(1, sheet.grid.length)
      switch (e.key) {
        case 'ArrowUp':
          mod ? jump(0, -1, shift) : moveFocus(0, -1, shift)
          e.preventDefault()
          break
        case 'ArrowDown':
          mod ? jump(0, 1, shift) : moveFocus(0, 1, shift)
          e.preventDefault()
          break
        case 'Enter':
          moveFocus(0, 1, false)
          e.preventDefault()
          break
        case 'ArrowLeft':
          mod ? jump(-1, 0, shift) : moveFocus(-1, 0, shift)
          e.preventDefault()
          break
        case 'ArrowRight':
          mod ? jump(1, 0, shift) : moveFocus(1, 0, shift)
          e.preventDefault()
          break
        case 'Tab':
          moveFocus(1, 0, false)
          e.preventDefault()
          break
        case 'Home': {
          const p = mod ? { col: 0, row: 1 } : { col: 0, row }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'End': {
          const p = mod ? { col: lastCol, row: lastRow } : { col: lastCol, row }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'PageDown': {
          const p = { col, row: clampRow(row + 20) }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'PageUp': {
          const p = { col, row: clampRow(row - 20) }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'Backspace':
        case 'Delete': {
          if (editable) {
            const writes = []
            for (let r = rect.minRow; r <= rect.maxRow; r++)
              for (let c = rect.minCol; c <= rect.maxCol; c++)
                if (rawAt(c, r) !== '') writes.push({ col: c, row: r, value: '' })
            commitMany(writes)
          }
          e.preventDefault()
          break
        }
        case 'F2':
          beginEdit(col, row)
          e.preventDefault()
          break
        default:
          if (editable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            beginEdit(col, row, e.key)
            e.preventDefault()
          }
      }
    },
    [
      editing,
      sel.focus,
      moveFocus,
      rect,
      rawAt,
      commitMany,
      editable,
      beginEdit,
      undo,
      redo,
      applyStyle,
      styles,
      model,
      pushEdit,
      si,
      totalCols,
      totalRows,
      jump,
      sheet,
      copyRect,
      buildClipboard,
      applyPaste,
    ],
  )

  const writeClipboard = useCallback(
    (e: React.ClipboardEvent, cut: boolean) => {
      e.clipboardData.setData('text/plain', buildClipboard(cut))
      e.preventDefault()
    },
    [buildClipboard],
  )
  const onCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing) return
      writeClipboard(e, false)
    },
    [editing, writeClipboard],
  )
  const onCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing || !editable) return
      writeClipboard(e, true)
    },
    [editing, editable, writeClipboard],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing || !editable) return
      const data = e.clipboardData.getData('text/plain')
      if (!data) return
      pasteViaEvent.current = true // tell the keydown/readText fallback the event already handled it
      applyPaste(data)
      e.preventDefault()
    },
    [editing, editable, applyPaste],
  )

  // Map a viewport point to a cell, so a parked-at-the-edge drag keeps extending as content scrolls.
  const colAtX = useCallback(
    (clientX: number) => {
      const root = rootRef.current
      if (!root) return 0
      let x = clientX - root.getBoundingClientRect().left + root.scrollLeft - HEAD_W
      if (x < 0) return 0
      for (let c = 0; c < totalCols; c++) {
        const w = colWidth(c)
        if (x < w) return c
        x -= w
      }
      return totalCols - 1
    },
    [totalCols, colWidth],
  )
  const rowAtY = useCallback(
    (clientY: number) => {
      const root = rootRef.current
      if (!root) return 1
      const r = Math.floor((clientY - root.getBoundingClientRect().top + root.scrollTop) / rowHeight)
      return Math.max(1, Math.min(totalRows, r))
    },
    [rowHeight, totalRows],
  )
  // Auto-scroll the grid while a selection drag is held near an edge (so you can select past the viewport).
  const beginDragAutoScroll = useCallback(() => {
    const root = rootRef.current
    if (!root || autoScrollRaf.current) return
    let px = 0
    let py = 0
    let seen = false
    const move = (ev: MouseEvent) => {
      px = ev.clientX
      py = ev.clientY
      seen = true
    }
    document.addEventListener('mousemove', move)
    const EDGE = 26
    const SPEED = 16
    const tick = () => {
      if (!dragging.current) {
        document.removeEventListener('mousemove', move)
        autoScrollRaf.current = 0
        return
      }
      const el = rootRef.current
      if (el && seen) {
        const box = el.getBoundingClientRect()
        let dx = 0
        let dy = 0
        if (py < box.top + rowHeight + EDGE) dy = -SPEED
        else if (py > box.bottom - EDGE) dy = SPEED
        if (px < box.left + HEAD_W + EDGE) dx = -SPEED
        else if (px > box.right - EDGE) dx = SPEED
        if (dx || dy) {
          el.scrollLeft += dx
          el.scrollTop += dy
          setSel((s) => ({ anchor: s.anchor, focus: { col: colAtX(px), row: rowAtY(py) } }))
        }
      }
      autoScrollRaf.current = requestAnimationFrame(tick)
    }
    autoScrollRaf.current = requestAnimationFrame(tick)
  }, [colAtX, rowAtY, rowHeight])

  const painterRef = useRef<StyleAttrs | null>(null)
  const [painterOn, setPainterOn] = useState(false)
  const onCellMouseDown = useCallback(
    (col: number, row: number, shift: boolean) => {
      focusGrid() // capture the keyboard for THIS grid (critical with >1 grid on a page)
      if (painterRef.current) {
        const attrs = painterRef.current
        painterRef.current = null
        setPainterOn(false)
        setSel({ anchor: { col, row }, focus: { col, row } })
        const range = {
          start: { col, row, colAbs: false, rowAbs: false },
          end: { col, row, colAbs: false, rowAbs: false },
          sheet: undefined,
        }
        pushEdit(serialize(setStyle(model, si, { kind: 'range', range }, attrs)))
        return
      }
      dragging.current = true
      beginDragAutoScroll()
      setSel((s) => (shift ? { anchor: s.anchor, focus: { col, row } } : { anchor: { col, row }, focus: { col, row } }))
    },
    [model, si, pushEdit, beginDragAutoScroll],
  )
  const onCellMouseEnter = useCallback((col: number, row: number) => {
    if (dragging.current) setSel((s) => ({ anchor: s.anchor, focus: { col, row } }))
  }, [])

  // Fill-handle drag tracks the target via a document mousemove (robust across real drags).
  const onFillStart = useCallback(() => {
    fillDragging.current = true
    fillTargetRef.current = null
    const move = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-col][data-row]') as HTMLElement | null
      if (el?.dataset.col !== undefined && el.dataset.row !== undefined) {
        fillTargetRef.current = { col: Number(el.dataset.col), row: Number(el.dataset.row) }
        return
      }
      // Over a virtualization spacer (no data cell): derive the row from geometry.
      const root = rootRef.current
      if (root) {
        const box = root.getBoundingClientRect()
        const row = Math.max(1, Math.floor((ev.clientY - box.top + root.scrollTop) / rowHeight))
        fillTargetRef.current = { col: fillTargetRef.current?.col ?? sel.focus.col, row }
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener(
      'mouseup',
      function done() {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', done)
      },
      { once: true },
    )
  }, [sel.focus.col, rowHeight])

  const stats = useMemo(() => {
    if (rect.minCol === rect.maxCol && rect.minRow === rect.maxRow) return null
    let sum = 0
    let count = 0
    let numCount = 0
    for (let r = rect.minRow; r <= rect.maxRow; r++) {
      for (let c = rect.minCol; c <= rect.maxCol; c++) {
        const raw = rawAt(c, r)
        if (raw.trim() !== '') count++
        const n = toNumber(valueAt(c, r))
        if (n !== null && typeof valueAt(c, r) !== 'string') {
          sum += n
          numCount++
        }
      }
    }
    return { sum, count, numCount, avg: numCount ? sum / numCount : 0 }
  }, [rect, rawAt, valueAt])

  const startResize = useCallback(
    (col: number, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { col, startX: e.clientX, startW: colWidth(col) }
    },
    [colWidth],
  )
  // Auto-fit a column to its widest cell (double-click its right border, like a spreadsheet).
  // A DOM Range over each cell's contents measures the real painted text geometry — exact across
  // bold/fonts and unaffected by the cell's own overflow clip (the text still lays out full-width).
  const autoFitCol = useCallback(
    (col: number) => {
      const root = rootRef.current
      if (!root) return
      const range = document.createRange()
      let max = 0
      root.querySelectorAll<HTMLElement>(`td[data-col="${col}"]`).forEach((el) => {
        if (!el.firstChild) return
        range.selectNodeContents(el)
        // Exclude the fill-handle corner marker so it doesn't inflate the measured content width.
        const handle = el.querySelector(':scope > .defter__fill-handle')
        if (handle) range.setEndBefore(handle)
        const w = range.getBoundingClientRect().width
        if (w > max) max = w
      })
      const width = Math.min(400, Math.max(48, Math.ceil(max) + 16)) // 12px cell padding + 4px slack
      pushEdit(serialize(setColumnWidth(model, si, col, width)))
    },
    [model, si, pushEdit],
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editable) return
      const el = (e.target as HTMLElement).closest('[data-col],[data-row]') as HTMLElement | null
      if (!el) return
      e.preventDefault()
      const c = el.dataset.col !== undefined ? Number(el.dataset.col) : undefined
      const r = el.dataset.row !== undefined ? Number(el.dataset.row) : undefined
      let colHead: number | undefined
      let rowHead: number | undefined
      if (c !== undefined && r !== undefined) {
        const inside = c >= rect.minCol && c <= rect.maxCol && r >= rect.minRow && r <= rect.maxRow
        if (!inside) setSel({ anchor: { col: c, row: r }, focus: { col: c, row: r } })
      } else if (c !== undefined) {
        setSel({ anchor: { col: c, row: 1 }, focus: { col: c, row: totalRows } })
        colHead = c
      } else if (r !== undefined) {
        setSel({ anchor: { col: 0, row: r }, focus: { col: totalCols - 1, row: r } })
        rowHead = r
      }
      setMenu({ x: e.clientX, y: e.clientY, colHead, rowHead })
    },
    [editable, rect, totalRows, totalCols],
  )

  const clearSelection = useCallback(() => {
    const writes = []
    for (let r = rect.minRow; r <= rect.maxRow; r++)
      for (let c = rect.minCol; c <= rect.maxCol; c++)
        if (rawAt(c, r) !== '') writes.push({ col: c, row: r, value: '' })
    commitMany(writes)
    setMenu(null)
  }, [rect, rawAt, commitMany])

  // Find & replace (Ctrl+F / Ctrl+H).
  const [finder, setFinder] = useState<{ query: string; replace: string; replaceMode: boolean } | null>(null)
  const [matchIdx, setMatchIdx] = useState(0)
  const matches = useMemo<Pos[]>(() => {
    if (!finder?.query) return []
    const q = finder.query.toLowerCase()
    const out: Pos[] = []
    for (let r = 0; r < sheet.grid.length; r++) {
      for (let c = 0; c < sheet.width; c++) {
        if ((sheet.grid[r]![c] ?? '').toLowerCase().includes(q)) out.push({ col: c, row: r + 1 })
      }
    }
    return out
  }, [finder?.query, sheet])
  const curMatch = matches.length ? ((matchIdx % matches.length) + matches.length) % matches.length : 0
  useEffect(() => {
    if (finder && matches.length) {
      const m = matches[curMatch]!
      setSel({ anchor: m, focus: m })
      const el = rootRef.current
      if (el) {
        if (virtualize) el.scrollTop = Math.max(0, (m.row - 1) * rowHeight - el.clientHeight / 2)
        else el.querySelector(`[data-col="${m.col}"][data-row="${m.row}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
  }, [curMatch, matches, finder, virtualize, rowHeight])

  const doReplace = useCallback(() => {
    if (!finder || !editable || !matches.length) return
    const m = matches[curMatch]!
    const raw = getCell(sheet, m.col, m.row)
    const next = raw.replace(new RegExp(escapeRegExp(finder.query), 'i'), finder.replace)
    pushEdit(serialize(setCell(model, si, m.col, m.row, next)))
  }, [finder, editable, matches, curMatch, sheet, model, si, pushEdit])
  const doReplaceAll = useCallback(() => {
    if (!finder || !editable) return
    const re = new RegExp(escapeRegExp(finder.query), 'gi')
    commitMany(matches.map((m) => ({ col: m.col, row: m.row, value: getCell(sheet, m.col, m.row).replace(re, finder.replace) })))
  }, [finder, editable, matches, sheet, commitMany])

  const activeAttrs = styles.attrs(sel.focus.col, sel.focus.row)
  const activeRaw = rawAt(sel.focus.col, sel.focus.row)

  const [popover, setPopover] = useState<{ kind: 'fill' | 'text' | 'border' | 'format'; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!popover) return
    const close = () => setPopover(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [popover])
  const openPopover = (kind: 'fill' | 'text' | 'border' | 'format', e: React.MouseEvent) => {
    e.stopPropagation()
    if (popover?.kind === kind) return setPopover(null)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({ kind, x: r.left, y: r.bottom + 4 })
  }

  // Formula bar has its own edit buffer, decoupled from the in-cell editor (so typing there
  // doesn't yank focus into the cell). Resets when the active cell changes.
  const [barValue, setBarValue] = useState<string | null>(null)
  useEffect(() => setBarValue(null), [sel.focus.col, sel.focus.row])

  const renderRow = (row: number) => (
    <tr key={row} role="row" aria-rowindex={row}>
      <th
        data-row={row}
        role="rowheader"
        className={`defter__rowhead${row >= rect.minRow && row <= rect.maxRow ? ' defter__rowhead--active' : ''}${row <= freezeRows ? ' defter__rowhead--frozen' : ''}`}
        style={row <= freezeRows ? { top: row * rowHeight } : undefined}
        onMouseDown={(e) => {
          focusGrid()
          setSel((s) =>
            e.shiftKey
              ? { anchor: s.anchor, focus: { col: totalCols - 1, row } }
              : { anchor: { col: 0, row }, focus: { col: totalCols - 1, row } },
          )
        }}
      >
        {row}
      </th>
      {Array.from({ length: totalCols }, (_, col) => {
        if (styles.isCovered(col, row)) return null
        const span = styles.mergeAnchor(col, row)
        const isFocus = sel.focus.col === col && sel.focus.row === row
        const inSel = col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow
        return (
          <Cell
            key={col}
            col={col}
            row={row}
            sheet={sheet}
            styles={styles}
            computed={computed}
            sheetName={sheet.name}
            locale={locale}
            showFormulas={showFormulas}
            colAlign={sheet.colAlign[col] ?? null}
            focus={isFocus}
            inSelection={inSel && !isFocus}
            frozen={row <= freezeRows}
            frozenTop={row <= freezeRows ? row * rowHeight : undefined}
            frozenCol={col < freezeCols}
            frozenLeft={col < freezeCols ? frozenColLeft(col) : undefined}
            fillHandle={isFocus && editable}
            onFillStart={onFillStart}
            colSpan={span?.colspan}
            rowSpan={span?.rowspan}
            editing={editing?.col === col && editing?.row === row ? editing.value : null}
            inputRef={inputRef}
            functions={functions}
            onMouseDown={(shift) => onCellMouseDown(col, row, shift)}
            onMouseEnter={() => onCellMouseEnter(col, row)}
            onBeginEdit={() => beginEdit(col, row)}
            onEditChange={(v) => setEditing({ col, row, value: v })}
            onCommit={(v, dir) =>
              commit(col, row, v, dir === 'down' ? { col, row: row + 1 } : { col: col + 1, row })
            }
            onCancel={() => setEditing(null)}
          />
        )
      })}
    </tr>
  )

  return (
    <div
      ref={shellRef}
      className={`defter-shell${props.className ? ` ${props.className}` : ''}`}
      data-defter-theme={theme}
      style={props.style}
    >
      {tip && (
        <div className="defter__tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      {toolbar && editable && (
        <div
          className="defter__toolbar"
          data-defter-theme={theme}
          onMouseDown={(e) => {
            // Keep focus in the cell editor / formula bar when clicking a toolbar button, so the
            // style applies to the active cell instead of committing + moving the selection down.
            if ((e.target as HTMLElement).closest('button')) e.preventDefault()
          }}
        >
          <button className="defter__tb" title="Undo (Ctrl+Z)" onClick={undo} disabled={undoDisabled}>
            <Icon name="undo" />
          </button>
          <button className="defter__tb" title="Redo (Ctrl+Y)" onClick={redo} disabled={redoDisabled}>
            <Icon name="redo" />
          </button>
          <button
            className={`defter__tb${painterOn ? ' defter__tb--on' : ''}`}
            title="Paint format — then click a target cell"
            onClick={() => {
              painterRef.current = { ...activeAttrs }
              setPainterOn(true)
            }}
          >
            <Icon name="painter" />
          </button>
          <span className="defter__tb-sep" />

          <button className="defter__tb defter__tb--wide" title="Currency" onClick={() => applyStyle({ format: '$#,##0.00' })}>
            $
          </button>
          <button className="defter__tb defter__tb--wide" title="Percent" onClick={() => applyStyle({ format: '0%' })}>
            %
          </button>
          <button className="defter__tb defter__tb--wide" title="Fewer decimals" onClick={() => applyStyle({ format: adjustDecimals(activeAttrs.format, -1) })}>
            .0
          </button>
          <button className="defter__tb defter__tb--wide" title="More decimals" onClick={() => applyStyle({ format: adjustDecimals(activeAttrs.format, 1) })}>
            .00
          </button>
          <button className="defter__tb defter__tb-select" title="Number format" onClick={(e) => openPopover('format', e)}>
            {NUMBER_FORMATS.find((f) => f.value === (activeAttrs.format ?? ''))?.label ?? '123'}
            <span className="defter__caret" aria-hidden="true">▾</span>
          </button>
          <span className="defter__tb-sep" />

          <button className={`defter__tb defter__tb--strong${activeAttrs.bold ? ' defter__tb--on' : ''}`} title="Bold (Ctrl+B)" onClick={() => applyStyle({ bold: !activeAttrs.bold })}>
            <b>B</b>
          </button>
          <button className={`defter__tb defter__tb--strong${activeAttrs.italic ? ' defter__tb--on' : ''}`} title="Italic (Ctrl+I)" onClick={() => applyStyle({ italic: !activeAttrs.italic })}>
            <i>I</i>
          </button>
          <button className={`defter__tb defter__tb--strong${activeAttrs.underline ? ' defter__tb--on' : ''}`} title="Underline (Ctrl+U)" onClick={() => applyStyle({ underline: !activeAttrs.underline })}>
            <u>U</u>
          </button>
          <button className={`defter__tb defter__tb--strong${activeAttrs.strike ? ' defter__tb--on' : ''}`} title="Strikethrough" onClick={() => applyStyle({ strike: !activeAttrs.strike })}>
            <s>S</s>
          </button>

          <div className="defter__tb-pop">
            <button className="defter__tb defter__tb--color" title="Text color" onClick={(e) => openPopover('text', e)}>
              <Icon name="text-color" />
              <span className="defter__tb-bar" style={{ background: activeAttrs.color ? `var(--defter-token-${activeAttrs.color})` : 'var(--defter-fg)' }} />
            </button>
          </div>
          <div className="defter__tb-pop">
            <button className="defter__tb defter__tb--color" title="Fill color" onClick={(e) => openPopover('fill', e)}>
              <Icon name="fill" />
              <span className="defter__tb-bar" style={{ background: activeAttrs.fill ? `var(--defter-token-${activeAttrs.fill})` : 'transparent', outline: activeAttrs.fill ? 'none' : '1px solid var(--defter-grid-line-strong)' }} />
            </button>
          </div>
          <span className="defter__tb-sep" />

          <button className="defter__tb" title="Borders" onClick={(e) => openPopover('border', e)}>
            <Icon name="borders" />
          </button>
          <button className={`defter__tb${activeAttrs.merge ? ' defter__tb--on' : ''}`} title="Merge cells" onClick={() => applyStyle({ merge: !activeAttrs.merge })}>
            <Icon name="merge" />
          </button>
          <span className="defter__tb-sep" />

          {(['left', 'center', 'right'] as const).map((al) => (
            <button key={al} className={`defter__tb${activeAttrs.align === al ? ' defter__tb--on' : ''}`} title={`Align ${al}`} onClick={() => applyStyle({ align: al })}>
              <Icon name={`align-${al}`} />
            </button>
          ))}
          <button className={`defter__tb${activeAttrs.wrap ? ' defter__tb--on' : ''}`} title="Wrap text" onClick={() => applyStyle({ wrap: !activeAttrs.wrap })}>
            <Icon name="wrap" />
          </button>
          <span className="defter__tb-sep" />

          <button className="defter__tb" title="Sum the column above" onClick={autoSum}>
            <Icon name="sigma" />
          </button>
          <button className="defter__tb" title="Clear formatting" onClick={clearFormatting}>
            <Icon name="clear" />
          </button>
        </div>
      )}
      {formulaBar && (
        <div className="defter__formulabar" data-defter-theme={theme}>
          <span className="defter__cellref">
            {rect.minCol === rect.maxCol && rect.minRow === rect.maxRow
              ? `${columnLabel(sel.focus.col)}${sel.focus.row}`
              : `${columnLabel(rect.minCol)}${rect.minRow}:${columnLabel(rect.maxCol)}${rect.maxRow}`}
            {(rect.minCol !== rect.maxCol || rect.minRow !== rect.maxRow) && (
              <span className="defter__cellref-dims">
                {rect.maxRow - rect.minRow + 1}R × {rect.maxCol - rect.minCol + 1}C
              </span>
            )}
          </span>
          <span className="defter__fx-label">fx</span>
          <input
            className="defter__fx"
            value={barValue ?? activeRaw}
            readOnly={!editable}
            placeholder={editable ? 'Enter a value or =formula' : ''}
            onChange={(e) => setBarValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit(sel.focus.col, sel.focus.row, barValue ?? activeRaw, {
                  col: sel.focus.col,
                  row: sel.focus.row + 1,
                })
                setBarValue(null)
                e.preventDefault()
              } else if (e.key === 'Escape') {
                setBarValue(null)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onBlur={() => {
              if (barValue !== null) {
                commit(sel.focus.col, sel.focus.row, barValue)
                setBarValue(null)
              }
            }}
          />
        </div>
      )}

      <textarea
        ref={keyCatcherRef}
        className="defter__keycatcher"
        aria-label={`Defter sheet: ${sheet.name}`}
        tabIndex={-1}
        inputMode="none"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
      <div
        ref={rootRef}
        className="defter"
        data-defter-theme={theme}
        tabIndex={0}
        role="application"
        aria-label={`Defter sheet: ${sheet.name}`}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        onScroll={(e) => {
          const el = e.currentTarget
          el.dataset.scrollY = el.scrollTop > 0 ? '1' : '' // toggles the frozen-pane shadows (CSS)
          el.dataset.scrollX = el.scrollLeft > 0 ? '1' : ''
          if (virtualize) setVp({ top: el.scrollTop, height: el.clientHeight })
        }}
      >
        <table className="defter__grid" role="grid" aria-readonly={!editable || undefined}>
          <colgroup>
            <col style={{ width: 'var(--defter-head-width)' }} />
            {Array.from({ length: totalCols }, (_, c) => (
              <col key={c} style={{ width: `${colWidth(c)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="defter__corner" />
              {Array.from({ length: totalCols }, (_, c) => (
                <th
                  key={c}
                  data-col={c}
                  role="columnheader"
                  aria-colindex={c + 2}
                  className={`defter__colhead${c >= rect.minCol && c <= rect.maxCol ? ' defter__colhead--active' : ''}${c < freezeCols ? ' defter__colhead--frozen' : ''}`}
                  style={c < freezeCols ? { left: frozenColLeft(c) } : undefined}
                  onMouseDown={(e) => {
                    focusGrid()
                    setSel((s) =>
                      e.shiftKey
                        ? { anchor: s.anchor, focus: { col: c, row: totalRows } }
                        : { anchor: { col: c, row: 1 }, focus: { col: c, row: totalRows } },
                    )
                  }}
                >
                  {columnLabel(c)}
                  {editable && (
                    <span
                      className="defter__resizer"
                      title="Drag to resize · double-click to fit"
                      onMouseDown={(e) => startResize(c, e)}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        autoFitCol(c)
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {frozenTopRows.map((r) => renderRow(r))}
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={totalCols + 1} style={{ height: padTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {Array.from({ length: winEnd - winStart + 1 }, (_, k) => renderRow(winStart + k))}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={totalCols + 1} style={{ height: padBottom, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
        <div ref={marqueeRef} className="defter__marquee" aria-hidden="true" style={{ display: 'none' }} />
        <div ref={copyMarqueeRef} className="defter__copy-marquee" aria-hidden="true" style={{ display: 'none' }} />
        {editingRefs.map((fr) => (
          <div
            key={`${fr.rect.minCol},${fr.rect.minRow},${fr.rect.maxCol},${fr.rect.maxRow}`}
            className="defter__fref"
            aria-hidden="true"
            data-mincol={fr.rect.minCol}
            data-minrow={fr.rect.minRow}
            data-maxcol={fr.rect.maxCol}
            data-maxrow={fr.rect.maxRow}
            style={{ '--fref-color': fr.color, display: 'none' } as CSSProperties}
          />
        ))}
        {collabRects.map(({ collab, r }) => (
          <div
            key={collab.id}
            className="defter__collab"
            aria-hidden="true"
            data-min-col={r.minCol}
            data-max-col={r.maxCol}
            data-min-row={r.minRow}
            data-max-row={r.maxRow}
            style={{ display: 'none', '--defter-collab-color': collab.color } as CSSProperties}
          >
            <span className="defter__collab-flag">{collab.name}</span>
          </div>
        ))}
      </div>

      {menu && (
        <div className="defter__menu" style={{ left: menu.x, top: menu.y }} data-defter-theme={theme}>
          {menu.colHead !== undefined && (
            <>
              <button onClick={() => applyFreeze({ rows: sheet.freeze?.rows ?? 0, cols: menu.colHead! + 1 })}>
                Freeze up to column {columnLabel(menu.colHead)}
              </button>
              {(sheet.freeze?.cols ?? 0) > 0 && (
                <button onClick={() => applyFreeze({ rows: sheet.freeze?.rows ?? 0, cols: 0 })}>
                  Unfreeze columns
                </button>
              )}
              <div className="defter__menu-sep" />
            </>
          )}
          {menu.rowHead !== undefined && (
            <>
              <button onClick={() => applyFreeze({ rows: menu.rowHead!, cols: sheet.freeze?.cols ?? 0 })}>
                Freeze up to row {menu.rowHead}
              </button>
              {(sheet.freeze?.rows ?? 0) > 0 && (
                <button onClick={() => applyFreeze({ rows: 0, cols: sheet.freeze?.cols ?? 0 })}>
                  Unfreeze rows
                </button>
              )}
              <div className="defter__menu-sep" />
            </>
          )}
          <button onClick={() => applyModel(insertRows(model, si, Math.max(2, rect.minRow), 1))}>
            Insert row above
          </button>
          <button onClick={() => applyModel(insertRows(model, si, rect.maxRow + 1, 1))}>
            Insert row below
          </button>
          <button onClick={() => applyModel(deleteRows(model, si, rect.minRow, rect.maxRow - rect.minRow + 1))}>
            Delete {rect.maxRow > rect.minRow ? `rows ${rect.minRow}–${rect.maxRow}` : `row ${rect.minRow}`}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={() => applyModel(insertCols(model, si, rect.minCol, 1))}>
            Insert column left
          </button>
          <button onClick={() => applyModel(insertCols(model, si, rect.maxCol + 1, 1))}>
            Insert column right
          </button>
          <button onClick={() => applyModel(deleteCols(model, si, rect.minCol, rect.maxCol - rect.minCol + 1))}>
            Delete {rect.maxCol > rect.minCol ? `columns ${columnLabel(rect.minCol)}–${columnLabel(rect.maxCol)}` : `column ${columnLabel(rect.minCol)}`}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={() => applyModel(sortRows(model, si, rect.minCol, true, 2, sheet.grid.length))}>
            Sort ↑ by column {columnLabel(rect.minCol)}
          </button>
          <button onClick={() => applyModel(sortRows(model, si, rect.minCol, false, 2, sheet.grid.length))}>
            Sort ↓ by column {columnLabel(rect.minCol)}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={clearSelection}>Clear contents</button>
        </div>
      )}

      {popover && (
        <div
          className={`defter__popover${popover.kind === 'border' ? ' defter__popover--border' : ''}${popover.kind === 'format' ? ' defter__popover--list' : ''}`}
          style={{ position: 'fixed', left: popover.x, top: popover.y }}
          data-defter-theme={theme}
          onClick={(e) => e.stopPropagation()}
        >
          {popover.kind === 'format' ? (
            NUMBER_FORMATS.map((f) => (
              <button
                key={f.value}
                className={`defter__pop-row${(activeAttrs.format ?? '') === f.value ? ' defter__pop-row--on' : ''}`}
                onClick={() => {
                  applyStyle({ format: f.value || undefined })
                  setPopover(null)
                }}
              >
                <span>{f.name}</span>
                <span className="defter__pop-sample">{f.label}</span>
              </button>
            ))
          ) : popover.kind === 'border' ? (
            ([
              ['all', 'All borders'],
              ['inner', 'Inner borders'],
              ['inner-h', 'Inner horizontal'],
              ['inner-v', 'Inner vertical'],
              ['outer', 'Outer borders'],
              ['left', 'Left border'],
              ['top', 'Top border'],
              ['right', 'Right border'],
              ['bottom', 'Bottom border'],
              ['clear', 'Clear borders'],
            ] as const).map(([k, title]) => (
              <button
                key={k}
                className="defter__pop-btn"
                title={title}
                onClick={() => {
                  applyBorderKind(k)
                  setPopover(null)
                }}
              >
                <Icon name={`border-${k}`} />
              </button>
            ))
          ) : popover.kind === 'text' ? (
            (['', 'accent', 'success', 'warning', 'danger', 'muted'] as const).map((t) => (
                <button
                  key={`fg${t}`}
                  className="defter__pop-swatch"
                  title={t || 'default'}
                  style={{ background: t ? `var(--defter-token-${t})` : 'var(--defter-fg)' }}
                  onClick={() => {
                    applyStyle({ color: t || undefined })
                    setPopover(null)
                  }}
                />
              ))
          ) : (
            [
                <button
                  key="bgnone"
                  className="defter__pop-swatch defter__pop-swatch--none"
                  title="none"
                  onClick={() => {
                    applyStyle({ fill: undefined })
                    setPopover(null)
                  }}
                />,
                ...(['surface-2', 'surface-3', 'accent-soft', 'success-soft', 'warning-soft', 'danger-soft'] as const).map((t) => (
                  <button
                    key={`bg${t}`}
                    className="defter__pop-swatch"
                    title={t}
                    style={{ background: `var(--defter-token-${t})` }}
                    onClick={() => {
                      applyStyle({ fill: t })
                      setPopover(null)
                    }}
                  />
                )),
              ]
          )}
        </div>
      )}

      {finder && (
        <div className="defter__finder" data-defter-theme={theme}>
          <input
            className="defter__finder-input"
            autoFocus
            placeholder="Find"
            value={finder.query}
            onChange={(e) => {
              setFinder((f) => (f ? { ...f, query: e.target.value } : f))
              setMatchIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setMatchIdx((i) => i + (e.shiftKey ? -1 : 1))
              else if (e.key === 'Escape') {
                setFinder(null)
                focusGrid()
              }
              e.stopPropagation()
            }}
          />
          <span className="defter__finder-count">
            {matches.length ? `${curMatch + 1} / ${matches.length}` : '0'}
          </span>
          <button className="defter__finder-btn" title="Previous" onClick={() => setMatchIdx((i) => i - 1)}>
            ↑
          </button>
          <button className="defter__finder-btn" title="Next" onClick={() => setMatchIdx((i) => i + 1)}>
            ↓
          </button>
          {finder.replaceMode && editable && (
            <>
              <input
                className="defter__finder-input"
                placeholder="Replace"
                value={finder.replace}
                onChange={(e) => setFinder((f) => (f ? { ...f, replace: e.target.value } : f))}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button className="defter__finder-btn" onClick={doReplace}>
                Replace
              </button>
              <button className="defter__finder-btn" onClick={doReplaceAll}>
                All
              </button>
            </>
          )}
          <button
            className="defter__finder-btn"
            title="Close"
            onClick={() => {
              setFinder(null)
              focusGrid()
            }}
          >
            ✕
          </button>
        </div>
      )}

      {statusBar && (
        <div className="defter__statusbar" data-defter-theme={theme}>
          {stats ? (
            <>
              {stats.numCount > 0 && (
                <>
                  <span>Sum: {formatValue(stats.sum, { locale })}</span>
                  <span>Avg: {formatValue(stats.avg, { locale })}</span>
                </>
              )}
              <span>Count: {stats.count}</span>
            </>
          ) : (
            <span className="defter__status-hint">
              {columnLabel(sel.focus.col)}
              {sel.focus.row}
            </span>
          )}
        </div>
      )}

      {(sheetTabs ?? model.sheets.length > 1) && (
        <div className="defter__tabs" data-defter-theme={theme}>
          {model.sheets.map((s, i) =>
            renaming?.index === i ? (
              <input
                key={`rename-${i}`}
                className="defter__tab-rename"
                autoFocus
                value={renaming.value}
                onChange={(e) => setRenaming({ index: i, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renaming.value.trim()) pushEdit(serialize(renameSheet(model, i, renaming.value.trim())))
                    setRenaming(null)
                  } else if (e.key === 'Escape') {
                    setRenaming(null)
                  }
                }}
                onBlur={() => {
                  if (renaming.value.trim()) pushEdit(serialize(renameSheet(model, i, renaming.value.trim())))
                  setRenaming(null)
                }}
              />
            ) : (
              <button
                key={`${s.name}-${i}`}
                className={`defter__tab${i === si ? ' defter__tab--on' : ''}`}
                onClick={() => setActiveSheet(i)}
                onDoubleClick={() => editable && setRenaming({ index: i, value: s.name })}
              >
                {s.name}
              </button>
            ),
          )}
          {editable && (
            <button
              className="defter__tab-add"
              title="Add sheet"
              onClick={() => {
                const len = model.sheets.length
                pushEdit(serialize(addSheet(model)))
                setActiveSheet(len)
              }}
            >
              +
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface CellProps {
  col: number
  row: number
  sheet: Model['sheets'][number]
  styles: ReturnType<typeof resolveStyles>
  computed: ComputedGrid | null
  sheetName: string
  locale?: Locale
  showFormulas: boolean
  colAlign: 'left' | 'center' | 'right' | null
  focus: boolean
  inSelection: boolean
  frozen?: boolean
  /** Sticky `top` (px) for a frozen row — the column-header height plus the rows pinned above it. */
  frozenTop?: number
  frozenCol?: boolean
  /** Sticky `left` (px) for a frozen column — the row-header gutter plus the columns pinned left. */
  frozenLeft?: number
  fillHandle?: boolean
  onFillStart?: () => void
  colSpan?: number
  rowSpan?: number
  editing: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  functions?: string[]
  onMouseDown: (shift: boolean) => void
  onMouseEnter: () => void
  onBeginEdit: () => void
  onEditChange: (v: string) => void
  onCommit: (v: string, dir: 'down' | 'right') => void
  onCancel: () => void
}

function CellEditor(p: {
  value: string
  functions?: string[]
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  onCommit: (dir: 'down' | 'right') => void
  onCancel: () => void
}): React.JSX.Element {
  const [caret, setCaret] = useState(p.value.length)
  const [dismissed, setDismissed] = useState(false)
  const [sugIdx, setSugIdx] = useState(0)

  const suggestions = useMemo(() => {
    if (!p.functions || dismissed || !p.value.startsWith('=')) return []
    const m = /(?:^|[^A-Za-z0-9_])([A-Za-z]{1,})$/.exec(p.value.slice(0, caret))
    if (!m) return []
    const partial = m[1]!.toUpperCase()
    return p.functions.filter((f) => f.startsWith(partial) && f !== partial).slice(0, 8)
  }, [p.value, caret, p.functions, dismissed])

  const accept = (name: string) => {
    const before = p.value.slice(0, caret)
    const after = p.value.slice(caret)
    const m = /([A-Za-z]+)$/.exec(before)
    const stem = m ? before.slice(0, before.length - m[1]!.length) : before
    const pos = stem.length + name.length + 1
    p.onChange(`${stem}${name}(${after}`)
    setCaret(pos)
    setSugIdx(0)
    requestAnimationFrame(() => {
      const el = p.inputRef.current
      if (el) el.selectionStart = el.selectionEnd = pos
    })
  }

  const active = suggestions.length ? sugIdx % suggestions.length : 0
  return (
    <>
      <input
        ref={p.inputRef}
        className="defter__editor"
        value={p.value}
        autoFocus
        onChange={(e) => {
          p.onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
        }}
        onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onClick={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onBlur={() => p.onCommit('down')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === 'ArrowDown') {
              setSugIdx((i) => (i + 1) % suggestions.length)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'ArrowUp') {
              setSugIdx((i) => (i - 1 + suggestions.length) % suggestions.length)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              accept(suggestions[active]!)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'Escape') {
              setDismissed(true)
              e.preventDefault()
              e.stopPropagation()
              return
            }
          }
          if (e.key === 'Enter') {
            p.onCommit('down')
            e.preventDefault()
          } else if (e.key === 'Tab') {
            p.onCommit('right')
            e.preventDefault()
          } else if (e.key === 'Escape') {
            p.onCancel()
            e.preventDefault()
          }
          e.stopPropagation()
        }}
      />
      {suggestions.length > 0 && (
        <ul className="defter__autocomplete">
          {suggestions.map((f, i) => (
            <li
              key={f}
              className={i === active ? 'defter__ac--on' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(f)
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Themed dropdown for a data-validation cell — replaces the native <select> (OS chrome). */
function SelectEditor(p: {
  value: string
  options: string[]
  onCommit: (v: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(() => Math.max(0, p.options.indexOf(p.value)))
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div
      ref={ref}
      className="defter__select-editor"
      tabIndex={-1}
      role="listbox"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onCancel()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'ArrowDown') {
          setActive((a) => Math.min(p.options.length - 1, a + 1))
          e.preventDefault()
        } else if (e.key === 'ArrowUp') {
          setActive((a) => Math.max(0, a - 1))
          e.preventDefault()
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          p.onCommit(p.options[active] ?? '')
          e.preventDefault()
        } else if (e.key === 'Escape') {
          p.onCancel()
          e.preventDefault()
        }
      }}
    >
      <span className="defter__select-value">{p.value || ' '}</span>
      <span className="defter__caret" aria-hidden="true">
        ▾
      </span>
      <ul className="defter__autocomplete defter__select-list">
        {p.options.map((o, i) => (
          <li
            key={o}
            role="option"
            aria-selected={o === p.value}
            className={`${i === active ? 'defter__ac--on' : ''}${o === p.value ? ' defter__opt--sel' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              p.onCommit(o)
            }}
          >
            {o}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Cell(p: CellProps): React.JSX.Element {
  const staticAttrs = p.styles.attrs(p.col, p.row)
  const attrs =
    p.computed && p.sheet.conditionals.length > 0
      ? { ...staticAttrs, ...resolveConditionalAttrs(p.sheet, p.computed, p.col, p.row) }
      : staticAttrs
  const raw = getCell(p.sheet, p.col, p.row)
  const isFormula = raw.trim().startsWith('=')

  let display: React.ReactNode = ''
  let numeric = false
  let error = false
  let numVal: number | null = null
  if (p.showFormulas && isFormula) {
    display = raw
  } else if (isFormula) {
    const v = p.computed ? p.computed.get(p.sheetName, p.col, p.row) : null
    display = p.computed ? formatValue(v, { format: attrs.format, locale: p.locale }) : raw
    numeric = typeof v === 'number'
    numVal = typeof v === 'number' ? v : null
    error = isError(v)
  } else {
    const v = parseLiteral(raw, p.locale)
    numeric = typeof v === 'number'
    numVal = typeof v === 'number' ? v : null
    display = attrs.format && numeric ? formatValue(v, { format: attrs.format, locale: p.locale }) : renderInline(raw)
  }

  const cls = [
    'defter__cell',
    numeric && !attrs.align ? 'defter__cell--number' : '',
    attrs.wrap ? 'defter__cell--wrap' : '',
    error ? 'defter__cell--error' : '',
    p.showFormulas && isFormula ? 'defter__cell--formula-src' : '',
    p.inSelection ? 'defter__cell--insel' : '',
    p.focus ? 'defter__cell--focus' : '',
    p.frozen ? 'defter__cell--frozen' : '',
    p.frozenCol ? 'defter__cell--frozen-col' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const css = styleToCss(attrs)
  if (!attrs.align && p.colAlign) css.textAlign = p.colAlign
  // Frozen-pane offsets: the sticky/z-index/background come from the --frozen classes; the per-band
  // top/left are set here because column widths (and multi-row/col depth) are dynamic.
  if (p.frozenTop !== undefined) css.top = p.frozenTop
  if (p.frozenLeft !== undefined) css.left = p.frozenLeft
  if (numVal !== null && attrs.format && !attrs.color) {
    const fc = formatColor(numVal, attrs.format)
    if (fc) css.color = resolveColor(fc)
  }
  const validation = resolveValidation(p.sheet, p.col, p.row)

  return (
    <td
      className={`${cls}${validation ? ' defter__cell--select' : ''}${p.editing !== null ? ' defter__cell--editing' : ''}`}
      style={css}
      data-col={p.col}
      data-row={p.row}
      role="gridcell"
      aria-colindex={p.col + 2}
      aria-selected={p.inSelection || p.focus || undefined}
      colSpan={p.colSpan}
      rowSpan={p.rowSpan}
      onMouseDown={(e) => p.onMouseDown(e.shiftKey)}
      onMouseEnter={p.onMouseEnter}
      onDoubleClick={p.onBeginEdit}
    >
      {p.editing !== null && validation ? (
        <SelectEditor
          value={p.editing}
          options={validation}
          onCommit={(v) => p.onCommit(v, 'down')}
          onCancel={p.onCancel}
        />
      ) : p.editing !== null ? (
        <CellEditor
          value={p.editing}
          functions={p.functions}
          inputRef={p.inputRef}
          onChange={p.onEditChange}
          onCommit={(dir) => p.onCommit(p.editing ?? '', dir)}
          onCancel={p.onCancel}
        />
      ) : (
        <>
          {display}
          {validation && <span className="defter__caret" aria-hidden="true">▾</span>}
          {p.fillHandle && (
            <span
              className="defter__fill-handle"
              onMouseDown={(e) => {
                e.stopPropagation()
                p.onFillStart?.()
              }}
            />
          )}
        </>
      )}
    </td>
  )
}
