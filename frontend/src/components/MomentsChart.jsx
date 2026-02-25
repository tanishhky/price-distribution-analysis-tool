import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a78bfa', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']

function ChartCard({ title, timestamps, series, yLabel, height = 240 }) {
    if (!timestamps || timestamps.length === 0) return null

    const traces = series.map((s, i) => ({
        x: timestamps.map(ts => new Date(ts)),
        y: s.values,
        type: 'scatter',
        mode: 'lines',
        name: s.label,
        line: { color: COLORS[i % COLORS.length], width: 1.5 },
        connectgaps: true,
    })).filter(t => t.y.some(v => v != null))

    if (traces.length === 0) return null

    return (
        <div style={S.card}>
            <Plot
                data={traces}
                layout={{
                    title: { text: title, font: { size: 11, color: '#9ca3af', family: MONO } },
                    xaxis: {
                        type: 'date', color: '#4b5563', gridcolor: '#1a1d25',
                        tickfont: { size: 9, family: MONO, color: '#6b7280' },
                    },
                    yaxis: {
                        title: { text: yLabel, font: { size: 10, family: MONO, color: '#6b7280' } },
                        color: '#4b5563', gridcolor: '#1a1d25',
                        tickfont: { size: 9, family: MONO, color: '#6b7280' },
                    },
                    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                    margin: { t: 32, b: 40, l: 50, r: 16 },
                    showlegend: true,
                    legend: {
                        font: { size: 9, family: MONO, color: '#6b7280' },
                        bgcolor: 'transparent', x: 1, xanchor: 'right', y: 1,
                    },
                    height,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height }}
            />
        </div>
    )
}

export default function MomentsChart({ momentEvolution, distLabel }) {
    if (!momentEvolution || !momentEvolution.timestamps?.length) {
        return (
            <div style={S.empty}>
                <div style={{ fontSize: 20, color: '#1e2230', marginBottom: 8 }}>📈</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>No moment evolution data</div>
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>Run analysis with enough candles to generate sliding window data</div>
            </div>
        )
    }

    const ts = momentEvolution.timestamps
    const distData = momentEvolution[distLabel] || momentEvolution.d1

    if (!distData?.components?.length) {
        return <div style={S.empty}><div style={{ fontSize: 12, color: '#6b7280' }}>No component data available</div></div>
    }

    const meanSeries = distData.components.map((c, i) => ({
        label: `C${i + 1}`, values: c.mean,
    }))

    const sigmaSeries = distData.components.map((c, i) => ({
        label: `C${i + 1}`, values: c.sigma,
    }))

    const weightSeries = distData.components.map((c, i) => ({
        label: `C${i + 1}`, values: c.weight,
    }))

    const kurtSeries = [{
        label: 'Mixture', values: distData.mixture_kurtosis,
    }]

    return (
        <div style={S.container}>
            <div style={S.grid}>
                <ChartCard title="Component Means (Price Level)" timestamps={ts} series={meanSeries} yLabel="Mean ($)" />
                <ChartCard title="Component Std Dev (Volatility)" timestamps={ts} series={sigmaSeries} yLabel="σ ($)" />
                <ChartCard title="Component Weights (Probability)" timestamps={ts} series={weightSeries} yLabel="Weight" />
                <ChartCard title="Mixture Excess Kurtosis (Tail Risk)" timestamps={ts} series={kurtSeries} yLabel="κ" />
            </div>
        </div>
    )
}

const S = {
    container: { padding: '8px 4px' },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 },
    card: { borderBottom: '1px solid #1a1d25', borderRight: '1px solid #1a1d25', padding: '2px 4px' },
    empty: {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 48, textAlign: 'center',
    },
}
