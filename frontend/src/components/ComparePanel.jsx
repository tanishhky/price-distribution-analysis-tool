import { useState } from 'react'
import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

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
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899', '#14b8a6', '#f97316']

export default function ComparePanel({ strategyHistory }) {
  const [selectedIds, setSelectedIds] = useState([])

  if (!strategyHistory?.length) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 36, color: '#1e2230', marginBottom: 16 }}>⚖</div>
        <div style={{ fontSize: 16, color: '#6b7280', fontFamily: DM }}>No Strategies to Compare</div>
        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6, fontFamily: MONO, textAlign: 'center', maxWidth: 380 }}>
          Run multiple strategies in the STRATEGY tab. Each run is saved here for comparison.
        </div>
      </div>
    )
  }

  const toggleSelect = (idx) => {
    setSelectedIds(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
  }

  const selected = selectedIds.map(i => strategyHistory[i]).filter(Boolean)

  return (
    <div style={S.container}>
      {/* Strategy Selector */}
      <div style={S.selector}>
        <div style={S.sectionHeader}>SELECT STRATEGIES TO COMPARE</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px' }}>
          {strategyHistory.map((s, i) => (
            <button key={i} onClick={() => toggleSelect(i)}
              style={{
                ...S.chip,
                background: selectedIds.includes(i) ? COLORS[i % COLORS.length] + '22' : '#151820',
                borderColor: selectedIds.includes(i) ? COLORS[i % COLORS.length] : '#1e2230',
                color: selectedIds.includes(i) ? '#e5e7eb' : '#6b7280',
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block', marginRight: 6 }} />
              {s.name || `Run ${i + 1}`}
            </button>
          ))}
        </div>
      </div>

      {selected.length >= 2 && (
        <>
          {/* Overlaid Equity Curves */}
          <div style={S.section}>
            <div style={S.sectionHeader}>EQUITY CURVES</div>
            <Plot data={selected.map((s, i) => {
              const dl = s.daily_log || []
              return {
                type: 'scatter', mode: 'lines',
                name: s.name || `Strategy ${selectedIds[i] + 1}`,
                x: dl.map(d => d.date),
                y: dl.map(d => d.portfolio_value),
                line: { color: COLORS[selectedIds[i] % COLORS.length], width: 1.5 },
              }
            })} layout={{
              ...darkLayout(''), margin: { l: 60, r: 15, t: 10, b: 40 },
              xaxis: { ...darkAxis }, yaxis: { ...darkAxis },
              showlegend: true, legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.12 },
            }} config={plotConfig} style={{ width: '100%', height: 350 }} useResizeHandler />
          </div>

          {/* Metrics Comparison Table */}
          <div style={S.section}>
            <div style={S.sectionHeader}>METRICS COMPARISON</div>
            <MetricsTable strategies={selected} ids={selectedIds} />
          </div>

          {/* Correlation Matrix */}
          {selected.length >= 2 && (
            <div style={S.section}>
              <div style={S.sectionHeader}>RETURN CORRELATION</div>
              <CorrelationMatrix strategies={selected} ids={selectedIds} />
            </div>
          )}
        </>
      )}

      {selected.length === 1 && (
        <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 12, fontFamily: MONO }}>
          Select at least 2 strategies to compare
        </div>
      )}
    </div>
  )
}

