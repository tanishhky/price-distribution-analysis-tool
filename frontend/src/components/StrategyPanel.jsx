/**
 * StrategyPanel.jsx — Strategy configuration, code upload, execution & results.
 *
 * Features:
 *   - Mode toggle: API Mode (templates + yfinance) / Manual Mode (upload data + custom code)
 *   - Ticker basket editor (API mode)
 *   - Strategy template selector (API mode)
 *   - File upload zone with drag-and-drop (Manual mode)
 *   - Code editor with syntax display
 *   - Config panel (rebalance period, window type, capital, etc.)
 *   - Execute button → calls /strategy/run or /strategy/manual/run
 *   - Results: metrics table, regime timeline, rebalance log
 *   - Debug console panel (bottom/left/full) with captured print() output
 *   - API docs viewer (collapsible)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { uploadManualData, validateManualStrategy, runManualStrategy, saveToLibrary } from '../api'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

const API = '/api'

// ── Collapsible Section ──
function Section({ title, icon, defaultOpen = false, accent, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid #1a1d25' }}>
      <button onClick={() => setOpen(p => !p)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'none', border: 'none', color: accent || '#9ca3af', padding: '10px 16px',
        cursor: 'pointer', fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: 1.2,
      }}>
        <span>{icon} {title}</span>
        <span style={{ fontSize: 10, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▸</span>
      </button>
      {open && <div style={{ padding: '0 16px 12px' }}>{children}</div>}
    </div>
  )
}

// ── Mode Toggle Switch ──
function ModeToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'flex', background: '#0a0b0d', borderRadius: 6, padding: 3,
      border: '1px solid #1e2230', gap: 2,
    }}>
      {['api', 'manual'].map(m => (
        <button key={m} onClick={() => onChange(m)} style={{
          flex: 1, padding: '7px 12px', borderRadius: 4,
          border: 'none', cursor: 'pointer', fontFamily: MONO,
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          transition: 'all 0.2s ease',
          background: mode === m
            ? (m === 'api' ? 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)' : 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)')
            : 'transparent',
          color: mode === m ? '#fff' : '#6b7280',
          boxShadow: mode === m ? '0 2px 8px rgba(59,130,246,0.25)' : 'none',
        }}>
          {m === 'api' ? '◈ API MODE' : '⚙ MANUAL MODE'}
        </button>
      ))}
    </div>
  )
}

// ── Ticker Basket ──
function TickerBasket({ tickers, onChange }) {
  const [input, setInput] = useState('')

  const addTicker = () => {
    const t = input.trim().toUpperCase()
    if (t && !tickers.includes(t)) {
      onChange([...tickers, t])
    }
    setInput('')
  }

  const remove = (t) => onChange(tickers.filter(x => x !== t))

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="Add ticker…"
          style={{ ...sty.input, flex: 1 }}
        />
        <button onClick={addTicker} style={{ ...sty.btnSmall, background: '#1d4ed8', color: '#fff' }}>+</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tickers.map(t => (
          <span key={t} style={sty.tag}>
            {t}
            <button onClick={() => remove(t)} style={sty.tagX}>×</button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── File Upload Zone (Manual Mode) ──
function FileUploadZone({ uploadedFiles, uploadInfo, uploading, onUpload, onRemoveFile }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onUpload(files)
  }

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    if (files.length) onUpload(files)
    e.target.value = ''
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#7c3aed' : '#2a2d35'}`,
          borderRadius: 8, padding: '20px 12px', textAlign: 'center',
          cursor: 'pointer', transition: 'all 0.2s ease',
          background: dragOver ? '#7c3aed11' : '#0a0b0d',
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.5 }}>📂</div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: '#6b7280' }}>
          {uploading ? '⟳ Uploading…' : 'Drop files here or click to browse'}
        </div>
        <div style={{ fontSize: 9, fontFamily: MONO, color: '#4b5563', marginTop: 4 }}>
          CSV · JSON · XLSX — multiple files supported
        </div>
        <input ref={inputRef} type="file" multiple accept=".csv,.json,.xlsx,.xls"
          onChange={handleFileSelect} style={{ display: 'none' }} />
      </div>

      {/* Uploaded file list */}
      {uploadedFiles.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {uploadedFiles.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#111318', borderRadius: 4, padding: '5px 8px',
              border: '1px solid #1e2230',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span style={{ fontSize: 12 }}>📄</span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 9, fontFamily: MONO, color: '#4b5563', flexShrink: 0 }}>
                  {(f.size / 1024).toFixed(0)}kB
                </span>
              </div>
              <button onClick={() => onRemoveFile(i)} style={{ ...sty.tagX, fontSize: 14 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Parsed info */}
      {uploadInfo && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 4,
          background: '#16a34a11', border: '1px solid #16a34a33',
        }}>
          <div style={{ fontSize: 10, fontFamily: MONO, color: '#4ade80', fontWeight: 600, marginBottom: 4 }}>
            ✓ Data Parsed
          </div>
          <div style={{ fontSize: 9, fontFamily: MONO, color: '#9ca3af', lineHeight: 1.6 }}>
            <div><strong>Columns:</strong> {uploadInfo.columns?.join(', ')}</div>
            <div><strong>Rows:</strong> {uploadInfo.row_count}</div>
            {uploadInfo.date_range && (
              <div><strong>Range:</strong> {uploadInfo.date_range.start} → {uploadInfo.date_range.end}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Config Editor ──
function ConfigEditor({ config, onChange }) {
  const update = (k, v) => onChange({ ...config, [k]: v })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
      <label style={sty.lbl}>Rebalance Days</label>
      <input type="number" value={config.rebalance_days} onChange={e => update('rebalance_days', +e.target.value)}
        min={1} max={504} style={sty.input} />

      <label style={sty.lbl}>Min Training Days</label>
      <input type="number" value={config.min_training_days} onChange={e => update('min_training_days', +e.target.value)}
        min={60} max={1260} style={sty.input} />

      <label style={sty.lbl}>Window Type</label>
      <select value={config.window_type} onChange={e => update('window_type', e.target.value)} style={sty.sel}>
        <option value="expanding">Expanding</option>
        <option value="rolling">Rolling</option>
      </select>

      {config.window_type === 'rolling' && <>
        <label style={sty.lbl}>Rolling Window</label>
        <input type="number" value={config.rolling_window || 504} onChange={e => update('rolling_window', +e.target.value)}
          min={126} max={2520} style={sty.input} />
      </>}

      <label style={sty.lbl}>Txn Cost</label>
      <input type="number" value={config.transaction_cost} onChange={e => update('transaction_cost', +e.target.value)}
        min={0} max={0.05} step={0.0005} style={sty.input} />

      <label style={sty.lbl}>Initial Capital</label>
      <input type="number" value={config.initial_capital} onChange={e => update('initial_capital', +e.target.value)}
        min={1000} step={10000} style={sty.input} />
    </div>
  )
}

// ── Code Editor (Monaco with Python syntax highlighting) ──
function CodeEditor({ code, onChange, readOnly = false }) {
  const [monacoLoaded, setMonacoLoaded] = useState(false)
  const [MonacoEditor, setMonacoEditor] = useState(null)

  useEffect(() => {
    import('@monaco-editor/react').then(mod => {
      setMonacoEditor(() => mod.default)
      setMonacoLoaded(true)
    }).catch(() => setMonacoLoaded(false))
  }, [])

  if (monacoLoaded && MonacoEditor) {
    return (
      <div style={{ borderRadius: 4, border: '1px solid #1e2230', overflow: 'hidden' }}>
        <MonacoEditor
          height="350px"
          language="python"
          theme="vs-dark"
          value={code}
          onChange={val => onChange(val || '')}
          options={{
            readOnly,
            fontSize: 12,
            fontFamily: MONO,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            bracketPairColorization: { enabled: true },
            padding: { top: 8 },
          }}
        />
      </div>
    )
  }

  // Fallback: plain textarea
  const lines = (code || '').split('\n')
  return (
    <div style={{ position: 'relative', background: '#0d0e12', borderRadius: 4, border: '1px solid #1e2230', overflow: 'hidden' }}>
      <div style={{ display: 'flex' }}>
        <div style={{
          padding: '10px 8px', textAlign: 'right', color: '#4b5563', fontSize: 11,
          fontFamily: MONO, lineHeight: '18px', userSelect: 'none',
          borderRight: '1px solid #1a1d25', minWidth: 36, background: '#0a0b0d',
        }}>
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          value={code}
          onChange={e => onChange(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          style={{
            flex: 1, background: 'transparent', border: 'none', color: '#e5e7eb',
            fontFamily: MONO, fontSize: 11, lineHeight: '18px', padding: '10px 12px',
            resize: 'none', outline: 'none', minHeight: 280, overflow: 'auto',
            tabSize: 4,
          }}
        />
      </div>
    </div>
  )
}

// ── Debug Console Panel ──
function DebugConsole({ output, placement, onPlacementChange, onClear }) {
  const [expanded, setExpanded] = useState(false)

  if (!expanded) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', background: '#0a0b0d', borderTop: '1px solid #1e2230',
        cursor: 'pointer',
      }} onClick={() => setExpanded(true)}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>🖥</span> Console
          {output && <span style={{
            background: '#7c3aed33', color: '#a78bfa', padding: '1px 5px',
            borderRadius: 8, fontSize: 9,
          }}>{output.split('\n').filter(l => l.trim()).length} lines</span>}
        </span>
        <span style={{ fontSize: 10, color: '#4b5563' }}>▸</span>
      </div>
    )
  }

  return (
    <div style={{
      borderTop: '1px solid #1e2230', display: 'flex', flexDirection: 'column',
      height: placement === 'full' ? '100%' : 220, flexShrink: 0,
    }}>
      {/* Console header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 12px', background: '#0a0b0d', borderBottom: '1px solid #1a1d25',
      }}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>🖥</span> CONSOLE OUTPUT
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Placement buttons */}
          {['bottom', 'left', 'full'].map(p => (
            <button key={p} onClick={() => onPlacementChange(p)} style={{
              background: placement === p ? '#7c3aed33' : 'transparent',
              border: `1px solid ${placement === p ? '#7c3aed55' : '#1e2230'}`,
              borderRadius: 3, padding: '2px 6px', fontSize: 9, fontFamily: MONO,
              color: placement === p ? '#a78bfa' : '#4b5563', cursor: 'pointer',
            }}>
              {p === 'bottom' ? '⬇' : p === 'left' ? '⬅' : '⬜'} {p}
            </button>
          ))}
          <button onClick={onClear} style={{
            background: 'transparent', border: '1px solid #1e2230', borderRadius: 3,
            padding: '2px 6px', fontSize: 9, fontFamily: MONO, color: '#4b5563',
            cursor: 'pointer',
          }}>✕ Clear</button>
          <button onClick={() => setExpanded(false)} style={{
            background: 'transparent', border: '1px solid #1e2230', borderRadius: 3,
            padding: '2px 6px', fontSize: 9, fontFamily: MONO, color: '#4b5563',
            cursor: 'pointer',
          }}>▾ Collapse</button>
        </div>
      </div>
      {/* Console body */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '8px 12px', background: '#08090b',
        fontFamily: MONO, fontSize: 10, lineHeight: 1.6, color: '#9ca3af',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
        {output || <span style={{ color: '#2a2d35', fontStyle: 'italic' }}>No output yet. Run a strategy to see print() statements here.</span>}
      </div>
    </div>
  )
}

