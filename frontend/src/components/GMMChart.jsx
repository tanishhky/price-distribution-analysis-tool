import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"
const COLORS = ['#ef4444','#22c55e','#f59e0b','#a78bfa','#f97316','#14b8a6','#60a5fa','#ec4899','#84cc16','#06b6d4']

export default function GMMChart({ dist, gmm, label, distKey = 'd1', height = 350 }) {
  if (!dist || !gmm) return null
  const base = distKey === 'd1' ? '#3b82f6' : '#f59e0b'

  const traces = [
    { type: 'bar', x: dist.price_bins, y: dist.density, name: 'Histogram', marker: { color: base, opacity: 0.12 }, bargap: 0 },
    { type: 'scatter', mode: 'lines', x: dist.kde_x, y: dist.kde_y, name: 'KDE', line: { color: base, width: 1.5, dash: 'dot' } },
  ]

  gmm.component_curves.forEach((c, i) => {
    traces.push({
      type: 'scatter', mode: 'lines', x: c.x, y: c.y, name: c.label,
      line: { color: COLORS[i % COLORS.length], width: 2 },
      fill: 'tozeroy', fillcolor: COLORS[i % COLORS.length] + '15',
    })
  })

  traces.push({
    type: 'scatter', mode: 'lines', x: gmm.fitted_curve_x, y: gmm.fitted_curve_y,
    name: 'GMM Fit', line: { color: '#e5e7eb', width: 2.5 },
  })

  const shapes = gmm.components.map((c, i) => ({
    type: 'line', x0: c.mean, x1: c.mean, y0: 0, y1: 1, yref: 'paper',
    line: { color: COLORS[i % COLORS.length], width: 1, dash: 'dashdot' },
  }))

  return (
    <Plot data={traces} layout={{
      title: { text: `${label} — GMM (n=${gmm.n_components})`, font: { color: '#d1d5db', size: 12, family: DM }, x: 0.02 },
      paper_bgcolor: '#0a0b0d', plot_bgcolor: '#0d0e12', font: { color: '#9ca3af', family: DM },
      xaxis: { title: { text: 'Price', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      yaxis: { title: { text: 'Density', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      margin: { l: 55, r: 15, t: 35, b: 45 }, showlegend: true,
      legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.18 },
      hovermode: 'closest', shapes, bargap: 0,
    }} config={{ responsive: true, displayModeBar: true, displaylogo: false }}
    style={{ width: '100%', height }} useResizeHandler />
  )
}
