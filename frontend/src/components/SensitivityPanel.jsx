import { useState } from 'react'
import Plot from 'react-plotly.js'
import { runSensitivity } from '../api'

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

export default function SensitivityPanel({ strategyResult, sessionId, code }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const [param1, setParam1] = useState('rebalance_days')
  const [range1, setRange1] = useState('21, 42, 63, 126')
  const [param2, setParam2] = useState('transaction_cost')
  const [range2, setRange2] = useState('0.001, 0.002, 0.005')

  const handleRun = async () => {
    if (!sessionId || !code) {
      setError("Please run a strategy in Manual mode first to cache data and code.")
      return
    }

    try {
      const p1Vals = range1.split(',').map(s => Number(s.trim()))
      const p2Vals = range2.split(',').map(s => Number(s.trim()))
      
      const grid = { [param1]: p1Vals }
      if (param2 && range2) grid[param2] = p2Vals

      setLoading(true)
      setError(null)

      const res = await runSensitivity({
        session_id: sessionId,
        code: code,
        config: strategyResult?.config || {},
        param_grid: grid
      })
      setData(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!sessionId) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 36, color: '#1e2230', marginBottom: 16 }}>🎛</div>
        <div style={{ fontSize: 16, color: '#6b7280', fontFamily: DM }}>Parameter Sensitivity</div>
        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6, fontFamily: MONO, textAlign: 'center', maxWidth: 380 }}>
          Run your manual strategy once to upload data, then use this tab to sweep across parameters.
        </div>
      </div>
    )
  }

  return (
    <div style={S.container}>
      {/* Control Bar */}
      <div style={S.actionBar}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={S.inputGroup}>
            <label style={S.label}>Param 1</label>
            <input value={param1} onChange={e => setParam1(e.target.value)} style={S.input} placeholder="e.g. rebalance_days" />
            <input value={range1} onChange={e => setRange1(e.target.value)} style={S.input} placeholder="e.g. 21,42,63" />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Param 2 (Optional)</label>
            <input value={param2} onChange={e => setParam2(e.target.value)} style={S.input} placeholder="e.g. transaction_cost" />
            <input value={range2} onChange={e => setRange2(e.target.value)} style={S.input} placeholder="e.g. 0.001,0.005" />
          </div>
        </div>
        <button onClick={handleRun} disabled={loading} style={{ ...S.actionBtn, background: loading ? '#374151' : '#3b82f6', color: '#fff', borderColor: '#2563eb' }}>
          {loading ? 'Running Grid...' : 'Run Sweep'}
        </button>
      </div>

      {error && <div style={{ padding: 12, color: '#ef4444', fontSize: 11, fontFamily: MONO, background: '#111318', borderBottom: '1px solid #1a1d25' }}>Error: {error}</div>}

      {/* Results */}
      {data && data.results && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          
          {data.overfit_warning && (
            <div style={{ padding: '8px 12px', background: '#451a1a', color: '#fca5a5', fontSize: 11, fontFamily: MONO, borderBottom: '1px solid #7f1d1d' }}>
              ⚠️ {data.overfit_warning}
            </div>
          )}

          {/* Heatmap (if 2 params) */}
          {data.param_keys.length === 2 && (
            <div style={S.section}>
              <div style={S.sectionHeader}>SHARPE RATIO HEATMAP</div>
              <SensitivityHeatmap results={data.results} keys={data.param_keys} />
            </div>
          )}

          {/* Results Table */}
          <div style={S.section}>
            <div style={S.sectionHeader}>ALL ITERATIONS ({data.total_combinations})</div>
            <GridTable results={data.results} keys={data.param_keys} />
          </div>
        </div>
      )}
    </div>
  )
}

