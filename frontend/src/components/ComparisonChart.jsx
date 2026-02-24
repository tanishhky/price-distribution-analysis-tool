import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function ComparisonChart({ d1, d2, gmmD1, gmmD2, height = 350 }) {
  if (!d1 || !d2) return null

  const traces = [
    { type: 'scatter', mode: 'lines', x: d1.kde_x, y: d1.kde_y, name: 'D1: Time-at-Price',
      line: { color: '#3b82f6', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(59,130,246,0.06)' },
    { type: 'scatter', mode: 'lines', x: d2.kde_x, y: d2.kde_y, name: 'D2: Volume-Weighted',
      line: { color: '#f59e0b', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(245,158,11,0.06)' },
  ]

  if (gmmD1) traces.push({ type: 'scatter', mode: 'lines', x: gmmD1.fitted_curve_x, y: gmmD1.fitted_curve_y,
    name: 'D1 GMM', line: { color: '#60a5fa', width: 2, dash: 'dot' } })
  if (gmmD2) traces.push({ type: 'scatter', mode: 'lines', x: gmmD2.fitted_curve_x, y: gmmD2.fitted_curve_y,
    name: 'D2 GMM', line: { color: '#fbbf24', width: 2, dash: 'dot' } })

  const shapes = []
  if (gmmD1) gmmD1.components.forEach(c => shapes.push({ type: 'line', x0: c.mean, x1: c.mean, y0: 0, y1: 1, yref: 'paper', line: { color: '#60a5fa', width: 1, dash: 'dash' } }))
  if (gmmD2) gmmD2.components.forEach(c => shapes.push({ type: 'line', x0: c.mean, x1: c.mean, y0: 0, y1: 1, yref: 'paper', line: { color: '#fbbf24', width: 1, dash: 'dash' } }))

  return (
    <Plot data={traces} layout={{
      title: { text: 'D1 vs D2 Comparison', font: { color: '#d1d5db', size: 12, family: DM }, x: 0.02 },
      paper_bgcolor: '#0a0b0d', plot_bgcolor: '#0d0e12', font: { color: '#9ca3af', family: DM },
      xaxis: { title: { text: 'Price', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      yaxis: { title: { text: 'Density', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      margin: { l: 55, r: 15, t: 35, b: 45 }, showlegend: true,
      legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.18 },
      hovermode: 'closest', shapes,
    }} config={{ responsive: true, displayModeBar: true, displaylogo: false }}
    style={{ width: '100%', height }} useResizeHandler />
  )
}
