import { useState } from 'react'
import Plot from 'react-plotly.js'
import { runWFO } from '../api'

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

export default function WfoPanel({ strategyResult, sessionId, code }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const [nFolds, setNFolds] = useState(5)
  const [trainRatio, setTrainRatio] = useState(0.7)
  const [param1, setParam1] = useState('rebalance_days')
  const [range1, setRange1] = useState('21, 63')
  const [param2, setParam2] = useState('transaction_cost')
  const [range2, setRange2] = useState('0.001, 0.005')

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

      const res = await runWFO({
        session_id: sessionId,
        code: code,
        config: strategyResult?.config || {},
        param_grid: grid,
        n_folds: Number(nFolds),
        train_ratio: Number(trainRatio)
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
        <div style={{ fontSize: 36, color: '#1e2230', marginBottom: 16 }}>🚶‍♂️</div>
        <div style={{ fontSize: 16, color: '#6b7280', fontFamily: DM }}>Walk-Forward Optimization</div>
        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6, fontFamily: MONO, textAlign: 'center', maxWidth: 380 }}>
          Run your manual strategy once to upload data, then use this tab to run out-of-sample forward walks.
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
            <label style={S.label}>Folds</label>
            <input type="number" value={nFolds} onChange={e => setNFolds(e.target.value)} style={{...S.input, width: 60}} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Train Ratio</label>
            <input type="number" step="0.1" value={trainRatio} onChange={e => setTrainRatio(e.target.value)} style={{...S.input, width: 60}} />
          </div>
          <div style={{ borderLeft: '1px solid #1a1d25', margin: '0 8px' }} />
          <div style={S.inputGroup}>
            <label style={S.label}>Param 1</label>
            <input value={param1} onChange={e => setParam1(e.target.value)} style={S.input} placeholder="e.g. rebalance_days" />
            <input value={range1} onChange={e => setRange1(e.target.value)} style={{...S.input, width: 100}} placeholder="e.g. 21,63" />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Param 2</label>
            <input value={param2} onChange={e => setParam2(e.target.value)} style={S.input} />
            <input value={range2} onChange={e => setRange2(e.target.value)} style={{...S.input, width: 100}} />
          </div>
        </div>
        <button onClick={handleRun} disabled={loading} style={{ ...S.actionBtn, background: loading ? '#374151' : '#a78bfa', color: '#111827', borderColor: '#8b5cf6' }}>
          {loading ? 'Walking Forward...' : 'Run WFO'}
        </button>
      </div>

      {error && <div style={{ padding: 12, color: '#ef4444', fontSize: 11, fontFamily: MONO, background: '#111318', borderBottom: '1px solid #1a1d25' }}>Error: {error}</div>}

      {/* Results */}
      {data && data.folds && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ display: 'flex', background: '#0d0e12', borderBottom: '1px solid #1a1d25' }}>
            <MetricCard label="OOS CAGR" value={pct(data.oos_metrics.cagr)} color={data.oos_metrics.cagr > 0 ? '#22c55e' : '#ef4444'} />
            <MetricCard label="OOS SHARPE" value={data.oos_metrics.sharpe?.toFixed(2)} color="#3b82f6" />
            <MetricCard label="OOS MAX DD" value={pct(data.oos_metrics.max_drawdown)} color="#ef4444" />
          </div>

          {/* Stitched OOS Equity Curve */}
          <div style={S.section}>
            <div style={S.sectionHeader}>OUT-OF-SAMPLE EQUITY CURVE (STITCHED)</div>
            <Plot data={[{
              type: 'scatter', mode: 'lines', name: 'OOS Strategy',
              x: data.oos_daily_log.map(d => d.date),
              y: data.oos_daily_log.map(d => d.portfolio_value),
              line: { color: '#a78bfa', width: 1.5 },
            }]} layout={{
              ...darkLayout(''), margin: { l: 60, r: 15, t: 10, b: 40 },
              xaxis: { ...darkAxis }, yaxis: { ...darkAxis }
            }} config={plotConfig} style={{ width: '100%', height: 300 }} useResizeHandler />
          </div>

          {/* Fold Results Table */}
          <div style={S.section}>
            <div style={S.sectionHeader}>FOLD BREAKDOWN</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Fold</th>
                    <th style={S.th}>Train Period</th>
                    <th style={S.th}>Test Period</th>
                    <th style={S.th}>Best Params (IS)</th>
                    <th style={S.th}>IS Sharpe</th>
                    <th style={S.th}>OOS Sharpe</th>
                    <th style={S.th}>OOS Return</th>
                  </tr>
                </thead>
                <tbody>
                  {data.folds.map((f, i) => (
                    <tr key={i}>
                      <td style={S.td}>{f.fold}</td>
                      {f.error ? (
                        <td colSpan={6} style={{ ...S.td, color: '#ef4444' }}>{f.error}</td>
                      ) : (
                        <>
                          <td style={S.td}>{f.train_dates[0].split('T')[0]} → {f.train_dates[1].split('T')[0]}</td>
                          <td style={S.td}>{f.test_dates[0].split('T')[0]} → {f.test_dates[1].split('T')[0]}</td>
                          <td style={{ ...S.td, color: '#a78bfa' }}>{JSON.stringify(f.best_params).replace(/["{}]/g, '')}</td>
                          <td style={S.td}>{f.in_sample_sharpe?.toFixed(2)}</td>
                          <td style={{ ...S.td, fontWeight: 600, color: f.out_of_sample_sharpe > 1 ? '#22c55e' : '#d1d5db' }}>{f.out_of_sample_sharpe?.toFixed(2)}</td>
                          <td style={S.td}>{pct(f.out_of_sample_return)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, color = '#e5e7eb' }) {
  return (
    <div style={{ flex: '1 1 auto', padding: '12px 16px', borderRight: '1px solid #1a1d25' }}>
      <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, marginTop: 4, color }}>{value ?? 'N/A'}</div>
    </div>
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
  actionBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px', background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  inputGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  label: { fontSize: 9, color: '#6b7280', fontFamily: MONO, textTransform: 'uppercase' },
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
