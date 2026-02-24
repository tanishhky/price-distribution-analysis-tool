import { useState } from 'react'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function ResultsPanel({ resultsText, analysisData }) {
  const [copied, setCopied] = useState(false)

  if (!resultsText) return null

  const handleCopy = () => {
    navigator.clipboard.writeText(resultsText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const handleExportJSON = () => {
    if (!analysisData) return
    const blob = new Blob([JSON.stringify(analysisData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analysis_${analysisData.ticker}_${analysisData.timeframe}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <span style={S.title}>GMM RESULTS</span>
        <div style={S.btnGroup}>
          <button onClick={handleCopy} style={S.btn}>{copied ? '✓ Copied' : '⎘ Copy'}</button>
          <button onClick={handleExportJSON} style={{ ...S.btn, borderColor: '#22c55e40', color: '#22c55e' }}>↓ JSON</button>
        </div>
      </div>
      <pre style={S.pre}>{resultsText}</pre>

      {analysisData?.gmm_d1?.components && (
        <div style={{ padding: '0 14px 14px' }}>
          <MomentsTable title="D1 Components" components={analysisData.gmm_d1.components} accent="#3b82f6" />
          <MomentsTable title="D2 Components" components={analysisData.gmm_d2.components} accent="#f59e0b" />
        </div>
      )}
    </div>
  )
}

function MomentsTable({ title, components, accent }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: accent, fontWeight: 600, fontSize: 10, marginBottom: 6, fontFamily: MONO, letterSpacing: 0.8 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr>
            {['#', 'Wt', 'Label', 'μ', 'σ', 'σ²', 'Skew', 'Kurt', '±1σ', '±2σ'].map(h =>
              <th key={h} style={S.th}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {components.map((c, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#0d0e12' : 'transparent' }}>
                <td style={S.td}>{c.component_index}</td>
                <td style={S.td}>{c.weight.toFixed(4)}</td>
                <td style={{ ...S.td, color: c.label === 'HVN' ? '#22c55e' : c.label === 'LVN' ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>{c.label}</td>
                <td style={S.td}>{c.mean.toFixed(2)}</td>
                <td style={S.td}>{c.std_dev.toFixed(4)}</td>
                <td style={S.td}>{c.variance.toFixed(4)}</td>
                <td style={{ ...S.td, color: c.skewness > 0 ? '#22c55e' : c.skewness < 0 ? '#ef4444' : '#9ca3af' }}>{c.skewness.toFixed(4)}</td>
                <td style={{ ...S.td, color: c.kurtosis > 0 ? '#f59e0b' : '#60a5fa' }}>{c.kurtosis.toFixed(4)}</td>
                <td style={S.td}>[{c.range_1sigma[0].toFixed(1)}–{c.range_1sigma[1].toFixed(1)}]</td>
                <td style={S.td}>[{c.range_2sigma[0].toFixed(1)}–{c.range_2sigma[1].toFixed(1)}]</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const S = {
  container: { background: '#0a0b0d' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '1px solid #1a1d25',
  },
  title: { fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: 1.2, fontFamily: MONO },
  btnGroup: { display: 'flex', gap: 6 },
  btn: {
    background: 'transparent', border: '1px solid #2a2d35', borderRadius: 3,
    color: '#9ca3af', padding: '3px 10px', fontSize: 10, cursor: 'pointer', fontFamily: MONO,
  },
  pre: {
    background: '#080910', color: '#86efac', padding: 14, margin: '0 14px 14px',
    borderRadius: 4, fontSize: 10, overflowX: 'auto', fontFamily: MONO,
    lineHeight: 1.6, maxHeight: 400, overflowY: 'auto', border: '1px solid #1a1d25', whiteSpace: 'pre',
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO },
  th: {
    background: '#111318', color: '#4b5563', padding: '4px 8px', textAlign: 'right',
    fontWeight: 600, borderBottom: '1px solid #1a1d25', fontSize: 9,
  },
  td: {
    color: '#d1d5db', padding: '3px 8px', borderBottom: '1px solid #141720',
    whiteSpace: 'nowrap', textAlign: 'right', fontSize: 11,
  },
}
