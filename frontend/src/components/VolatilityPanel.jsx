import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function VolatilityPanel({ volData, height = 380 }) {
  if (!volData) return null
  const { volatility_analysis: va } = volData

  return (
    <div style={S.container}>
      {/* Top Metrics Row */}
      <div style={S.metricsRow}>
        <MetricCard label="SPOT" value={`$${va.spot_price?.toFixed(2)}`} />
        <MetricCard label="RV 20d" value={fmt_pct(va.realized_vol_20d)} color="#22c55e" />
        <MetricCard label="ATM IV Near" value={fmt_pct(va.atm_iv_near)} color="#f59e0b" />
        <MetricCard label="ATM IV Far" value={fmt_pct(va.atm_iv_far)} color="#f59e0b" />
        <MetricCard label="VRP 20d" value={fmt_pct(va.vrp_20d)}
          color={va.vrp_20d > 0.05 ? '#ef4444' : va.vrp_20d > 0 ? '#22c55e' : '#6b7280'} />
        <MetricCard label="TERM" value={va.iv_term_structure?.toUpperCase() || 'N/A'}
          color={va.iv_term_structure === 'backwardation' ? '#ef4444' : '#3b82f6'} />
        <MetricCard label="25Δ SKEW" value={fmt_pct(va.put_call_skew_25d)}
          color={va.put_call_skew_25d > 0.03 ? '#ef4444' : '#22c55e'} />
        <MetricCard label="GMM VOL" value={va.gmm_weighted_vol != null ? `$${va.gmm_weighted_vol.toFixed(2)}` : 'N/A'} color="#a78bfa" />
        <MetricCard label="GMM KURT" value={va.gmm_weighted_kurtosis?.toFixed(2) || 'N/A'} color="#a78bfa" />
      </div>

      {/* Charts Row */}
      <div style={S.chartsRow}>
        {/* IV Smile */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <IVSmileChart surface={va.surface_points} spot={va.spot_price} height={height} />
        </div>
        {/* Vol Cone / RV vs IV */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <VolCompareChart va={va} height={height} />
        </div>
      </div>

      {/* Debug info bar */}
      <div style={{ padding: '6px 12px', background: '#111318', borderBottom: '1px solid #1a1d25', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563' }}>
          Surface pts: <span style={{ color: (va.surface_points?.length || 0) > 3 ? '#22c55e' : '#ef4444' }}>{va.surface_points?.length || 0}</span>
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563' }}>
          Unique strikes: {va.surface_points ? [...new Set(va.surface_points.map(p => p.moneyness))].length : 0}
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563' }}>
          Unique expiries: {va.surface_points ? [...new Set(va.surface_points.map(p => p.expiry_days))].length : 0}
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: '#4b5563' }}>
          Chain: {va.chain?.length || 0} contracts
        </span>
      </div>

      {/* IV Surface 3D */}
      {va.surface_points?.length > 3 ? (
        <div style={S.fullWidth}>
          <IVSurface3D surface={va.surface_points} height={440} />
        </div>
      ) : (
        <div style={{ padding: '12px 16px', fontSize: 11, fontFamily: MONO, color: '#6b7280', borderBottom: '1px solid #1a1d25' }}>
          ⚠ IV Surface needs &gt;3 data points (got {va.surface_points?.length || 0}). Try increasing strike range or checking if contracts had valid bars.
        </div>
      )}

      {/* Chain Table */}
      {va.chain?.length > 0 && (
        <div style={S.fullWidth}>
          <ChainTable chain={va.chain} spot={va.spot_price} />
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, color = '#e5e7eb' }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, color }}>{value}</div>
    </div>
  )
}

function fmt_pct(v) {
  if (v === null || v === undefined) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

function IVSmileChart({ surface, spot, height }) {
  if (!surface || surface.length === 0) return <div style={S.noData}>No IV surface data</div>

  // Group by expiry
  const byExpiry = {}
  for (const p of surface) {
    const key = `${p.expiry_date} (${p.expiry_days}d)`
    if (!byExpiry[key]) byExpiry[key] = []
    byExpiry[key].push(p)
  }

  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899', '#14b8a6', '#f97316']
  const traces = Object.entries(byExpiry).map(([key, pts], i) => {
    pts.sort((a, b) => a.strike - b.strike)
    return {
      type: 'scatter', mode: 'lines+markers', name: key,
      x: pts.map(p => p.moneyness), y: pts.map(p => p.iv * 100),
      line: { color: colors[i % colors.length], width: 2 },
      marker: { size: 3 },
      hovertemplate: 'K/S: %{x:.3f}<br>IV: %{y:.1f}%<br>Strike: $' +
        pts.map(p => p.strike.toFixed(0)).join(', ') + '<extra>' + key + '</extra>',
    }
  })

  return (
    <Plot data={traces} layout={{
      ...darkLayout('IV Smile — by Expiry'),
      xaxis: { ...darkAxis, title: { text: 'Moneyness (S/K)', font: { color: '#6b7280', size: 11, family: MONO } } },
      yaxis: { ...darkAxis, title: { text: 'IV %', font: { color: '#6b7280', size: 11, family: MONO } } },
      shapes: [{ type: 'line', x0: 1, x1: 1, y0: 0, y1: 1, yref: 'paper', line: { color: '#4b5563', width: 1, dash: 'dash' } }],
      margin: { l: 55, r: 15, t: 35, b: 45 }, showlegend: true,
      legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.18 },
    }} config={plotConfig} style={{ width: '100%', height }} useResizeHandler />
  )
}

function VolCompareChart({ va, height }) {
  const labels = ['RV 10d', 'RV 20d', 'RV 30d', 'RV 60d', 'ATM IV Near', 'ATM IV Far']
  const vals = [va.realized_vol_10d, va.realized_vol_20d, va.realized_vol_30d, va.realized_vol_60d,
  va.atm_iv_near, va.atm_iv_far]
  const colors = ['#22c55e', '#22c55e', '#22c55e', '#22c55e', '#f59e0b', '#f59e0b']

  const filteredLabels = [], filteredVals = [], filteredColors = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] != null) {
      filteredLabels.push(labels[i])
      filteredVals.push(vals[i] * 100)
      filteredColors.push(colors[i])
    }
  }

  if (filteredVals.length === 0) return <div style={S.noData}>No volatility data to compare</div>

  return (
    <Plot data={[{
      type: 'bar', x: filteredLabels, y: filteredVals,
      marker: { color: filteredColors, opacity: 0.85, line: { color: filteredColors, width: 1 } },
      hovertemplate: '%{x}: %{y:.1f}%<extra></extra>',
    }]} layout={{
      ...darkLayout('Realized vs Implied Volatility'),
      xaxis: { ...darkAxis, tickfont: { color: '#9ca3af', size: 10, family: MONO } },
      yaxis: { ...darkAxis, title: { text: 'Volatility %', font: { color: '#6b7280', size: 11, family: MONO } } },
      margin: { l: 50, r: 15, t: 35, b: 55 }, showlegend: false, bargap: 0.3,
    }} config={plotConfig} style={{ width: '100%', height }} useResizeHandler />
  )
}