// ── Results Display ──
function ResultsDisplay({ result }) {
  if (!result) return null
  const m = result.metrics
  const bm = m.benchmark || {}

  return (
    <div>
      {/* Metrics ribbon */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total Return', val: `${(m.total_return * 100).toFixed(1)}%`, bench: bm.total_return != null ? `${(bm.total_return * 100).toFixed(1)}%` : null, good: m.total_return > (bm.total_return || 0) },
          { label: 'Sharpe', val: m.sharpe?.toFixed(2), bench: bm.sharpe?.toFixed(2), good: m.sharpe > (bm.sharpe || 0) },
          { label: 'Max DD', val: `${(m.max_drawdown * 100).toFixed(1)}%`, bench: bm.max_drawdown != null ? `${(bm.max_drawdown * 100).toFixed(1)}%` : null, good: m.max_drawdown > (bm.max_drawdown || -1) },
          { label: 'Win Rate', val: `${(m.win_rate * 100).toFixed(1)}%`, bench: null, good: m.win_rate > 0.5 },
        ].map((c, i) => (
          <div key={i} style={{
            background: '#111318', borderRadius: 6, padding: '12px 14px',
            border: `1px solid ${c.good ? '#16a34a33' : '#dc262633'}`,
          }}>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: c.good ? '#4ade80' : '#f87171', fontFamily: MONO }}>
              {c.val}
            </div>
            {c.bench != null && (
              <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO, marginTop: 2 }}>
                Bench: {c.bench}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Extra metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Ann. Return', val: `${(m.annual_return * 100).toFixed(1)}%` },
          { label: 'Volatility', val: `${(m.volatility * 100).toFixed(1)}%` },
          { label: 'Rebalances', val: result.rebalance_log?.length || 0 },
        ].map((c, i) => (
          <div key={i} style={{ background: '#111318', borderRadius: 6, padding: '10px 14px', border: '1px solid #1e2230' }}>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb', fontFamily: MONO, marginTop: 2 }}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Regime timeline */}
      {result.regime_history && result.regime_history.length > 0 && (
        <Section title="REGIME TIMELINE" icon="◉" defaultOpen={true} accent="#a78bfa">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {result.regime_history.map((r, i) => (
              <div key={i} style={{
                width: 14, height: 14, borderRadius: 2,
                background: REGIME_COLORS[r.regime] || '#4b5563',
                title: `${r.date} → Regime ${r.regime}`,
              }} title={`${r.date} → Regime ${r.regime}`} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {[0, 1, 2, 3].map(r => (
              <span key={r} style={{ fontSize: 10, fontFamily: MONO, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: REGIME_COLORS[r] }} />
                R{r}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Rebalance log */}
      {result.rebalance_log && result.rebalance_log.length > 0 && (
        <Section title={`REBALANCE LOG (${result.rebalance_log.length})`} icon="↻" accent="#60a5fa">
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 10, fontFamily: MONO, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Regime', 'Turnover', 'Cost'].map(h => (
                    <th key={h} style={{ textAlign: 'left', color: '#6b7280', padding: '4px 8px', borderBottom: '1px solid #1a1d25' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rebalance_log.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #0d0e12' }}>
                    <td style={{ padding: '3px 8px', color: '#9ca3af' }}>{r.date?.slice(0, 10)}</td>
                    <td style={{ padding: '3px 8px' }}>
                      <span style={{ color: REGIME_COLORS[r.regime] || '#9ca3af' }}>R{r.regime}</span>
                    </td>
                    <td style={{ padding: '3px 8px', color: '#9ca3af' }}>{(r.turnover * 100).toFixed(1)}%</td>
                    <td style={{ padding: '3px 8px', color: '#f87171' }}>${r.cost?.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}

// ── API Docs Viewer ──
function ApiDocsViewer({ docs }) {
  if (!docs) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading docs…</div>
  return (
    <div style={{ fontSize: 11, fontFamily: MONO, color: '#9ca3af', lineHeight: 1.7 }}>
      <div style={{ color: '#e5e7eb', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{docs.title}</div>
      <p style={{ marginBottom: 12 }}>{docs.overview}</p>

      <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>Required Functions</div>
      {Object.entries(docs.required_functions || {}).map(([name, info]) => (
        <div key={name} style={{ background: '#0d0e12', borderRadius: 4, padding: 10, marginBottom: 8, border: '1px solid #1e2230' }}>
          <div style={{ color: '#4ade80', marginBottom: 4 }}>{info.signature}</div>
          <div style={{ color: '#9ca3af', marginBottom: 6 }}>{info.description}</div>
          <pre style={{ background: '#0a0b0d', padding: 8, borderRadius: 3, color: '#fbbf24', overflow: 'auto', fontSize: 10 }}>
            {info.example}
          </pre>
        </div>
      ))}

      <div style={{ color: '#60a5fa', fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Allowed Imports</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(docs.allowed_imports || []).map((m, i) => (
          <span key={i} style={{ ...sty.tag, background: '#16a34a22', borderColor: '#16a34a55', color: '#4ade80' }}>{m}</span>
        ))}
      </div>

      <div style={{ color: '#f87171', fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Forbidden</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(docs.forbidden || []).map((f, i) => (
          <span key={i} style={{ color: '#f87171', fontSize: 10 }}>✕ {f}</span>
        ))}
      </div>

      <div style={{
        marginTop: 16, padding: 10, background: '#1e3a5f33', borderRadius: 4,
        border: '1px solid #3b82f644', color: '#93c5fd',
      }}>
        <strong>Zero Look-Ahead Guarantee:</strong> {docs.look_ahead_guarantee}
      </div>
    </div>
  )
}

// ── Manual Mode Docs ──
function ManualDocsHint() {
  return (
    <div style={{
      padding: '10px 12px', background: '#7c3aed11', borderRadius: 6,
      border: '1px solid #7c3aed33', marginTop: 8,
    }}>
      <div style={{ fontSize: 11, fontFamily: MONO, color: '#a78bfa', fontWeight: 600, marginBottom: 6 }}>
        Manual Mode — Function Signature
      </div>
      <pre style={{
        margin: 0, fontSize: 10, fontFamily: MONO, color: '#e5e7eb',
        lineHeight: 1.6, whiteSpace: 'pre-wrap',
      }}>{`def run_strategy(data, config):
    """
    data:   pd.DataFrame (your uploaded data)
    config: dict (initial_capital, etc.)

    Must return dict with 'daily_log':
      [{'date': '2024-01-02',
        'portfolio_value': 100500.0,
        'benchmark_value': None,
        'regime': 0,
        'rebalanced': False}, ...]
    """
    daily_log = []
    capital = config.get('initial_capital', 100000)
    for date, row in data.iterrows():
        # your logic here
        daily_log.append({
            'date': str(date)[:10],
            'portfolio_value': capital
        })
    return {'daily_log': daily_log}`}</pre>
    </div>
  )
}

// ── Regime colors ──
const REGIME_COLORS = {
  0: '#ef4444',  // crisis – red
  1: '#f59e0b',  // stressed – amber
  2: '#22c55e',  // bull – green
  3: '#6366f1',  // transition – indigo
}

// ═══════════════════════════════════════════════════
//  MAIN PANEL
// ═══════════════════════════════════════════════════

export default function StrategyPanel({ onResult, loadedStrategy }) {
  // ── Mode ──
  const [mode, setMode] = useState('api')  // 'api' or 'manual'

  // ── API Mode state ──
  const [tickers, setTickers] = useState(['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC'])
  const [benchmark, setBenchmark] = useState('SPY')
  const [config, setConfig] = useState({
    rebalance_days: 63, min_training_days: 252,
    window_type: 'expanding', rolling_window: 504,
    transaction_cost: 0.001, initial_capital: 100000,
  })
  const [code, setCode] = useState('')
  const [name, setName] = useState('My Strategy')
  const [startDate, setStartDate] = useState('2019-01-01')
  const [endDate, setEndDate] = useState('')
  const [templates, setTemplates] = useState(null)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [docs, setDocs] = useState(null)
  const [validation, setValidation] = useState(null)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [statusText, setStatusText] = useState('')

  // ── Manual Mode state ──
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [uploadInfo, setUploadInfo] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [manualBenchmark, setManualBenchmark] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualName, setManualName] = useState('Manual Strategy')

  useEffect(() => {
    if (loadedStrategy) {
      setMode('manual')
      setManualName(loadedStrategy.name || 'Loaded Strategy')
      setManualCode(loadedStrategy.code || '')
      if (loadedStrategy.config_json) {
        try {
          const cfg = JSON.parse(loadedStrategy.config_json)
          setConfig(cfg)
          if (cfg.benchmark) setManualBenchmark(cfg.benchmark)
        } catch(e) {}
      }
    }
  }, [loadedStrategy])

  // ── Console state (shared) ──
  const [consoleOutput, setConsoleOutput] = useState('')
  const [consolePlacement, setConsolePlacement] = useState('bottom')

  // ── Load templates & docs on mount ──
  useEffect(() => {
    fetch(`${API}/strategy/templates`).then(r => r.json()).then(setTemplates).catch(() => { })
    fetch(`${API}/strategy/docs`).then(r => r.json()).then(setDocs).catch(() => { })
  }, [])

  // ── Apply template (API mode) ──
  const applyTemplate = useCallback((tid) => {
    if (!templates || !templates[tid]) return
    const t = templates[tid]
    setSelectedTemplate(tid)
    setCode(t.code)
    setName(t.name)
    setTickers(t.default_tickers)
    setConfig(prev => ({ ...prev, ...t.default_config }))
    setValidation(null)
    setResult(null)
    setError(null)
  }, [templates])

  // ── Validate code (API mode) ──
  const handleValidate = async () => {
    try {
      const res = await fetch(`${API}/strategy/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      setValidation(data)
    } catch (e) {
      setValidation({ valid: false, error: e.message })
    }
  }

  // ── Validate code (Manual mode) ──
  const handleManualValidate = async () => {
    try {
      const data = await validateManualStrategy(manualCode)
      setValidation(data)
    } catch (e) {
      setValidation({ valid: false, error: e.message })
    }
  }

  // ── Run strategy (API mode) ──
  const handleRun = async () => {
    setRunning(true); setError(null); setResult(null);
    setStatusText("Gathering Data...");

    const t1 = setTimeout(() => setStatusText("Executing Walk-Forward Backtest..."), 3500);
    const t2 = setTimeout(() => setStatusText("Generating Metrics & Tearsheet..."), 15000);

    try {
      const payload = {
        name, tickers, benchmark, regime_code: code,
        start_date: startDate,
        end_date: endDate || null,
        config: {
          rebalance_days: config.rebalance_days,
          min_training_days: config.min_training_days,
          window_type: config.window_type,
          rolling_window: config.window_type === 'rolling' ? config.rolling_window : null,
          transaction_cost: config.transaction_cost,
          initial_capital: config.initial_capital,
        },
      }
      const res = await fetch(`${API}/strategy/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      clearTimeout(t1); clearTimeout(t2);

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Strategy execution failed')
      }
      const data = await res.json()

      if (data.total_days === 0) {
        throw new Error("Strategy executed successfully but generated 0 days of results. Your 'Min Training Days' may be larger than the available date range.");
      }

      // Capture console output if present
      if (data.console_output) {
        setConsoleOutput(prev => prev + (prev ? '\n' : '') + data.console_output)
      }

      setStatusText("Completed!");
      setResult(data);

      setTimeout(() => {
        if (onResult) onResult(data, data.session_id, code, config);
      }, 1500);

    } catch (e) {
      clearTimeout(t1); clearTimeout(t2);
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  // ── Run strategy (Manual mode) ──
  const handleManualRun = async () => {
    if (!sessionId) {
      setError('Please upload data files first.')
      return
    }
    setRunning(true); setError(null); setResult(null);
    setStatusText("Executing Manual Strategy...");

    try {
      const data = await runManualStrategy({
        session_id: sessionId,
        code: manualCode,
        config: {
          initial_capital: config.initial_capital,
          rebalance_days: config.rebalance_days,
          min_training_days: config.min_training_days,
          window_type: config.window_type,
          rolling_window: config.window_type === 'rolling' ? config.rolling_window : null,
          transaction_cost: config.transaction_cost,
        },
        benchmark: manualBenchmark || null,
      })

      if (data.total_days === 0) {
        throw new Error("Strategy executed but generated 0 days of results.");
      }

      // Capture console output
      if (data.console_output) {
        setConsoleOutput(prev => prev + (prev ? '\n' : '') + data.console_output)
      }

      setStatusText("Completed!");
      setResult(data);

      setTimeout(() => {
        if (onResult) onResult({ ...data, session_id: sessionId, code: manualCode, config });
      }, 1500);

    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  // ── File upload (Manual mode) ──
  const handleDataUpload = async (files) => {
    setUploading(true); setError(null);
    try {
      const data = await uploadManualData(files)
      setUploadedFiles(prev => [...prev, ...files])
      setUploadInfo(data)
      setSessionId(data.session_id)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
    // Note: would need re-upload to update server-side data
    if (uploadedFiles.length <= 1) {
      setUploadInfo(null)
      setSessionId(null)
    }
  }

  // ── File upload for code (.py) ──
  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (mode === 'manual') {
        setManualCode(ev.target.result)
        setManualName(file.name.replace(/\.py$/, ''))
      } else {
        setCode(ev.target.result)
        setSelectedTemplate('')
        setName(file.name.replace(/\.py$/, ''))
      }
      setValidation(null)
    }
    reader.readAsText(file)
  }

  const activeCode = mode === 'manual' ? manualCode : code
  const setActiveCode = mode === 'manual' ? setManualCode : setCode
  const activeValidate = mode === 'manual' ? handleManualValidate : handleValidate
  const activeRun = mode === 'manual' ? handleManualRun : handleRun

  // If console is set to 'left', render it as the left panel overlay
  const showConsoleLeft = consolePlacement === 'left'

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── LEFT: Config Panel ── */}
      <div style={{
        width: 340, flexShrink: 0, borderRight: '1px solid #1a1d25',
        overflowY: 'auto', background: '#0d0e12',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Console Left placement overlay */}
        {showConsoleLeft ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <DebugConsole
              output={consoleOutput}
              placement={consolePlacement}
              onPlacementChange={setConsolePlacement}
              onClear={() => setConsoleOutput('')}
            />
          </div>
        ) : (
          <>
            {/* Mode Toggle */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1d25' }}>
              <ModeToggle mode={mode} onChange={(m) => {
                setMode(m); setValidation(null); setResult(null); setError(null)
              }} />
            </div>

            {/* Strategy Name */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1d25' }}>
              <div style={sty.lbl}>Strategy Name</div>
              <input
                value={mode === 'manual' ? manualName : name}
                onChange={e => mode === 'manual' ? setManualName(e.target.value) : setName(e.target.value)}
                style={{ ...sty.input, fontWeight: 600 }}
              />
            </div>

            {mode === 'api' ? (
              <>
                {/* Templates */}
                <Section title="TEMPLATES" icon="◫" defaultOpen={true} accent="#a78bfa">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {templates && Object.entries(templates).map(([tid, t]) => (
                      <button key={tid} onClick={() => applyTemplate(tid)} style={{
                        ...sty.templateBtn,
                        ...(selectedTemplate === tid ? sty.templateBtnActive : {}),
                      }}>
                        <div style={{ fontWeight: 600, color: '#e5e7eb', fontSize: 11 }}>{t.name}</div>
                        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, lineHeight: 1.3 }}>{t.description}</div>
                      </button>
                    ))}
                  </div>
                </Section>

                {/* Ticker Basket */}
                <Section title="TICKER BASKET" icon="◈" defaultOpen={true}>
                  <TickerBasket tickers={tickers} onChange={setTickers} />
                  <div style={{ marginTop: 8 }}>
                    <div style={sty.lbl}>Benchmark</div>
                    <input value={benchmark} onChange={e => setBenchmark(e.target.value.toUpperCase())} style={sty.input} />
                  </div>
                </Section>
              </>
            ) : (
              <>
                {/* Manual: File Upload */}
                <Section title="DATA FILES" icon="📂" defaultOpen={true} accent="#a855f7">
                  <FileUploadZone
                    uploadedFiles={uploadedFiles}
                    uploadInfo={uploadInfo}
                    uploading={uploading}
                    onUpload={handleDataUpload}
                    onRemoveFile={handleRemoveFile}
                  />
                </Section>

                {/* Manual: Benchmark (optional) */}
                <Section title="BENCHMARK (OPTIONAL)" icon="📊" accent="#a855f7">
                  <div style={sty.lbl}>Benchmark Ticker (fetched via API)</div>
                  <input
                    value={manualBenchmark}
                    onChange={e => setManualBenchmark(e.target.value.toUpperCase())}
                    placeholder="e.g. SPY"
                    style={sty.input}
                  />
                  <div style={{ fontSize: 9, fontFamily: MONO, color: '#4b5563', marginTop: 4 }}>
                    Leave blank for no benchmark comparison
                  </div>
                </Section>
              </>
            )}

            {/* Config (shared) */}
            <Section title="CONFIGURATION" icon="⚙">
              <ConfigEditor config={config} onChange={setConfig} />
            </Section>

            {mode === 'api' && (
              <Section title="DATE RANGE" icon="📅">
                <div style={sty.lbl}>Start Date</div>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={sty.input} />
                <div style={{ ...sty.lbl, marginTop: 6 }}>End Date (blank = today)</div>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={sty.input} />
              </Section>
            )}

            {/* Actions */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1d25' }}>
              <button onClick={activeValidate} disabled={!activeCode} style={{
                ...sty.btnFull, background: '#374151', color: '#e5e7eb', marginBottom: 6,
                opacity: activeCode ? 1 : 0.4,
              }}>
                ✓ Validate Code
              </button>

              {validation && (
                <div style={{
                  padding: '6px 10px', borderRadius: 4, marginBottom: 8, fontSize: 10, fontFamily: MONO,
                  background: validation.valid ? '#16a34a22' : '#dc262622',
                  border: `1px solid ${validation.valid ? '#16a34a55' : '#dc262655'}`,
                  color: validation.valid ? '#4ade80' : '#f87171',
                }}>
                  {validation.valid ? '✓ Code is valid' : `✕ ${validation.error}`}
                  {validation.warnings?.map((w, i) => (
                    <div key={i} style={{ color: '#fbbf24', marginTop: 4 }}>⚠ {w}</div>
                  ))}
                </div>
              )}

              <button onClick={activeRun} disabled={!activeCode || running || (mode === 'manual' && !sessionId)} style={{
                ...sty.btnFull,
                background: running ? '#374151'
                  : mode === 'manual'
                    ? 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)'
                    : 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)',
                color: '#fff',
                opacity: (!activeCode || running || (mode === 'manual' && !sessionId)) ? 0.5 : 1,
              }}>
                {running ? '⟳ Running…' : mode === 'manual' ? '▶ Execute Manual Strategy' : '▶ Execute Strategy'}
              </button>

              {error && (
                <div style={{
                  padding: '6px 10px', borderRadius: 4, marginTop: 8, fontSize: 10, fontFamily: MONO,
                  background: '#dc262622', border: '1px solid #dc262655', color: '#f87171',
                  maxHeight: 120, overflow: 'auto',
                }}>
                  {error}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT: Code + Results + Console ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Code Editor */}
        <div style={{ borderBottom: '1px solid #1a1d25' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 16px', borderBottom: '1px solid #1a1d25',
          }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: '#6b7280', fontWeight: 600, letterSpacing: 1 }}>
              {mode === 'manual' ? 'STRATEGY CODE' : 'REGIME CODE'}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={async () => {
                  const n = window.prompt("Enter a name for this strategy to save it:", activeName)
                  if (!n) return
                  try {
                    await saveToLibrary({ 
                      name: n, description: '', code: activeCode, config: JSON.stringify(config) 
                    })
                    alert("Saved to Library successfully!")
                  } catch(e) { alert("Error saving: " + e.message) }
                }}
                style={{ ...sty.btnSmall, background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}
              >
                💾 Save to Library
              </button>
              <label style={{ ...sty.btnSmall, background: '#374151', color: '#9ca3af', cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}>
                📁 Upload .py
                <input type="file" accept=".py,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <div style={{ padding: '8px 16px 12px' }}>
            <CodeEditor code={activeCode} onChange={c => { setActiveCode(c); setValidation(null) }} />
          </div>
        </div>

        {/* Manual Mode docs hint */}
        {mode === 'manual' && !result && (
          <div style={{ padding: '8px 16px' }}>
            <ManualDocsHint />
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ padding: 16, borderBottom: '1px solid #1a1d25' }}>
            <div style={{ fontSize: 10, fontFamily: MONO, color: '#6b7280', fontWeight: 600, letterSpacing: 1, marginBottom: 12 }}>
              RESULTS — {result.name} ({result.start_date?.slice(0, 10)} → {result.end_date?.slice(0, 10)})
            </div>
            <ResultsDisplay result={result} />
          </div>
        )}

        {/* API Docs (API mode only) */}
        {mode === 'api' && (
          <div style={{ padding: 16 }}>
            <Section title="API DOCUMENTATION" icon="📘" accent="#60a5fa">
              <ApiDocsViewer docs={docs} />
            </Section>
          </div>
        )}

        {/* Empty / Loading state area */}
        {!result && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', color: '#4b5563', padding: 40,
          }}>
            {running ? (
              <>
                <div style={{ fontSize: 28, marginBottom: 12, display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</div>
                <div style={{ fontSize: 13, fontFamily: DM, color: '#6b7280' }}>{statusText || 'Running strategy…'}</div>
                <div style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563', marginTop: 4 }}>
                  {mode === 'manual' ? 'Executing your strategy code against uploaded data…' : 'Fetching data & retraining at each rebalance. This may take 30–120s.'}
                </div>
              </>
            ) : (
              !result && mode === 'api' && (
                <>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⚗</div>
                  <div style={{ fontSize: 14, fontFamily: DM, fontWeight: 500 }}>Strategy Lab</div>
                  <div style={{ fontSize: 11, fontFamily: MONO, color: '#374151', marginTop: 6, textAlign: 'center', maxWidth: 340 }}>
                    Select a template or upload your own Python regime code. Configure your basket, then execute with zero look-ahead bias.
                  </div>
                </>
              )
            )}
            {!running && mode === 'manual' && (
              <>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚙</div>
                <div style={{ fontSize: 14, fontFamily: DM, fontWeight: 500 }}>Manual Mode</div>
                <div style={{ fontSize: 11, fontFamily: MONO, color: '#374151', marginTop: 6, textAlign: 'center', maxWidth: 360 }}>
                  Upload your own data files, write a run_strategy(data, config) function, and execute with full control over data and logic.
                </div>
              </>
            )}
          </div>
        )}

        {/* Debug Console (bottom placement) */}
        {consolePlacement !== 'left' && (
          <DebugConsole
            output={consoleOutput}
            placement={consolePlacement}
            onPlacementChange={setConsolePlacement}
            onClear={() => setConsoleOutput('')}
          />
        )}
      </div>
    </div>
  )
}

// ── Styles ──
const sty = {
  lbl: { fontSize: 10, color: '#6b7280', fontFamily: MONO, marginBottom: 3 },
  input: {
    width: '100%', background: '#151820', border: '1px solid #1e2230',
    borderRadius: 4, color: '#e5e7eb', padding: '5px 8px', fontSize: 12,
    fontFamily: MONO, outline: 'none', boxSizing: 'border-box',
  },
  sel: {
    width: '100%', background: '#151820', border: '1px solid #1e2230',
    borderRadius: 4, color: '#e5e7eb', padding: '5px 8px', fontSize: 12,
    fontFamily: MONO, cursor: 'pointer',
  },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#1e3a5f33', border: '1px solid #3b82f644', borderRadius: 3,
    padding: '2px 8px', fontSize: 10, fontFamily: MONO, color: '#93c5fd',
  },
  tagX: {
    background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
    fontSize: 12, padding: 0, lineHeight: 1,
  },
  btnSmall: {
    border: 'none', borderRadius: 3, padding: '4px 10px', fontSize: 11,
    fontFamily: MONO, cursor: 'pointer', fontWeight: 600,
  },
  btnFull: {
    width: '100%', border: 'none', borderRadius: 4, padding: '9px 0',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: MONO,
    letterSpacing: 0.3, transition: 'all 0.15s',
  },
  templateBtn: {
    background: '#111318', border: '1px solid #1e2230', borderRadius: 4,
    padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
    transition: 'all 0.15s', width: '100%',
  },
  templateBtnActive: {
    background: '#1e3a5f33', borderColor: '#3b82f6',
  },
}
