import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"
const COLORS = { d1: '#3b82f6', d2: '#f59e0b' }

export default function DistributionChart({ dist, label, distKey = 'd1', orientation = 'vertical', height = 320 }) {
  if (!dist) return null
  const color = COLORS[distKey] || '#3b82f6'
  const isH = orientation === 'horizontal'

  const histTrace = isH
    ? { type: 'bar', x: dist.density, y: dist.price_bins, orientation: 'h', name: `${label} Hist`, marker: { color, opacity: 0.25 } }
    : { type: 'bar', x: dist.price_bins, y: dist.density, name: `${label} Hist`, marker: { color, opacity: 0.25 } }

  const kdeTrace = isH
    ? { type: 'scatter', mode: 'lines', x: dist.kde_y, y: dist.kde_x, name: `${label} KDE`, line: { color, width: 2 } }
    : { type: 'scatter', mode: 'lines', x: dist.kde_x, y: dist.kde_y, name: `${label} KDE`, line: { color, width: 2 } }

  const sfx = isH ? '(Profile)' : ''

  return (
    <Plot data={[histTrace, kdeTrace]} layout={{
      title: { text: `${label} ${sfx}`, font: { color: '#d1d5db', size: 12, family: DM }, x: 0.02 },
      paper_bgcolor: '#0a0b0d', plot_bgcolor: '#0d0e12', font: { color: '#9ca3af', family: DM },
      xaxis: { title: { text: isH ? 'Density' : 'Price', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      yaxis: { title: { text: isH ? 'Price' : 'Density', font: { color: '#4b5563', size: 10, family: MONO } }, gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO } },
      margin: { l: 55, r: 15, t: 35, b: 45 }, showlegend: true,
      legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)' },
      hovermode: 'closest', bargap: 0,
    }} config={{ responsive: true, displayModeBar: true, displaylogo: false }}
    style={{ width: '100%', height }} useResizeHandler />
  )
}