function IVSurface3D({ surface, height }) {
  const strikes = [...new Set(surface.map(p => p.moneyness))].sort((a, b) => a - b)
  const expiries = [...new Set(surface.map(p => p.expiry_days))].sort((a, b) => a - b)

  const sceneLayout = {
    xaxis: { title: 'Moneyness', color: '#9ca3af', gridcolor: '#1a1d25', backgroundcolor: '#0a0b0d' },
    yaxis: { title: 'DTE', color: '#9ca3af', gridcolor: '#1a1d25', backgroundcolor: '#0a0b0d' },
    zaxis: { title: 'IV %', color: '#9ca3af', gridcolor: '#1a1d25', backgroundcolor: '#0a0b0d' },
    bgcolor: '#0a0b0d',
    camera: { eye: { x: 1.6, y: -1.6, z: 0.8 } },
  }

  // Need at least 2 unique expiries AND 2 unique strikes for a surface grid
  if (strikes.length >= 2 && expiries.length >= 2) {
    const zData = expiries.map(exp =>
      strikes.map(strike => {
        const pt = surface.find(p => p.moneyness === strike && p.expiry_days === exp)
        return pt ? pt.iv * 100 : null
      })
    )
    return (
      <Plot data={[{
        type: 'surface',
        x: strikes, y: expiries, z: zData,
        connectgaps: true,
        colorscale: [[0, '#0a0b0d'], [0.25, '#1e3a5f'], [0.5, '#3b82f6'], [0.75, '#f59e0b'], [1, '#ef4444']],
        showscale: true,
        colorbar: {
          title: { text: 'IV %', font: { color: '#9ca3af', size: 10, family: MONO } },
          tickfont: { color: '#6b7280', size: 9 }
        },
        hovertemplate: 'Moneyness: %{x:.3f}<br>DTE: %{y}d<br>IV: %{z:.1f}%<extra></extra>',
      }]} layout={{
        ...darkLayout('Implied Volatility Surface'),
        scene: sceneLayout,
        margin: { l: 0, r: 0, t: 35, b: 0 },
      }} config={plotConfig} style={{ width: '100%', height }} useResizeHandler />
    )
  }

  // Fallback: scatter3d for sparse data that can't form a grid
  const ivPct = surface.map(p => p.iv * 100)
  return (
    <Plot data={[{
      type: 'scatter3d', mode: 'markers',
      x: surface.map(p => p.moneyness),
      y: surface.map(p => p.expiry_days),
      z: ivPct,
      marker: {
        size: 4, color: ivPct, colorscale: [[0, '#1e3a5f'], [0.5, '#3b82f6'], [1, '#ef4444']],
        showscale: true,
        colorbar: {
          title: { text: 'IV %', font: { color: '#9ca3af', size: 10, family: MONO } },
          tickfont: { color: '#6b7280', size: 9 }
        },
      },
      hovertemplate: 'Moneyness: %{x:.3f}<br>DTE: %{y}d<br>IV: %{z:.1f}%<extra></extra>',
    }]} layout={{
      ...darkLayout('Implied Volatility (Scatter — sparse data)'),
      scene: sceneLayout,
      margin: { l: 0, r: 0, t: 35, b: 0 },
    }} config={plotConfig} style={{ width: '100%', height }} useResizeHandler />
  )
}

