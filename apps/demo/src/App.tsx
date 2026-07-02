import { parse, projectProse, projectText } from '@defter/core'
import { createEngine } from '@defter/formula'
import { DefterGrid } from '@defter/react'
import { useMemo, useState } from 'react'
import { SAMPLES } from './samples.js'

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

  const projection = useMemo(() => {
    if (proj === 'off') return ''
    const m = parse(text)
    const computed = engine.compute(m)
    return proj === 'table' ? projectText(m, { computed }) : projectProse(m, { computed })
  }, [proj, text, engine])

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
              />
            </div>
          </div>
        </div>

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

      <Features />
      <Footer />
    </div>
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