function SensitivityHeatmap({ results, keys }) {
  const p1 = keys[0]
  const p2 = keys[1]
  
  const valid = results.filter(r => !r.error)
  const xVals = [...new Set(valid.map(r => r.params[p1]))].sort((a,b)=>a-b)
  const yVals = [...new Set(valid.map(r => r.params[p2]))].sort((a,b)=>a-b)

  const zNames = ['Sharpe']
  const z = Array(yVals.length).fill(0).map(() => Array(xVals.length).fill(null))

  valid.forEach(r => {
    const i = yVals.indexOf(r.params[p2])
    const j = xVals.indexOf(r.params[p1])
    if (i >= 0 && j >= 0) {
      z[i][j] = r.sharpe
    }
  })

  return (
    <Plot data={[{
      type: 'heatmap', x: xVals, y: yVals, z: z,
      colorscale: [[0, '#ef4444'], [0.5, '#0d0e12'], [1, '#22c55e']],
      texttemplate: '%{z:.2f}', showscale: true,
      colorbar: { tickfont: { color: '#6b7280', size: 9 } }
    }]} layout={{
      ...darkLayout(''), margin: { l: 60, r: 20, t: 20, b: 50 },
      xaxis: { ...darkAxis, title: { text: p1, font: { color: '#9ca3af', size: 10, family: MONO } }, type: 'category' },
      yaxis: { ...darkAxis, title: { text: p2, font: { color: '#9ca3af', size: 10, family: MONO } }, type: 'category' }
    }} config={plotConfig} style={{ width: '100%', height: 350 }} useResizeHandler />
  )
}

function GridTable({ results, keys }) {
  const sorted = [...results].sort((a, b) => {
    if (a.error && !b.error) return 1
    if (!a.error && b.error) return -1
    return (b.sharpe || 0) - (a.sharpe || 0)
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>#</th>
            {keys.map(k => <th key={k} style={S.th}>{k}</th>)}
            <th style={S.th}>Sharpe</th>
            <th style={S.th}>Total Ret</th>
            <th style={S.th}>Max DD</th>
            <th style={S.th}>Vol</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ background: i === 0 && !r.error ? '#152417' : 'transparent' }}>
              <td style={S.td}>{i+1}</td>
              {keys.map(k => <td key={k} style={S.td}>{r.params[k]}</td>)}
              {r.error ? (
                <td colSpan={4} style={{ ...S.td, color: '#ef4444' }}>{r.error}</td>
              ) : (
                <>
                  <td style={{ ...S.td, color: r.sharpe > 1 ? '#22c55e' : '#d1d5db', fontWeight: 600 }}>{r.sharpe?.toFixed(2)}</td>
                  <td style={S.td}>{(r.total_return * 100).toFixed(1)}%</td>
                  <td style={{ ...S.td, color: '#ef4444' }}>{(r.max_drawdown * 100).toFixed(1)}%</td>
                  <td style={S.td}>{(r.volatility * 100).toFixed(1)}%</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const S = {
  container: { display: 'flex', flexDirection: 'column' },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', minHeight: 400,
  },
  actionBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px', background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  inputGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  label: { fontSize: 10, color: '#6b7280', fontFamily: MONO, textTransform: 'uppercase' },
  input: {
    background: '#0a0b0d', border: '1px solid #1e2230', color: '#e5e7eb',
    fontFamily: MONO, fontSize: 11, padding: '4px 8px', borderRadius: 4, width: 140
  },
  actionBtn: {
    background: '#151820', border: '1px solid #1e2230', borderRadius: 4,
    color: '#9ca3af', fontSize: 11, fontFamily: MONO, padding: '6px 16px',
    cursor: 'pointer', transition: 'all 0.15s', fontWeight: 600
  },
  section: { borderBottom: '1px solid #1a1d25' },
  sectionHeader: {
    padding: '8px 12px', fontSize: 10, fontWeight: 600, color: '#6b7280',
    fontFamily: MONO, letterSpacing: 1, background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO },
  th: {
    background: '#111318', color: '#4b5563', padding: '6px 12px', textAlign: 'right',
    fontWeight: 600, borderBottom: '1px solid #1a1d25', whiteSpace: 'nowrap', fontSize: 10,
  },
  td: {
    color: '#d1d5db', padding: '6px 12px', borderBottom: '1px solid #141720',
    whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11,
  },
}
