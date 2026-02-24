import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function CandlestickChart({ candles, ticker }) {
  if (!candles || candles.length === 0) return null

  const dates = candles.map(c => new Date(c.timestamp).toISOString())
  const open  = candles.map(c => c.open)
  const high  = candles.map(c => c.high)
  const low   = candles.map(c => c.low)
  const close = candles.map(c => c.close)
  const vol   = candles.map(c => c.volume)
  const colors = candles.map(c => c.close >= c.open ? '#22c55e' : '#ef4444')

  return (
    <Plot
      data={[
        {
          type: 'candlestick', x: dates, open, high, low, close, name: ticker,
          increasing: { line: { color: '#22c55e' }, fillcolor: '#22c55e' },
          decreasing: { line: { color: '#ef4444' }, fillcolor: '#ef4444' },
          xaxis: 'x', yaxis: 'y',
        },
        {
          type: 'bar', x: dates, y: vol, name: 'Volume',
          marker: { color: colors, opacity: 0.5 },
          xaxis: 'x', yaxis: 'y2',
          hovertemplate: 'Vol: %{y:,.0f}<extra></extra>',
        },
      ]}
      layout={{
        title: { text: `${ticker} — OHLCV`, font: { color: '#d1d5db', size: 12, family: DM }, x: 0.02 },
        paper_bgcolor: '#0a0b0d', plot_bgcolor: '#0d0e12',
        font: { color: '#9ca3af', family: DM },
        xaxis: { gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO }, rangeslider: { visible: false } },
        yaxis: { gridcolor: '#1a1d25', linecolor: '#1a1d25', tickfont: { color: '#6b7280', size: 9, family: MONO }, domain: [0.28, 1], title: { text: 'Price', font: { color: '#4b5563', size: 10, family: MONO } } },
        yaxis2: { gridcolor: '#141720', linecolor: '#1a1d25', tickfont: { color: '#4b5563', size: 8, family: MONO }, domain: [0, 0.22], title: { text: 'Vol', font: { color: '#4b5563', size: 10, family: MONO } } },
        margin: { l: 55, r: 15, t: 30, b: 30 }, showlegend: false, hovermode: 'closest',
      }}
      config={{ responsive: true, displayModeBar: true, displaylogo: false }}
      style={{ width: '100%', height: '100%' }}
      useResizeHandler
    />
  )
}
