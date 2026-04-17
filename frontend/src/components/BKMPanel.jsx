import Plot from 'react-plotly.js'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

export default function BKMPanel({ volData, analysis }) {
  if (!volData) return <div style={S.empty}>Run Vol Analysis to see BKM risk-neutral moments</div>

  const va = volData.volatility_analysis
  const bkm30 = va?.rn_bkm_30d
  const bkm60 = va?.rn_bkm_60d

  // Extract GMM physical moments from analysis (D2 = volume-weighted)
  const gmmD2 = analysis?.gmm_d2
  let physicalSkew = null, physicalKurt = null, physicalVol = null
  if (gmmD2 && gmmD2.components?.length > 0) {
    const comps = gmmD2.components
    const mixMean = comps.reduce((s, c) => s + c.weight * c.mean, 0)
    const mixVar = comps.reduce((s, c) => s + c.weight * (c.variance + (c.mean - mixMean) ** 2), 0)
    if (mixVar > 0) {
      physicalVol = Math.sqrt(mixVar)
      // Mixture skewness
      const m3 = comps.reduce((s, c) => {
        const d = c.mean - mixMean
        return s + c.weight * (d ** 3 + 3 * d * c.variance)
      }, 0)
      physicalSkew = m3 / (mixVar ** 1.5)
      // Mixture kurtosis (excess)
      const m4 = comps.reduce((s, c) => {
        const d = c.mean - mixMean
        return s + c.weight * (3 * c.variance ** 2 + 6 * c.variance * d ** 2 + d ** 4)
      }, 0)
      physicalKurt = m4 / (mixVar ** 2) - 3.0
    }
  }

  const hasBKM = bkm30 || bkm60

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerTitle}>
          <span style={S.headerIcon}>📐</span>
          BKM MODEL-FREE RISK-NEUTRAL MOMENTS
        </div>
        <div style={S.headerSub}>
          Bakshi, Kapadia, Madan (2003) — extracted from OTM option prices via Simpson's rule integration
        </div>
      </div>

      {!hasBKM ? (
        <div style={S.noData}>
          <div style={S.noDataIcon}>◇</div>
          <div style={S.noDataTitle}>Insufficient OTM Option Data</div>
          <div style={S.noDataSub}>
            BKM requires ≥3 OTM calls and ≥3 OTM puts within the target DTE bucket.
            Try broadening the strike range or adjusting expiry parameters.
          </div>
        </div>
      ) : (
        <>
          {/* Comparison Cards Row */}
          <div style={S.cardsRow}>
            <BKMTenorCard
              label="30-DAY"
              bkm={bkm30}
              rv={va?.realized_vol_30d}
              physicalSkew={physicalSkew}
              physicalKurt={physicalKurt}
            />
            <BKMTenorCard
              label="60-DAY"
              bkm={bkm60}
              rv={va?.realized_vol_60d}
              physicalSkew={physicalSkew}
              physicalKurt={physicalKurt}
            />
          </div>

          {/* Key Insight Panel */}
          <InsightPanel
            bkm30={bkm30}
            bkm60={bkm60}
            physicalSkew={physicalSkew}
            physicalKurt={physicalKurt}
            rv30={va?.realized_vol_30d}
            rv60={va?.realized_vol_60d}
          />

          {/* Comparison Charts */}
          <div style={S.chartsRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SkewCompareChart
                bkm30={bkm30}
                bkm60={bkm60}
                physicalSkew={physicalSkew}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <VolCompareChart
                bkm30={bkm30}
                bkm60={bkm60}
                rv30={va?.realized_vol_30d}
                rv60={va?.realized_vol_60d}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function BKMTenorCard({ label, bkm, rv, physicalSkew, physicalKurt }) {
  if (!bkm) {
    return (
      <div style={{ ...S.tenorCard, opacity: 0.5 }}>
        <div style={S.tenorLabel}>{label}</div>
        <div style={S.tenorNoData}>Insufficient data</div>
      </div>
    )
  }

  const skewDiff = physicalSkew != null ? bkm.rn_skewness - physicalSkew : null
  const moreDownside = bkm.rn_skewness < (physicalSkew ?? 0)
  const kurtDiff = physicalKurt != null ? bkm.rn_kurtosis - physicalKurt : null
  const moreTail = bkm.rn_kurtosis > (physicalKurt ?? 0)

  return (
    <div style={S.tenorCard}>
      <div style={S.tenorLabel}>{label}</div>
      <div style={S.tenorHeader}>
        <span style={{ fontSize: 9, color: '#6b7280' }}>
          {bkm.n_contracts_used} contracts · avg {bkm.actual_dte_avg}d DTE
        </span>
      </div>

      {/* Side-by-side: RN vs Physical */}
      <div style={S.compareGrid}>
        <div style={S.colHeader}>RISK-NEUTRAL</div>
        <div style={S.colHeader}>PHYSICAL (GMM)</div>

        {/* Volatility */}
        <MomentRow
          label="Volatility"
          rnVal={fmt_pct(bkm.rn_volatility)}
          physVal={rv != null ? fmt_pct(rv) : 'N/A'}
          rnColor="#60a5fa"
          physColor="#22c55e"
        />

        {/* Skewness */}
        <MomentRow
          label="Skewness"
          rnVal={bkm.rn_skewness?.toFixed(3)}
          physVal={physicalSkew != null ? physicalSkew.toFixed(3) : 'N/A'}
          rnColor={moreDownside ? '#ef4444' : '#22c55e'}
          physColor="#d1d5db"
          badge={moreDownside ? '⚠ MKT PRICING MORE DOWNSIDE' : skewDiff != null && skewDiff > 0.1 ? '↑ MKT UPSIDE BIASED' : null}
          badgeColor={moreDownside ? '#ef4444' : '#f59e0b'}
        />

        {/* Kurtosis */}
        <MomentRow
          label="Kurtosis"
          rnVal={bkm.rn_kurtosis?.toFixed(3)}
          physVal={physicalKurt != null ? physicalKurt.toFixed(3) : 'N/A'}
          rnColor={moreTail ? '#f59e0b' : '#22c55e'}
          physColor="#d1d5db"
          badge={moreTail ? '🔥 FAT TAILS PRICED IN' : kurtDiff != null && kurtDiff < -0.5 ? '✓ TAILS UNDERPRICED' : null}
          badgeColor={moreTail ? '#f59e0b' : '#22c55e'}
        />

        {/* Variance */}
        <MomentRow
          label="Variance"
          rnVal={bkm.rn_variance?.toFixed(6)}
          physVal={rv != null ? (rv ** 2).toFixed(6) : 'N/A'}
          rnColor="#a78bfa"
          physColor="#d1d5db"
        />
      </div>
    </div>
  )
}

function MomentRow({ label, rnVal, physVal, rnColor, physColor, badge, badgeColor }) {
  return (
    <>
      <div style={S.momentLabel}>{label}</div>
      <div style={{ ...S.momentVal, color: rnColor }}>{rnVal}</div>
      <div style={{ ...S.momentVal, color: physColor }}>{physVal}</div>
      {badge ? (
        <div style={{ ...S.badge, borderColor: badgeColor, color: badgeColor }}>{badge}</div>
      ) : (
        <div />
      )}
    </>
  )
}

function InsightPanel({ bkm30, bkm60, physicalSkew, physicalKurt, rv30, rv60 }) {
  const insights = []

  if (bkm30) {
    if (bkm30.rn_skewness < (physicalSkew ?? 0) - 0.1) {
      insights.push({
        type: 'warning',
        icon: '⚠',
        text: `30d risk-neutral skewness (${bkm30.rn_skewness.toFixed(3)}) is significantly more negative than physical (${physicalSkew?.toFixed(3) ?? 'N/A'}). The market is pricing substantially more downside risk than the historical distribution suggests. Put protection may be expensive.`,
      })
    } else if (bkm30.rn_skewness > (physicalSkew ?? 0) + 0.1) {
      insights.push({
        type: 'tip',
        icon: '💡',
        text: `30d risk-neutral skewness (${bkm30.rn_skewness.toFixed(3)}) is less negative than physical (${physicalSkew?.toFixed(3) ?? 'N/A'}). Downside protection may be relatively cheap. Consider put spreads.`,
      })
    }

    if (rv30 && bkm30.rn_volatility) {
      const volDiff = bkm30.rn_volatility - rv30
      if (volDiff > 0.05) {
        insights.push({
          type: 'signal',
          icon: '📊',
          text: `30d BKM vol (${fmt_pct(bkm30.rn_volatility)}) exceeds realized vol (${fmt_pct(rv30)}) by ${fmt_pct(volDiff)}. Model-free VRP is elevated — consider selling premium.`,
        })
      }
    }
  }

  if (bkm60?.rn_kurtosis > (physicalKurt ?? 0) + 1.0) {
    insights.push({
      type: 'warning',
      icon: '🔥',
      text: `60d risk-neutral kurtosis (${bkm60.rn_kurtosis.toFixed(2)}) far exceeds physical (${physicalKurt?.toFixed(2) ?? 'N/A'}). Market is pricing significant tail events. Wing options are expensive.`,
    })
  }

  if (insights.length === 0) {
    insights.push({
      type: 'neutral',
      icon: '✓',
      text: 'Risk-neutral and physical moments are approximately aligned. No significant mispricing detected.',
    })
  }

  const colors = {
    warning: { bg: '#1a0f0f', border: '#ef4444', text: '#fca5a5' },
    tip: { bg: '#0a1a0f', border: '#22c55e', text: '#86efac' },
    signal: { bg: '#0f0f1a', border: '#a78bfa', text: '#c4b5fd' },
    neutral: { bg: '#111318', border: '#3b82f6', text: '#93c5fd' },
  }

  return (
    <div style={S.insightContainer}>
      <div style={S.insightTitle}>KEY INSIGHTS — RN vs Physical Mispricing</div>
      {insights.map((ins, i) => {
        const c = colors[ins.type]
        return (
          <div key={i} style={{ ...S.insightRow, background: c.bg, borderLeft: `3px solid ${c.border}` }}>
            <span style={{ fontSize: 14, marginRight: 8 }}>{ins.icon}</span>
            <span style={{ color: c.text, fontSize: 11, lineHeight: 1.5 }}>{ins.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function SkewCompareChart({ bkm30, bkm60, physicalSkew }) {
  const labels = []
  const rnVals = []
  const physVals = []

  if (bkm30) {
    labels.push('30d')
    rnVals.push(bkm30.rn_skewness)
    physVals.push(physicalSkew ?? 0)
  }
  if (bkm60) {
    labels.push('60d')
    rnVals.push(bkm60.rn_skewness)
    physVals.push(physicalSkew ?? 0)
  }

  if (labels.length === 0) return null

  return (
    <Plot
      data={[
        {
          type: 'bar', name: 'Risk-Neutral (BKM)', x: labels, y: rnVals,
          marker: { color: '#60a5fa', opacity: 0.9 },
        },
        {
          type: 'bar', name: 'Physical (GMM)', x: labels, y: physVals,
          marker: { color: '#22c55e', opacity: 0.7 },
        },
      ]}
      layout={{
        ...darkLayout('Skewness: Risk-Neutral vs Physical'),
        barmode: 'group', bargap: 0.3, bargroupgap: 0.15,
        xaxis: { ...darkAxis, title: { text: 'Tenor', font: { color: '#6b7280', size: 11, family: MONO } } },
        yaxis: { ...darkAxis, title: { text: 'Skewness', font: { color: '#6b7280', size: 11, family: MONO } } },
        margin: { l: 55, r: 15, t: 40, b: 50 },
        legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.22 },
        shapes: [{ type: 'line', x0: -0.5, x1: labels.length - 0.5, y0: 0, y1: 0, line: { color: '#4b5563', width: 1, dash: 'dash' } }],
      }}
      config={plotConfig}
      style={{ width: '100%', height: 320 }}
      useResizeHandler
    />
  )
}

function VolCompareChart({ bkm30, bkm60, rv30, rv60 }) {
  const labels = []
  const rnVols = []
  const rvVals = []

  if (bkm30) {
    labels.push('30d')
    rnVols.push((bkm30.rn_volatility || 0) * 100)
    rvVals.push((rv30 || 0) * 100)
  }
  if (bkm60) {
    labels.push('60d')
    rnVols.push((bkm60.rn_volatility || 0) * 100)
    rvVals.push((rv60 || 0) * 100)
  }

  if (labels.length === 0) return null

  return (
    <Plot
      data={[
        {
          type: 'bar', name: 'RN Vol (BKM)', x: labels, y: rnVols,
          marker: { color: '#a78bfa', opacity: 0.9 },
        },
        {
          type: 'bar', name: 'Realized Vol', x: labels, y: rvVals,
          marker: { color: '#22c55e', opacity: 0.7 },
        },
      ]}
      layout={{
        ...darkLayout('Volatility: Model-Free RN vs Realized'),
        barmode: 'group', bargap: 0.3, bargroupgap: 0.15,
        xaxis: { ...darkAxis, title: { text: 'Tenor', font: { color: '#6b7280', size: 11, family: MONO } } },
        yaxis: { ...darkAxis, title: { text: 'Vol %', font: { color: '#6b7280', size: 11, family: MONO } } },
        margin: { l: 55, r: 15, t: 40, b: 50 },
        legend: { font: { color: '#9ca3af', size: 9, family: MONO }, bgcolor: 'rgba(0,0,0,0)', orientation: 'h', y: -0.22 },
      }}
      config={plotConfig}
      style={{ width: '100%', height: 320 }}
      useResizeHandler
    />
  )
}

function fmt_pct(v) {
  if (v === null || v === undefined) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

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
  header: {
    padding: '12px 16px', background: '#0d0e12',
    borderBottom: '1px solid #1a1d25',
  },
  headerTitle: {
    fontSize: 12, fontWeight: 700, fontFamily: MONO,
    color: '#d1d5db', letterSpacing: 1.2,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  headerIcon: { fontSize: 16 },
  headerSub: {
    fontSize: 10, color: '#4b5563', fontFamily: MONO,
    marginTop: 3, fontStyle: 'italic',
  },
  empty: {
    padding: 60, textAlign: 'center', color: '#4b5563',
    fontFamily: MONO, fontSize: 12,
  },
  noData: {
    padding: 60, textAlign: 'center', display: 'flex',
    flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  noDataIcon: { fontSize: 36, color: '#1e2230' },
  noDataTitle: { fontSize: 14, color: '#6b7280', fontWeight: 500, fontFamily: DM },
  noDataSub: {
    fontSize: 11, color: '#4b5563', fontFamily: MONO,
    maxWidth: 400, lineHeight: 1.5,
  },
  cardsRow: {
    display: 'flex', gap: 1, padding: '8px 10px',
    background: '#0a0b0d', borderBottom: '1px solid #1a1d25',
  },
  tenorCard: {
    flex: 1, background: '#111318', borderRadius: 6,
    border: '1px solid #1a1d25', padding: '10px 14px',
  },
  tenorLabel: {
    fontSize: 11, fontWeight: 700, fontFamily: MONO,
    color: '#60a5fa', letterSpacing: 1.5, marginBottom: 4,
  },
  tenorHeader: { marginBottom: 10 },
  tenorNoData: {
    fontSize: 11, color: '#4b5563', fontFamily: MONO,
    padding: '20px 0', textAlign: 'center',
  },
  compareGrid: {
    display: 'grid',
    gridTemplateColumns: '80px 1fr 1fr auto',
    gap: '4px 8px', alignItems: 'center',
  },
  colHeader: {
    fontSize: 8, fontWeight: 700, fontFamily: MONO,
    color: '#4b5563', letterSpacing: 1.2, paddingBottom: 4,
    borderBottom: '1px solid #1a1d25',
  },
  momentLabel: {
    fontSize: 10, fontWeight: 600, fontFamily: MONO,
    color: '#6b7280',
  },
  momentVal: {
    fontSize: 13, fontWeight: 700, fontFamily: MONO,
    textAlign: 'right',
  },
  badge: {
    fontSize: 7, fontWeight: 700, fontFamily: MONO,
    letterSpacing: 0.5, padding: '2px 6px',
    borderRadius: 3, border: '1px solid',
    whiteSpace: 'nowrap',
  },
  insightContainer: {
    padding: '10px 14px', background: '#0d0e12',
    borderBottom: '1px solid #1a1d25',
  },
  insightTitle: {
    fontSize: 9, fontWeight: 700, fontFamily: MONO,
    color: '#4b5563', letterSpacing: 1.2, marginBottom: 8,
  },
  insightRow: {
    padding: '8px 12px', borderRadius: 4,
    marginBottom: 4, display: 'flex', alignItems: 'flex-start',
    fontFamily: MONO,
  },
  chartsRow: {
    display: 'flex', gap: 1,
    borderBottom: '1px solid #1a1d25',
  },
}
