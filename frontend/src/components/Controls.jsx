import { useState, useRef } from 'react'

const TIMEFRAMES = ['1min', '5min', '15min', '30min', '1hour', '4hour', '1day', '1week']
const ASSET_CLASSES = ['auto', 'stocks', 'crypto', 'forex']
const HINTS = { auto: 'AAPL, X:BTCUSD, C:EURUSD', stocks: 'AAPL, SPY, TSLA', crypto: 'BTCUSD, X:ETHUSD', forex: 'EURUSD, C:GBPJPY' }
const MONO = "'JetBrains Mono', monospace"

export default function Controls({ onFetchAndAnalyze, onReAnalyze, onRunVolatility, onReprocess, onDownloadCache, onUploadCache, hasCandles, hasVolCache, loading, status }) {
  const fileInputRef = useRef(null)
  const [apiKeyInput, setApiKeyInput] = useState(() => sessionStorage.getItem('polygon_api_keys') || '')
  const [ticker, setTicker] = useState('SPY')
  const [assetClass, setAssetClass] = useState('auto')
  const [timeframe, setTimeframe] = useState('1day')
  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [numBins, setNumBins] = useState(200)
  const [nComponents, setNComponents] = useState(0)
  const [syncGmm, setSyncGmm] = useState(false)
  // Volatility params
  const [riskFreeRate, setRiskFreeRate] = useState(0.05)
  const [divYield, setDivYield] = useState(0.0)
  const [strikeRange, setStrikeRange] = useState(15)
  const [collapsed, setCollapsed] = useState({})

  const handleApiKeyInput = (v) => { setApiKeyInput(v); sessionStorage.setItem('polygon_api_keys', v) }
  const parseKeys = () => apiKeyInput.split(/[,;\n]+/).map(k => k.trim()).filter(Boolean)

  const toggle = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }))

  const handleSubmit = () => {
    const keys = parseKeys()
    if (keys.length === 0) return alert('Enter at least one Polygon.io API key.')
    if (!ticker.trim()) return alert('Enter a ticker symbol.')
    onFetchAndAnalyze({
      api_keys: keys, ticker: ticker.trim().toUpperCase(), asset_class: assetClass,
      timeframe, start_date: startDate, end_date: endDate,
      num_bins: numBins, n_components_override: nComponents === 0 ? null : nComponents,
      sync_gmm: syncGmm,
    })
  }

  const handleReAnalyze = () => {
    onReAnalyze({
      num_bins: numBins,
      n_components_override: nComponents === 0 ? null : nComponents,
      sync_gmm: syncGmm,
    })
  }

  const handleVolatility = () => {
    const keys = parseKeys()
    if (keys.length === 0) return alert('Enter at least one Polygon.io API key.')
    if (!ticker.trim()) return alert('Enter a ticker symbol.')
    onRunVolatility({
      api_keys: keys, ticker: ticker.trim().toUpperCase(),
      risk_free_rate: riskFreeRate, dividend_yield: divYield,
      strike_range_pct: strikeRange / 100,
    })
  }

  return (
    <aside style={S.sidebar}>
      {/* Brand */}
      <div style={S.brand}>
        <span style={S.brandIcon}>◈</span>
        <span style={S.brandName}>VolEdge</span>
        <span style={S.version}>v3.0</span>
      </div>

      <div style={S.scrollArea}>
        {/* API Key */}
        <Section title="CONNECTION" id="conn" collapsed={collapsed} toggle={toggle}>
          <textarea value={apiKeyInput} onChange={e => handleApiKeyInput(e.target.value)}
            placeholder="Polygon.io API key(s) — one per line or comma-separated"
            rows={2}
            style={{ ...S.input, resize: 'vertical', minHeight: 32 }} />
          {parseKeys().length > 1 && (
            <div style={{ fontSize: 10, color: '#22c55e', fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
              {parseKeys().length} keys detected — {parseKeys().length * 5} req/min
            </div>
          )}
          <a href="https://polygon.io/dashboard/signup" target="_blank" rel="noreferrer" style={S.link}>
            Get free key →
          </a>
        </Section>

        {/* Symbol */}
        <Section title="INSTRUMENT" id="sym" collapsed={collapsed} toggle={toggle}>
          <Row>
            <div style={{ flex: 1 }}>
              <Lbl>Class</Lbl>
              <select value={assetClass} onChange={e => setAssetClass(e.target.value)} style={S.select}>
                {ASSET_CLASSES.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ flex: 1.5 }}>
              <Lbl>Ticker</Lbl>
              <input type="text" value={ticker} onChange={e => setTicker(e.target.value)}
                placeholder={HINTS[assetClass]?.split(',')[0]} style={S.input} />
            </div>
          </Row>
          <div style={S.hint}>{HINTS[assetClass]}</div>
        </Section>

        {/* Time */}
        <Section title="TIME RANGE" id="time" collapsed={collapsed} toggle={toggle}>
          <Lbl>Timeframe</Lbl>
          <div style={S.tfGrid}>
            {TIMEFRAMES.map(t => (
              <button key={t} onClick={() => setTimeframe(t)}
                style={{ ...S.tfBtn, ...(timeframe === t ? S.tfActive : {}) }}>
                {t}
              </button>
            ))}
          </div>
          <Row>
            <div style={{ flex: 1 }}>
              <Lbl>From</Lbl>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={S.input} />
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>To</Lbl>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={S.input} />
            </div>
          </Row>
        </Section>

        {/* Analysis */}
        <Section title="GMM PARAMS" id="gmm" collapsed={collapsed} toggle={toggle}>
          <Row>
            <div style={{ flex: 1 }}>
              <Lbl>Bins: {numBins}</Lbl>
              <input type="range" min={50} max={500} step={10} value={numBins}
                onChange={e => setNumBins(Number(e.target.value))} style={S.slider} />
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>GMM N: {nComponents === 0 ? 'Auto' : nComponents}</Lbl>
              <input type="range" min={0} max={10} value={nComponents}
                onChange={e => setNComponents(Number(e.target.value))} style={S.slider} />
            </div>
          </Row>
          <div
            onClick={() => setSyncGmm(p => !p)}
            style={{ ...S.toggleRow, cursor: 'pointer', userSelect: 'none', marginTop: 6 }}
          >
            <span style={{ ...S.toggleDot, background: syncGmm ? '#22c55e' : '#1e2230' }} />
            <span style={{ fontSize: 10, fontFamily: MONO, color: syncGmm ? '#22c55e' : '#6b7280' }}>
              Sync D1/D2 (shared N)
            </span>
          </div>
        </Section>

        {/* Volatility Params */}
        <Section title="VOLATILITY" id="vol" collapsed={collapsed} toggle={toggle}>
          <Row>
            <div style={{ flex: 1 }}>
              <Lbl>Risk-free %</Lbl>
              <input type="number" step="0.01" min="0" max="0.20" value={riskFreeRate}
                onChange={e => setRiskFreeRate(parseFloat(e.target.value) || 0)} style={S.input} />
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>Div yield %</Lbl>
              <input type="number" step="0.005" min="0" max="0.10" value={divYield}
                onChange={e => setDivYield(parseFloat(e.target.value) || 0)} style={S.input} />
            </div>
          </Row>
          <Lbl>Strike range: ±{strikeRange}%</Lbl>
          <input type="range" min={5} max={30} value={strikeRange}
            onChange={e => setStrikeRange(Number(e.target.value))} style={S.slider} />
        </Section>

        {/* Actions */}
        <div style={{ marginTop: 12 }}>
          <button onClick={handleSubmit} disabled={loading}
            style={{ ...S.btn, ...S.btnPrimary, ...(loading ? S.btnDisabled : {}) }}>
            {loading ? '⏳ Processing…' : '▶ Fetch & Analyze'}
          </button>
          {hasCandles && (
            <button onClick={handleReAnalyze} disabled={loading}
              style={{ ...S.btn, ...S.btnReanalyze, ...(loading ? S.btnDisabled : {}), marginTop: 6 }}>
              {loading ? '⏳ Processing…' : '⟳ Re-Analyze (GMM)'}
            </button>
          )}
          <button onClick={handleVolatility} disabled={loading}
            style={{ ...S.btn, ...S.btnVol, ...(loading ? S.btnDisabled : {}), marginTop: 6 }}>
            {loading ? '⏳ Processing…' : '◈ Run Vol Analysis'}
          </button>
          {hasVolCache && (
            <button
              onClick={() => onReprocess({
                risk_free_rate: riskFreeRate,
                dividend_yield: divYield,
                strike_range_pct: strikeRange / 100,
              })}
              disabled={loading}
              style={{ ...S.btn, ...S.btnReprocess, ...(loading ? S.btnDisabled : {}), marginTop: 6 }}
            >
              {loading ? '⏳ Processing…' : '⟳ Reprocess (cached)'}
            </button>
          )}

          {/* Cache IO — compact row */}
          <div style={S.cacheRow}>
            <button
              onClick={onDownloadCache}
              disabled={!hasCandles}
              style={{ ...S.cacheBtn, ...(hasCandles ? {} : S.cacheBtnDisabled) }}
              title="Download cached raw data as JSON"
            >↓ Save</button>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={S.cacheBtn}
              title="Load cached data from JSON file"
            >↑ Load</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => { onUploadCache(e.target.files[0]); e.target.value = '' }}
            />
          </div>
        </div>

        {status && (
          <div style={{ ...S.statusBox, borderLeftColor: status.type === 'error' ? '#ef4444' : status.type === 'success' ? '#22c55e' : '#3b82f6' }}>
            <span style={{ fontSize: 11, color: status.type === 'error' ? '#fca5a5' : '#d1d5db', fontFamily: "'JetBrains Mono', monospace" }}>
              {status.message}
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}

function Section({ title, id, collapsed, toggle, children }) {
  const isOpen = !collapsed[id]
  return (
    <div style={S.section}>
      <div style={S.sectionHeader} onClick={() => toggle(id)}>
        <span style={S.sectionTitle}>{title}</span>
        <span style={{ ...S.chevron, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
      </div>
      {isOpen && <div style={S.sectionBody}>{children}</div>}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>{children}</div>
}

function Lbl({ children }) {
  return <div style={S.label}>{children}</div>
}

const S = {
  sidebar: {
    width: 260, minWidth: 260, background: '#0f1014',
    borderRight: '1px solid #1a1d25', display: 'flex',
    flexDirection: 'column', height: '100vh', overflow: 'hidden',
  },
  brand: {
    padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: '1px solid #1a1d25',
  },
  brandIcon: { color: '#3b82f6', fontSize: 18, fontWeight: 700 },
  brandName: { color: '#e5e7eb', fontSize: 15, fontWeight: 700, letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace" },
  version: { color: '#4b5563', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", marginLeft: 'auto', background: '#1a1d25', padding: '2px 6px', borderRadius: 3 },
  scrollArea: { flex: 1, overflowY: 'auto', padding: '8px 12px 16px' },
  section: { marginBottom: 4 },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 4px', cursor: 'pointer', userSelect: 'none',
    borderBottom: '1px solid #141720',
  },
  sectionTitle: {
    fontSize: 10, fontWeight: 600, color: '#6b7280', letterSpacing: 1.2,
    fontFamily: "'JetBrains Mono', monospace",
  },
  chevron: { color: '#4b5563', fontSize: 10, transition: 'transform 0.15s' },
  sectionBody: { padding: '6px 0 4px' },
  label: { fontSize: 11, color: '#9ca3af', marginBottom: 3, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" },
  input: {
    width: '100%', background: '#151820', border: '1px solid #1e2230',
    borderRadius: 4, color: '#e5e7eb', padding: '5px 8px', fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  select: {
    width: '100%', background: '#151820', border: '1px solid #1e2230',
    borderRadius: 4, color: '#e5e7eb', padding: '5px 8px', fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
  },
  slider: { width: '100%', accentColor: '#3b82f6', cursor: 'pointer', height: 4 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' },
  toggleDot: {
    width: 10, height: 10, borderRadius: '50%', border: '1px solid #3b82f6',
    transition: 'background 0.15s',
  },
  tfGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, marginTop: 4,
  },
  tfBtn: {
    background: '#151820', border: '1px solid #1e2230', borderRadius: 3,
    color: '#9ca3af', padding: '3px 0', fontSize: 10, cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace", textAlign: 'center',
    transition: 'all 0.12s',
  },
  tfActive: { background: '#1e3a5f', border: '1px solid #3b82f6', color: '#60a5fa' },
  hint: { fontSize: 10, color: '#4b5563', marginTop: 3, fontFamily: "'JetBrains Mono', monospace" },
  link: { fontSize: 10, color: '#3b82f6', textDecoration: 'none', display: 'block', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" },
  btn: {
    width: '100%', border: 'none', borderRadius: 4, padding: '8px 0',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace", transition: 'all 0.15s',
    letterSpacing: 0.3,
  },
  btnPrimary: { background: '#1d4ed8', color: '#fff' },
  btnVol: { background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)', color: '#fff' },
  btnReprocess: {
    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', color: '#fff',
    border: '1px solid #34d399',
  },
  btnReanalyze: {
    background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)', color: '#fff',
    border: '1px solid #fbbf24',
  },
  cacheRow: {
    display: 'flex', gap: 4, marginTop: 8, paddingTop: 8,
    borderTop: '1px solid #1a1d25',
  },
  cacheBtn: {
    flex: 1, background: '#151820', border: '1px solid #1e2230',
    borderRadius: 3, color: '#9ca3af', padding: '4px 0', fontSize: 10,
    cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
    textAlign: 'center', transition: 'all 0.12s',
  },
  cacheBtnDisabled: { opacity: 0.3, cursor: 'not-allowed' },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  statusBox: {
    marginTop: 10, padding: '8px 10px', background: '#111318',
    borderRadius: 4, borderLeft: '3px solid #3b82f6',
    wordBreak: 'break-word',
  },
}
