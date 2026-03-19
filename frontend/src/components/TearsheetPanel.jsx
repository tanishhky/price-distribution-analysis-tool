import { useState, useEffect, useMemo } from 'react'
import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"
const API = '/api'

// Plotly theme helpers
const darkAxis = {
  gridcolor: '#1a1d25', linecolor: '#1a1d25', zerolinecolor: '#1a1d25',
  tickfont: { color: '#6b7280', size: 10, family: MONO },
}
const darkLayout = (title) => ({
  title: { text: title, font: { color: '#d1d5db', size: 12, family: DM }, x: 0.02 },
  paper_bgcolor: '#0a0b0d', plot_bgcolor: '#0d0e12',
  font: { color: '#9ca3af', family: DM }, hovermode: 'closest',
})
const plotConfig = { responsive: true, displayModeBar: false, displaylogo: false }

export default function TearsheetPanel({ strategyResult }) {
  const [tearsheet, setTearsheet] = useState(null)
  const [monteCarlo, setMonteCarlo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [logScale, setLogScale] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  useEffect(() => {
    if (!strategyResult?.daily_log?.length) return
    setLoading(true)
    setError(null)
    fetch(`${API}/strategy/tearsheet`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_log: strategyResult.daily_log, config: strategyResult.config || {} }),
    }).then(r => r.json()).then(data => {
      setTearsheet(data)
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [strategyResult])

  const handleMonteCarlo = () => {
    if (!strategyResult?.daily_log?.length) return
    fetch(`${API}/strategy/monte-carlo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_log: strategyResult.daily_log, n_simulations: 5000, horizon_days: 252 }),
    }).then(r => r.json()).then(setMonteCarlo).catch(e => setError(e.message))
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const res = await fetch(`${API}/strategy/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_log: strategyResult.daily_log,
          config: strategyResult.config || {},
          strategy_name: strategyResult.name || 'Strategy',
        }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${strategyResult.name || 'Strategy'}_tearsheet.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    setDownloadingPdf(false)
  }

  if (!strategyResult?.daily_log?.length) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 36, color: '#1e2230', marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 16, color: '#6b7280', fontFamily: DM }}>No Strategy Results</div>
        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6, fontFamily: MONO }}>
          Run a strategy first, then view the tearsheet here
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 14, color: '#3b82f6', fontFamily: MONO }}>Computing tearsheet...</div>
      </div>
    )
  }

  if (!tearsheet) return null

  const { returns: ret, risk, benchmark: bench, distribution: dist, equity_curve: eq, monthly_returns: mr, rolling, drawdowns, exposure } = tearsheet

  return (
    <div style={S.container}>
      {/* Action Bar */}
      <div style={S.actionBar}>
        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>
          TEARSHEET — {exposure?.years || '?'}Y BACKTEST
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleMonteCarlo} style={S.actionBtn} title="Monte Carlo Sim">
            🎲 Monte Carlo
          </button>
          <button onClick={handleDownloadPdf} disabled={downloadingPdf} style={S.actionBtn}>
            {downloadingPdf ? '⏳ Generating...' : '📄 Download PDF'}
          </button>
        </div>
      </div>

      {/* 1. Summary Ribbon */}
      <div style={S.ribbon}>
        <MetricCard label="CAGR" value={pct(ret.cagr)} color={ret.cagr > 0 ? '#22c55e' : '#ef4444'} />
        <MetricCard label="SHARPE" value={ret.sharpe?.toFixed(2)} color={ret.sharpe > 1 ? '#22c55e' : ret.sharpe > 0 ? '#f59e0b' : '#ef4444'} />
        <MetricCard label="SORTINO" value={ret.sortino?.toFixed(2)} color="#a78bfa" />
        <MetricCard label="MAX DD" value={pct(risk.max_drawdown)} color="#ef4444" />
        <MetricCard label="CALMAR" value={ret.calmar?.toFixed(2)} color="#3b82f6" />
        <MetricCard label="OMEGA" value={ret.omega?.toFixed(2)} color="#22c55e" />
        <MetricCard label="TOTAL" value={pct(ret.total_return)} color={ret.total_return > 0 ? '#22c55e' : '#ef4444'} />
        <MetricCard label="WIN %" value={pct(ret.win_rate)} color="#f59e0b" />
        {bench?.alpha != null && <MetricCard label="ALPHA" value={pct(bench.alpha)} color="#22c55e" />}
        {bench?.beta != null && <MetricCard label="BETA" value={bench.beta?.toFixed(3)} color="#3b82f6" />}
      </div>

      {/* 2. Equity Curve */}
      {eq && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <span>EQUITY CURVE</span>
            <label style={S.toggle}>
              <input type="checkbox" checked={logScale} onChange={e => setLogScale(e.target.checked)} />
              <span style={{ marginLeft: 4, fontSize: 10, color: '#6b7280', fontFamily: MONO }}>Log Scale</span>
            </label>
          </div>
          <EquityCurveChart eq={eq} logScale={logScale} />
        </div>
      )}

      {/* 3. Underwater Plot */}
      {eq && (
        <div style={S.section}>
          <div style={S.sectionHeader}>DRAWDOWN (UNDERWATER)</div>
          <UnderwaterChart eq={eq} />
        </div>
      )}

      {/* 4. Monthly Returns Heatmap */}
      {mr && mr.matrix?.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionHeader}>MONTHLY RETURNS (%)</div>
          <MonthlyHeatmap data={mr} />
        </div>
      )}

      {/* 5. Rolling Metrics 2×2 Grid */}
      {rolling && (
        <div style={S.section}>
          <div style={S.sectionHeader}>ROLLING METRICS (63-DAY)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <RollingChart data={rolling} field="sharpe" title="Rolling Sharpe" color="#3b82f6" />
            <RollingChart data={rolling} field="volatility" title="Rolling Volatility" color="#f59e0b" fmt={v => pct(v)} />
            {rolling.beta && <RollingChart data={rolling} field="beta" title="Rolling Beta" color="#a78bfa" />}
            <RollingChart data={rolling} field="drawdown" title="Rolling Max DD" color="#ef4444" fmt={v => pct(v)} />
          </div>
        </div>
      )}

      {/* 6. Return Distribution */}
      {dist && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            RETURN DISTRIBUTION
            <span style={{ fontSize: 9, color: '#4b5563', marginLeft: 8 }}>
              Skew: {dist.skewness} | Kurt: {dist.kurtosis} | JB p={dist.jarque_bera_pvalue}
              {dist.is_normal ? ' (Normal)' : ' (Non-Normal)'}
            </span>
          </div>
          <DistributionChart dist={dist} />
        </div>
      )}

      {/* 7. Drawdown Table */}
      {drawdowns?.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionHeader}>TOP DRAWDOWNS</div>
          <DrawdownTable drawdowns={drawdowns} />
        </div>
      )}

      {/* 8. Risk Metrics Table */}
      <div style={S.section}>
        <div style={S.sectionHeader}>RISK METRICS</div>
        <RiskTable risk={risk} bench={bench} ret={ret} />
      </div>

      {/* Benchmark Comparison */}
      {bench && Object.keys(bench).length > 0 && (
        <div style={S.section}>
          <div style={S.sectionHeader}>BENCHMARK COMPARISON</div>
          <BenchmarkTable bench={bench} />
        </div>
      )}

      {/* Monte Carlo */}
      {monteCarlo && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            MONTE CARLO SIMULATION ({monteCarlo.n_simulations?.toLocaleString()} paths, {monteCarlo.horizon_days}d)
          </div>
          <MonteCarloSection mc={monteCarlo} />
        </div>
      )}

      {error && <div style={{ padding: 12, color: '#ef4444', fontSize: 11, fontFamily: MONO }}>Error: {error}</div>}
    </div>
  )
}

