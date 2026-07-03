import {
  csvToModel,
  modelToCsv,
  parse,
  projectProse,
  projectText,
  resolveChartData,
  serialize,
} from '@defter/core'
import { createEngine } from '@defter/formula'
import { DefterChart, DefterGrid } from '@defter/react'
import { useYText } from '@defter/yjs'
import { useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { SAMPLES } from './samples.js'

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

type Theme = 'light' | 'dark' | 'paper'
type ProjView = 'off' | 'table' | 'prose'

export function App() {
  const engine = useMemo(() => createEngine(), [])
  const [sampleId, setSampleId] = useState(SAMPLES[0]!.id)
  const [text, setText] = useState(SAMPLES[0]!.text)
  const [theme, setTheme] = useState<Theme>('light')
  const [showFormulas, setShowFormulas] = useState(false)
  const [proj, setProj] = useState<ProjView>('off')

  const selectSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!
    setSampleId(id)
    setText(s.text)
  }

  const fileRef = useRef<HTMLInputElement>(null)

  const projection = useMemo(() => {
    if (proj === 'off') return ''
    const m = parse(text)
    const computed = engine.compute(m)
    return proj === 'table' ? projectText(m, { computed }) : projectProse(m, { computed })
  }, [proj, text, engine])

  const charts = useMemo(() => {
    const m = parse(text)
    const computed = engine.compute(m)
    const out: { key: string; type: any; title?: string; labels: string[]; values: number[] }[] = []
    m.sheets.forEach((s, si) =>
      s.charts.forEach((ch, ci) => {
        const data = resolveChartData(s.name, ch, computed)
        out.push({ key: `${si}-${ci}`, type: ch.type, title: ch.title, ...data })
      }),
    )
    return out
  }, [text, engine])

  const exportCsv = () => {
    const m = parse(text)
    download('defter.csv', modelToCsv(m, { computed: engine.compute(m) }), 'text/csv')
  }
  const exportXlsx = async () => {
    const m = parse(text)
    const { exportXlsx } = await import('@defter/xlsx')
    const buf = await exportXlsx(m, { computed: engine.compute(m) })
    download('defter.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }
  const onImportFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (name.endsWith('.csv')) {
      setText(serialize(csvToModel(await file.text(), file.name.replace(/\.csv$/i, '') || 'Sheet1')))
    } else if (name.endsWith('.xlsx')) {
      const { importXlsx } = await import('@defter/xlsx')
      setText(serialize(await importXlsx(await file.arrayBuffer())))
    }
  }

  return (
    <div className="page">
      <Nav />
      <Hero />

      <section className="play" id="playground">
        <div className="play__head">
          <div className="tabs">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                className={`tab${sampleId === s.id ? ' tab--on' : ''}`}
                onClick={() => selectSample(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="controls">
            <ToggleGroup
              label="Theme"
              value={theme}
              options={[
                ['light', 'Light'],
                ['dark', 'Dark'],
                ['paper', 'Paper'],
              ]}
              onChange={(v) => setTheme(v as Theme)}
            />
            <button
              className={`chip${showFormulas ? ' chip--on' : ''}`}
              onClick={() => setShowFormulas((v) => !v)}
            >
              ƒ formulas
            </button>
            <ToggleGroup
              label="Projection"
              value={proj}
              options={[
                ['off', 'Off'],
                ['table', 'Values'],
                ['prose', 'RAG'],
              ]}
              onChange={(v) => setProj(v as ProjView)}
            />
            <div className="io">
              <button className="chip" onClick={() => fileRef.current?.click()}>
                ↑ Import
              </button>
              <button className="chip" onClick={exportCsv}>
                ↓ CSV
              </button>
              <button className="chip" onClick={exportXlsx}>
                ↓ XLSX
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onImportFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </div>

        <div className="split">
          <div className="pane pane--text">
            <div className="pane__label">
              canonical text <span>· the source of truth · edit me</span>
            </div>
            <textarea
              className="src"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="pane pane--grid">
            <div className="pane__label">
              live grid <span>· a projection · edit me too</span>
            </div>
            <div className="gridwrap">
              <DefterGrid
                text={text}
                onChange={setText}
                engine={engine}
                theme={theme}
                showFormulas={showFormulas}
                toolbar
                formulaBar
                statusBar
                sheetTabs
              />
            </div>
          </div>
        </div>

        {charts.length > 0 && (
          <div className="charts-panel">
            <div className="pane__label">
              charts <span>· declared in the defter-style layer · they follow the data</span>
            </div>
            <div className="charts-grid">
              {charts.map((c) => (
                <DefterChart
                  key={c.key}
                  type={c.type}
                  title={c.title}
                  labels={c.labels}
                  values={c.values}
                  theme={theme}
                />
              ))}
            </div>
          </div>
        )}

        {proj !== 'off' && (
          <div className="projection">
            <div className="pane__label">
              {proj === 'table' ? 'values projection' : 'prose projection'}
              <span> · derived, values-materialized, style-stripped · what search & agents read</span>
            </div>
            <pre className="projout">{projection}</pre>
          </div>
        )}
      </section>

      <CollabDemo engine={engine} />
      <Features />
      <Footer />
    </div>
  )
}

const COLLAB_SEED = `## Sheet: Sprint

| Task | Owner | Points | Done |
| --- | --- | ---: | :-: |
| Parser | Ada | 5 | =IF(D2="y",C2,0) |
| Engine | Lin | 8 | =IF(D3="y",C3,0) |
| Grid UI | Sam | 5 | =IF(D4="y",C4,0) |
| Shipped |  | =SUM(C2:C4) | =SUM(D2:D4) |
`

function useCollabPair(seed: string) {
  return useMemo(() => {
    // Normalize before binding to the CRDT so subsequent edits are minimal splices.
    const canonical = serialize(parse(seed))
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const ta = docA.getText('defter')
    const tb = docB.getText('defter')
    docA.transact(() => ta.insert(0, canonical))
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    docA.on('update', (u, origin) => {
      if (origin !== 'remote') Y.applyUpdate(docB, u, 'remote')
    })
    docB.on('update', (u, origin) => {
      if (origin !== 'remote') Y.applyUpdate(docA, u, 'remote')
    })
    return { ta, tb }
  }, [seed])
}

function CollabDemo({ engine }: { engine: ReturnType<typeof createEngine> }) {
  const { ta, tb } = useCollabPair(COLLAB_SEED)
  const [textA, setA] = useYText(ta)
  const [textB, setB] = useYText(tb)
  const converged = textA === textB

  return (
    <section className="collab" id="collab">
      <div className="collab__intro">
        <h2 className="features__title">Collaboration, for free.</h2>
        <p>
          Two independent Yjs documents, synced only by exchanging CRDT updates — no shared memory.
          Edit either grid; because a cell edit is a minimal text splice, edits to different cells
          occupy disjoint character spans and merge cleanly. Defter ships <em>no</em> network
          provider: you hand it a <code>Y.Text</code>, it binds the grid.
        </p>
        <div className={`collab__badge${converged ? ' collab__badge--ok' : ''}`}>
          {converged ? '● both replicas converged' : '○ syncing…'}
        </div>
      </div>
      <div className="collab__pair">
        <div className="collab__peer">
          <div className="collab__peerlabel">
            <span className="dot dot--a" /> Replica A
          </div>
          <div className="gridwrap gridwrap--sm">
            <DefterGrid text={textA} onChange={setA} engine={engine} theme="light" statusBar />
          </div>
        </div>
        <div className="collab__peer">
          <div className="collab__peerlabel">
            <span className="dot dot--b" /> Replica B
          </div>
          <div className="gridwrap gridwrap--sm">
            <DefterGrid text={textB} onChange={setB} engine={engine} theme="dark" statusBar />
          </div>
        </div>
      </div>
    </section>
  )
}

function Nav() {
  return (
    <nav className="nav">
      <a className="brand" href="#top">
        <span className="brand__mark">📒</span> defter
      </a>
      <div className="nav__links">
        <a href="#playground">Playground</a>
        <a href="#collab">Collab</a>
        <a href="#why">Why</a>
        <a href="https://github.com/zcag/defter">GitHub ↗</a>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero__eyebrow">text-canonical · collaborative · agent-friendly</div>
      <h1 className="hero__title">
        The spreadsheet that's <em>just text.</em>
      </h1>
      <p className="hero__sub">
        The plain-text markdown document <strong>is</strong> the source of truth. The grid is a
        live, editable projection of it — so version control, real-time collaboration, full-text
        search, and AI agents all operate on ordinary text instead of a hidden binary model.
      </p>
      <div className="hero__cta">
        <a className="btn btn--primary" href="#playground">
          Try it live
        </a>
        <a className="btn" href="https://github.com/zcag/defter">
          View source
        </a>
      </div>
    </header>
  )
}

function Features() {
  const items: [string, string, string][] = [
    ['📝', 'Text is truth', 'A compact, one-row-one-line markdown table. No opaque blob — ever. It diffs, greps, and syncs like any text file.'],
    ['👥', 'Collaboration for free', 'Bind the canonical text to a text CRDT (Yjs Y.Text). Bring your own provider; Defter never owns the socket.'],
    ['🤖', 'Agents read & write it', 'An LLM authors a markdown table and edits via structured ops. The projection gives search and RAG clean, values-materialized text.'],
    ['🎨', 'Rich, but still text', 'Fills, formats, merges, borders, alignment — a co-canonical style layer keyed by A1 range. Themed entirely through CSS variables.'],
  ]
  return (
    <section className="features" id="why">
      <h2 className="features__title">Five properties, one text file.</h2>
      <div className="grid4">
        {items.map(([icon, title, body]) => (
          <div className="feat" key={title}>
            <div className="feat__icon">{icon}</div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <strong>Defter</strong> — Turkish for <em>ledger / notebook</em>. MIT licensed.
      </div>
      <div className="footer__links">
        <a href="https://github.com/zcag/defter">GitHub</a>
        <a href="https://github.com/zcag/defter/blob/master/docs/FORMAT.md">Format spec</a>
        <a href="https://github.com/zcag/defter/blob/master/docs/RATIONALE.md">Rationale</a>
      </div>
    </footer>
  )
}

function ToggleGroup(props: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="tg">
      <span className="tg__label">{props.label}</span>
      <div className="tg__opts">
        {props.options.map(([v, l]) => (
          <button
            key={v}
            className={`tg__opt${props.value === v ? ' tg__opt--on' : ''}`}
            onClick={() => props.onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