function ChainTable({ chain, spot }) {
  const calls = chain.filter(c => c.contract.contract_type === 'call').sort((a, b) => a.contract.strike_price - b.contract.strike_price)
  const puts = chain.filter(c => c.contract.contract_type === 'put').sort((a, b) => a.contract.strike_price - b.contract.strike_price)

  const renderRows = (items, maxRows = 30) => items.slice(0, maxRows).map((c, i) => {
    const itm = c.contract.contract_type === 'call'
      ? c.contract.strike_price < spot
      : c.contract.strike_price > spot
    return (
      <tr key={i} style={{ background: itm ? '#0d1117' : 'transparent' }}>
        <td style={S.td}>{c.contract.strike_price.toFixed(1)}</td>
        <td style={S.td}>{c.contract.expiration_date}</td>
        <td style={S.td}>{c.days_to_expiry}d</td>
        <td style={{ ...S.td, color: '#f59e0b' }}>{c.mid_price?.toFixed(2) || '—'}</td>
        <td style={{ ...S.td, color: '#60a5fa' }}>{c.implied_volatility ? (c.implied_volatility * 100).toFixed(1) + '%' : '—'}</td>
        <td style={S.td}>{c.delta?.toFixed(3) || '—'}</td>
        <td style={S.td}>{c.gamma?.toFixed(4) || '—'}</td>
        <td style={S.td}>{c.theta?.toFixed(3) || '—'}</td>
        <td style={S.td}>{c.vega?.toFixed(3) || '—'}</td>
        <td style={S.td}>{c.volume || '—'}</td>
      </tr>
    )
  })

  return (
    <div style={S.tableContainer}>
      <div style={S.tableHeader}>OPTIONS CHAIN — {chain.length} contracts enriched with self-computed BS greeks</div>
      <div style={{ display: 'flex', gap: 2 }}>
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: '6px 8px', background: '#0a1a0a' }}>CALLS</div>
          <table style={S.table}>
            <thead><tr>
              {['Strike', 'Expiry', 'DTE', 'Mid', 'IV', 'Δ', 'Γ', 'Θ', 'ν', 'Vol'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>{renderRows(calls)}</tbody>
          </table>
        </div>
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ color: '#ef4444', fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: '6px 8px', background: '#1a0a0a' }}>PUTS</div>
          <table style={S.table}>
            <thead><tr>
              {['Strike', 'Expiry', 'DTE', 'Mid', 'IV', 'Δ', 'Γ', 'Θ', 'ν', 'Vol'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>{renderRows(puts)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Shared Plotly config ──
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

const S = {
  container: { display: 'flex', flexDirection: 'column', gap: 0 },
  metricsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 1, padding: '8px 10px',
    background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  metric: {
    flex: '1 1 auto', minWidth: 80, padding: '6px 10px',
    background: '#111318', borderRadius: 4, border: '1px solid #1a1d25',
  },
  metricLabel: { fontSize: 9, color: '#4b5563', fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8 },
  metricValue: { fontSize: 14, fontWeight: 700, fontFamily: MONO, marginTop: 2 },
  chartsRow: { display: 'flex', gap: 1, borderBottom: '1px solid #1a1d25' },
  fullWidth: { borderBottom: '1px solid #1a1d25' },
  noData: { padding: 40, textAlign: 'center', color: '#4b5563', fontFamily: MONO, fontSize: 12 },
  tableContainer: { padding: '0 0 8px' },
  tableHeader: {
    padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#6b7280',
    fontFamily: MONO, letterSpacing: 1, background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO },
  th: {
    background: '#111318', color: '#4b5563', padding: '4px 6px', textAlign: 'right',
    fontWeight: 600, borderBottom: '1px solid #1a1d25', whiteSpace: 'nowrap', fontSize: 9,
  },
  td: {
    color: '#d1d5db', padding: '3px 6px', borderBottom: '1px solid #141720',
    whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11,
  },
}