// ── Sub-components ──

function MetricCard({ label, value, color = '#e5e7eb' }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, color }}>{value ?? 'N/A'}</div>
    </div>
  )
}

function EquityCurveChart({ eq, logScale }) {
  const traces = [
    { type: 'scatter', mode: 'lines', name: 'Strategy', x: eq.dates, y: eq.portfolio,
      line: { color: '#3b82f6', width: 1.5 } },
  ]
  if (eq.benchmark) {
    traces.push({
      type: 'scatter', mode: 'lines', name: 'Benchmark', x: eq.dates, y: eq.benchmark,
      line: { color: '#6b7280', width: 1, dash: 'dot' },
    })
  }
  return (
    <Plot data={traces} layout={{
      ...darkLayout(''), margin: { l: 60, r: 15, t: 10, b: 40 },
      xaxis: { ...darkAxis }, yaxis: { ...darkAxis, type: logScale ? 'log' : 'linear' },
      showlegend: true, legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.12 },
    }} config={plotConfig} style={{ width: '100%', height: 320 }} useResizeHandler />
  )
}

function UnderwaterChart({ eq }) {
  return (
    <Plot data={[{
      type: 'scatter', mode: 'lines', x: eq.dates, y: eq.drawdown.map(d => d * 100),
      fill: 'tozeroy', fillcolor: 'rgba(239,68,68,0.2)',
      line: { color: '#ef4444', width: 1 }, hovertemplate: '%{x}<br>DD: %{y:.1f}%<extra></extra>',
    }]} layout={{
      ...darkLayout(''), margin: { l: 50, r: 15, t: 10, b: 40 },
      xaxis: { ...darkAxis }, yaxis: { ...darkAxis, title: { text: 'Drawdown %', font: { color: '#6b7280', size: 10, family: MONO } } },
      showlegend: false,
    }} config={plotConfig} style={{ width: '100%', height: 200 }} useResizeHandler />
  )
}