function MetricsTable({ strategies, ids }) {
  const metrics = [
    { key: 'total_return', label: 'Total Return', fmt: v => pct(v), higher: true },
    { key: 'annual_return', label: 'Annual Return', fmt: v => pct(v), higher: true },
    { key: 'sharpe', label: 'Sharpe', fmt: v => v?.toFixed(2), higher: true },
    { key: 'volatility', label: 'Volatility', fmt: v => pct(v), higher: false },
    { key: 'max_drawdown', label: 'Max Drawdown', fmt: v => pct(v), higher: false },
    { key: 'win_rate', label: 'Win Rate', fmt: v => pct(v), higher: true },
  ]

  return (
    <table style={S.table}>
      <thead>
        <tr>
          <th style={{ ...S.th, textAlign: 'left' }}>Metric</th>
          {strategies.map((s, i) => (
            <th key={i} style={{ ...S.th, color: COLORS[ids[i] % COLORS.length] }}>
              {s.name || `Strategy ${ids[i] + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {metrics.map(m => {
          const values = strategies.map(s => s.metrics?.[m.key])
          const best = m.higher
            ? Math.max(...values.filter(v => v != null))
            : Math.min(...values.filter(v => v != null))

          return (
            <tr key={m.key}>
              <td style={{ ...S.td, textAlign: 'left' }}>{m.label}</td>
              {values.map((v, i) => (
                <td key={i} style={{
                  ...S.td,
                  color: v === best ? '#22c55e' : '#d1d5db',
                  fontWeight: v === best ? 700 : 400,
                }}>
                  {m.fmt(v)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function CorrelationMatrix({ strategies, ids }) {
  // Compute pairwise correlation
  const returns = strategies.map(s => {
    const dl = s.daily_log || []
    const pv = dl.map(d => d.portfolio_value)
    const rets = []
    for (let i = 1; i < pv.length; i++) {
      rets.push((pv[i] - pv[i-1]) / pv[i-1])
    }
    return rets
  })

  const n = returns.length
  const minLen = Math.min(...returns.map(r => r.length))
  const trimmed = returns.map(r => r.slice(0, minLen))

  const corr = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { corr[i][j] = 1; continue }
      const a = trimmed[i], b = trimmed[j]
      const ma = a.reduce((s, v) => s + v, 0) / a.length
      const mb = b.reduce((s, v) => s + v, 0) / b.length
      let num = 0, da = 0, db = 0
      for (let k = 0; k < minLen; k++) {
        num += (a[k] - ma) * (b[k] - mb)
        da += (a[k] - ma) ** 2
        db += (b[k] - mb) ** 2
      }
      corr[i][j] = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
    }
  }

  const labels = strategies.map((s, i) => s.name || `S${ids[i] + 1}`)

  return (
    <Plot data={[{
      type: 'heatmap', z: corr, x: labels, y: labels,
      colorscale: [[0, '#ef4444'], [0.5, '#0d0e12'], [1, '#22c55e']],
      zmin: -1, zmax: 1, showscale: true,
      texttemplate: '%{z:.2f}', textfont: { size: 11, color: '#e5e7eb', family: MONO },
      colorbar: { tickfont: { color: '#6b7280', size: 9 } },
    }]} layout={{
      ...darkLayout(''), margin: { l: 80, r: 15, t: 10, b: 60 },
      xaxis: { ...darkAxis }, yaxis: { ...darkAxis },
    }} config={plotConfig} style={{ width: '100%', height: 300 }} useResizeHandler />
  )
}

function pct(v) {
  if (v == null || isNaN(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

const S = {
  container: { display: 'flex', flexDirection: 'column' },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', minHeight: 400,
  },
  selector: { borderBottom: '1px solid #1a1d25' },
  section: { borderBottom: '1px solid #1a1d25' },
  sectionHeader: {
    padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#6b7280',
    fontFamily: MONO, letterSpacing: 1, background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  chip: {
    background: '#151820', border: '1px solid #1e2230', borderRadius: 12,
    color: '#6b7280', fontSize: 10, fontFamily: MONO, padding: '4px 12px',
    cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.15s',
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO },
  th: {
    background: '#111318', color: '#4b5563', padding: '5px 8px', textAlign: 'right',
    fontWeight: 600, borderBottom: '1px solid #1a1d25', fontSize: 9,
  },
  td: {
    color: '#d1d5db', padding: '4px 8px', borderBottom: '1px solid #141720',
    textAlign: 'right', fontSize: 11,
  },
}