function MonthlyHeatmap({ data }) {
  const colorscale = [
    [0, '#ef4444'], [0.3, '#fca5a5'], [0.45, '#374151'],
    [0.55, '#374151'], [0.7, '#86efac'], [1, '#22c55e']
  ]
  return (
    <Plot data={[{
      type: 'heatmap', z: data.matrix, x: data.months, y: data.years,
      colorscale, zmin: -10, zmax: 10, showscale: true,
      colorbar: { title: { text: '%', font: { color: '#9ca3af', size: 10 } }, tickfont: { color: '#6b7280', size: 9 } },
      hovertemplate: '%{y} %{x}: %{z:.1f}%<extra></extra>',
      texttemplate: '%{z:.1f}', textfont: { size: 9, color: '#e5e7eb', family: MONO },
    }]} layout={{
      ...darkLayout(''), margin: { l: 55, r: 15, t: 10, b: 35 },
      xaxis: { ...darkAxis, side: 'top' }, yaxis: { ...darkAxis, autorange: 'reversed' },
    }} config={plotConfig} style={{ width: '100%', height: Math.max(200, (data.years?.length || 5) * 28 + 60) }} useResizeHandler />
  )
}

function RollingChart({ data, field, title, color, fmt = v => v?.toFixed(2) }) {
  const vals = data[field]
  if (!vals?.length) return null
  return (
    <Plot data={[{
      type: 'scatter', mode: 'lines', x: data.dates.slice(0, vals.length), y: vals,
      line: { color, width: 1.2 }, hovertemplate: `%{x}<br>${title}: %{y:.3f}<extra></extra>`,
    }]} layout={{
      ...darkLayout(title), margin: { l: 50, r: 10, t: 30, b: 30 },
      xaxis: { ...darkAxis }, yaxis: { ...darkAxis }, showlegend: false,
    }} config={plotConfig} style={{ width: '100%', height: 200 }} useResizeHandler />
  )
}

function DistributionChart({ dist }) {
  return (
    <Plot data={[
      { type: 'bar', x: dist.histogram.centers, y: dist.histogram.counts,
        marker: { color: '#3b82f6', opacity: 0.6 }, name: 'Returns', hovertemplate: 'Return: %{x:.3f}<br>Count: %{y}<extra></extra>' },
      { type: 'scatter', mode: 'lines', x: dist.fitted_normal.x, y: dist.fitted_normal.y,
        line: { color: '#f59e0b', width: 2, dash: 'dash' }, name: 'Normal Fit' },
    ]} layout={{
      ...darkLayout(''), margin: { l: 50, r: 15, t: 10, b: 35 },
      xaxis: { ...darkAxis, title: { text: 'Daily Return', font: { color: '#6b7280', size: 10, family: MONO } } },
      yaxis: { ...darkAxis }, showlegend: true, barmode: 'overlay', bargap: 0.05,
      legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', x: 0.8, y: 0.95 },
    }} config={plotConfig} style={{ width: '100%', height: 260 }} useResizeHandler />
  )
}

function DrawdownTable({ drawdowns }) {
  return (
    <table style={S.table}>
      <thead><tr>
        {['#', 'Start', 'Trough', 'Recovery', 'Depth', 'Duration (d)', 'Recovery (d)'].map(h =>
          <th key={h} style={S.th}>{h}</th>
        )}
      </tr></thead>
      <tbody>
        {drawdowns.map((d, i) => (
          <tr key={i}>
            <td style={S.td}>{i + 1}</td>
            <td style={S.td}>{d.start_date}</td>
            <td style={S.td}>{d.trough_date}</td>
            <td style={{ ...S.td, color: d.recovery_date ? '#22c55e' : '#f59e0b' }}>{d.recovery_date || 'Ongoing'}</td>
            <td style={{ ...S.td, color: '#ef4444' }}>{(d.depth * 100).toFixed(1)}%</td>
            <td style={S.td}>{d.duration_days}</td>
            <td style={S.td}>{d.recovery_days ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RiskTable({ risk, bench, ret }) {
  const rows = [
    ['VaR (95% Historical)', pct(risk.var_95_historical)],
    ['VaR (99% Historical)', pct(risk.var_99_historical)],
    ['VaR (95% Parametric)', pct(risk.var_95_parametric)],
    ['VaR (95% Cornish-Fisher)', pct(risk.var_95_cornish_fisher)],
    ['CVaR (95%)', pct(risk.cvar_95)],
    ['CVaR (99%)', pct(risk.cvar_99)],
    ['Max DD Duration', `${risk.max_drawdown_duration_days}d`],
    ['Ulcer Index', risk.ulcer_index?.toFixed(4)],
    ['Pain Index', risk.pain_index?.toFixed(4)],
    ['Tail Ratio', ret.tail_ratio?.toFixed(2)],
  ]
  return (
    <table style={S.table}>
      <thead><tr><th style={S.th}>Metric</th><th style={S.th}>Value</th></tr></thead>
      <tbody>
        {rows.map(([name, val]) => (
          <tr key={name}>
            <td style={{ ...S.td, textAlign: 'left' }}>{name}</td>
            <td style={{ ...S.td, color: '#e5e7eb' }}>{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BenchmarkTable({ bench }) {
  const rows = [
    ['Active Return', pct(bench.active_return)],
    ['Tracking Error', pct(bench.tracking_error)],
    ['Information Ratio', bench.information_ratio?.toFixed(2)],
    ['Beta', bench.beta?.toFixed(3)],
    ['Alpha (ann.)', pct(bench.alpha)],
    ['Up Capture', bench.up_capture?.toFixed(2)],
    ['Down Capture', bench.down_capture?.toFixed(2)],
    ['Rolling Corr (63d)', bench.rolling_correlation_current?.toFixed(3)],
    ['Benchmark CAGR', pct(bench.cagr)],
    ['Benchmark Max DD', pct(bench.max_drawdown)],
  ]
  return (
    <table style={S.table}>
      <thead><tr><th style={S.th}>Metric</th><th style={S.th}>Value</th></tr></thead>
      <tbody>
        {rows.map(([name, val]) => (
          <tr key={name}>
            <td style={{ ...S.td, textAlign: 'left' }}>{name}</td>
            <td style={{ ...S.td, color: '#e5e7eb' }}>{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MonteCarloSection({ mc }) {
  return (
    <div>
      <div style={S.ribbon}>
        <MetricCard label="P(LOSS)" value={pct(mc.prob_loss)} color="#ef4444" />
        <MetricCard label="P(+20%)" value={pct(mc.prob_gain_20pct)} color="#22c55e" />
        <MetricCard label="MEDIAN" value={`$${mc.terminal_wealth?.p50?.toLocaleString()}`} color="#3b82f6" />
        <MetricCard label="5TH %ILE" value={`$${mc.terminal_wealth?.p5?.toLocaleString()}`} color="#ef4444" />
        <MetricCard label="95TH %ILE" value={`$${mc.terminal_wealth?.p95?.toLocaleString()}`} color="#22c55e" />
        <MetricCard label="EXPECTED" value={`$${mc.expected_terminal?.toLocaleString()}`} color="#f59e0b" />
      </div>
      {mc.fan_chart_paths?.length > 0 && (
        <Plot data={mc.fan_chart_paths.map((path, i) => ({
          type: 'scatter', mode: 'lines',
          y: path, x: Array.from({ length: path.length }, (_, j) => j),
          line: { color: '#3b82f6', width: 0.3 },
          opacity: 0.15, showlegend: false,
          hoverinfo: 'skip',
        }))} layout={{
          ...darkLayout(`Fan Chart — ${mc.n_simulations?.toLocaleString()} Paths`),
          margin: { l: 60, r: 15, t: 35, b: 40 },
          xaxis: { ...darkAxis, title: { text: 'Days Forward', font: { color: '#6b7280', size: 10, family: MONO } } },
          yaxis: { ...darkAxis, title: { text: 'Portfolio Value', font: { color: '#6b7280', size: 10, family: MONO } } },
          showlegend: false,
        }} config={plotConfig} style={{ width: '100%', height: 300 }} useResizeHandler />
      )}
    </div>
  )
}

// ── Helpers ──
function pct(v) {
  if (v == null || isNaN(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

// ── Styles ──
const S = {
  container: { display: 'flex', flexDirection: 'column', gap: 0 },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', minHeight: 400,
  },
  actionBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 12px', background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  actionBtn: {
    background: '#151820', border: '1px solid #1e2230', borderRadius: 4,
    color: '#9ca3af', fontSize: 10, fontFamily: MONO, padding: '4px 10px',
    cursor: 'pointer', transition: 'all 0.15s',
  },
  ribbon: {
    display: 'flex', flexWrap: 'wrap', gap: 1, padding: '8px 10px',
    background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  metric: {
    flex: '1 1 auto', minWidth: 80, padding: '6px 10px',
    background: '#111318', borderRadius: 4, border: '1px solid #1a1d25',
  },
  metricLabel: { fontSize: 9, color: '#4b5563', fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8 },
  metricValue: { fontSize: 14, fontWeight: 700, fontFamily: MONO, marginTop: 2 },
  section: { borderBottom: '1px solid #1a1d25' },
  sectionHeader: {
    padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#6b7280',
    fontFamily: MONO, letterSpacing: 1, background: '#0d0e12', borderBottom: '1px solid #1a1d25',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  toggle: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO },
  th: {
    background: '#111318', color: '#4b5563', padding: '5px 8px', textAlign: 'right',
    fontWeight: 600, borderBottom: '1px solid #1a1d25', whiteSpace: 'nowrap', fontSize: 9,
  },
  td: {
    color: '#d1d5db', padding: '4px 8px', borderBottom: '1px solid #141720',
    whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11,
  },
}
