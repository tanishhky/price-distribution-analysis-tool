import { useState } from 'react'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

const TYPE_ICONS = {
  vol_crush: '🔥', skew_trade: '📐', calendar: '📅',
  mean_reversion: '🎯', gamma_scalp: '⚡',
}
const TYPE_COLORS = {
  vol_crush: '#ef4444', skew_trade: '#f59e0b', calendar: '#3b82f6',
  mean_reversion: '#22c55e', gamma_scalp: '#a78bfa',
}
const CONVICTION_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }

export default function SignalsPanel({ signals, summaryText }) {
  const [expanded, setExpanded] = useState({})
  const [copied, setCopied] = useState(false)

  if (!signals && !summaryText) return null

  const toggle = (i) => setExpanded(p => ({ ...p, [i]: !p[i] }))

  const handleCopy = () => {
    navigator.clipboard.writeText(summaryText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={S.container}>
      {/* Signals */}
      {signals && signals.length > 0 && (
        <div style={S.signalsSection}>
          <div style={S.header}>
            <span style={S.headerTitle}>TRADE SIGNALS</span>
            <span style={S.headerCount}>{signals.length} opportunities</span>
          </div>

          {signals.map((s, i) => (
            <div key={i} style={S.card} onClick={() => toggle(i)}>
              <div style={S.cardTop}>
                <span style={S.icon}>{TYPE_ICONS[s.signal_type] || '◈'}</span>
                <div style={{ flex: 1 }}>
                  <div style={S.strategy}>{s.strategy}</div>
                  <div style={S.signalType}>{s.signal_type.replace('_', ' ')} · {s.direction.replace('_', ' ')}</div>
                </div>
                <span style={{ ...S.badge, background: CONVICTION_COLORS[s.conviction] + '20', color: CONVICTION_COLORS[s.conviction], borderColor: CONVICTION_COLORS[s.conviction] + '40' }}>
                  {s.conviction.toUpperCase()}
                </span>
              </div>

              <div style={S.desc}>{s.description}</div>

              {/* Quick metrics */}
              <div style={S.quickMetrics}>
                {s.max_profit != null && <QuickMetric label="Max Profit" value={`$${s.max_profit.toFixed(0)}`} color="#22c55e" />}
                {s.max_loss != null && <QuickMetric label="Max Loss" value={`$${s.max_loss.toFixed(0)}`} color="#ef4444" />}
                {s.probability_of_profit != null && <QuickMetric label="P(Profit)" value={`${(s.probability_of_profit * 100).toFixed(0)}%`} color="#60a5fa" />}
                {s.risk_reward_ratio != null && <QuickMetric label="R/R Ratio" value={s.risk_reward_ratio.toFixed(2)} color="#f59e0b" />}
                {s.net_delta != null && <QuickMetric label="Net Δ" value={s.net_delta.toFixed(3)} color="#d1d5db" />}
              </div>

              {/* Expanded detail */}
              {expanded[i] && (
                <div style={S.expandedSection}>
                  <div style={S.rationale}>{s.rationale}</div>

                  {s.legs?.length > 0 && (
                    <div style={S.legsSection}>
                      <div style={S.legsTitle}>LEGS</div>
                      {s.legs.map((leg, li) => (
                        <div key={li} style={S.leg}>
                          <span style={{ ...S.legAction, color: leg.action === 'BUY' ? '#22c55e' : '#ef4444' }}>
                            {leg.action}
                          </span>
                          <span style={S.legContract}>{leg.contract}</span>
                          <span style={S.legDetail}>${leg.strike?.toFixed(0)} {leg.type}</span>
                          {leg.mid != null && <span style={S.legDetail}>@ ${leg.mid.toFixed(2)}</span>}
                          {leg.iv != null && <span style={{ ...S.legDetail, color: '#f59e0b' }}>IV: {(leg.iv * 100).toFixed(1)}%</span>}
                          {leg.delta != null && <span style={S.legDetail}>Δ {leg.delta.toFixed(3)}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Position Greeks */}
                  <div style={S.greeksRow}>
                    {s.net_delta != null && <span style={S.greek}>Δ {s.net_delta.toFixed(3)}</span>}
                    {s.net_gamma != null && <span style={S.greek}>Γ {s.net_gamma.toFixed(4)}</span>}
                    {s.net_theta != null && <span style={S.greek}>Θ {s.net_theta.toFixed(3)}</span>}
                    {s.net_vega != null && <span style={S.greek}>ν {s.net_vega.toFixed(3)}</span>}
                    {s.breakeven_low != null && <span style={S.greek}>BE: ${s.breakeven_low.toFixed(2)}</span>}
                    {s.breakeven_high != null && <span style={S.greek}>– ${s.breakeven_high.toFixed(2)}</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Summary text */}
      {summaryText && (
        <div style={S.summarySection}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={S.summaryTitle}>RAW ANALYSIS OUTPUT</span>
            <button onClick={handleCopy} style={S.copyBtn}>
              {copied ? '✓ Copied' : '⎘ Copy'}
            </button>
          </div>
          <pre style={S.pre}>{summaryText}</pre>
        </div>
      )}

      {(!signals || signals.length === 0) && !summaryText && (
        <div style={S.empty}>No signals generated. Run volatility analysis first.</div>
      )}
    </div>
  )
}

function QuickMetric({ label, value, color }) {
  return (
    <div style={S.qm}>
      <span style={S.qmLabel}>{label}</span>
      <span style={{ ...S.qmValue, color }}>{value}</span>
    </div>
  )
}

const S = {
  container: { padding: 0 },
  signalsSection: { borderBottom: '1px solid #1a1d25' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#0d0e12', borderBottom: '1px solid #1a1d25',
  },
  headerTitle: { fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: 1.2, fontFamily: MONO },
  headerCount: { fontSize: 11, color: '#4b5563', fontFamily: MONO },
  card: {
    padding: '12px 14px', borderBottom: '1px solid #141720',
    cursor: 'pointer', transition: 'background 0.1s',
  },
  cardTop: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  icon: { fontSize: 20, marginTop: 2 },
  strategy: { fontSize: 13, fontWeight: 600, color: '#e5e7eb', fontFamily: DM },
  signalType: { fontSize: 10, color: '#6b7280', fontFamily: MONO, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: {
    fontSize: 9, fontWeight: 700, fontFamily: MONO, padding: '2px 8px',
    borderRadius: 3, letterSpacing: 1, border: '1px solid', whiteSpace: 'nowrap',
  },
  desc: { fontSize: 12, color: '#9ca3af', marginTop: 8, lineHeight: 1.5, fontFamily: DM },
  quickMetrics: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  qm: { display: 'flex', flexDirection: 'column', gap: 1 },
  qmLabel: { fontSize: 9, color: '#4b5563', fontFamily: MONO, letterSpacing: 0.5 },
  qmValue: { fontSize: 13, fontWeight: 700, fontFamily: MONO },
  expandedSection: { marginTop: 12, padding: '10px 0 0', borderTop: '1px dashed #1a1d25' },
  rationale: { fontSize: 11, color: '#9ca3af', lineHeight: 1.6, fontFamily: DM, marginBottom: 10 },
  legsSection: { marginTop: 8 },
  legsTitle: { fontSize: 9, fontWeight: 700, color: '#4b5563', fontFamily: MONO, letterSpacing: 1, marginBottom: 6 },
  leg: {
    display: 'flex', gap: 10, alignItems: 'center', padding: '4px 8px',
    background: '#111318', borderRadius: 3, marginBottom: 3, fontSize: 11, fontFamily: MONO,
  },
  legAction: { fontWeight: 700, fontSize: 10, minWidth: 32 },
  legContract: { color: '#60a5fa', fontSize: 10, flex: 1 },
  legDetail: { color: '#6b7280', fontSize: 10 },
  greeksRow: {
    display: 'flex', gap: 12, marginTop: 8, padding: '6px 8px',
    background: '#0d0e12', borderRadius: 3,
  },
  greek: { fontSize: 10, color: '#9ca3af', fontFamily: MONO },
  summarySection: { padding: '14px' },
  summaryTitle: { fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: 1.2, fontFamily: MONO },
  copyBtn: {
    background: '#1a1d25', border: '1px solid #2a2d35', borderRadius: 3,
    color: '#9ca3af', padding: '3px 10px', fontSize: 10, cursor: 'pointer',
    fontFamily: MONO,
  },
  pre: {
    background: '#0a0b0d', color: '#86efac', padding: 14, borderRadius: 4,
    fontSize: 10, overflowX: 'auto', fontFamily: MONO, lineHeight: 1.6,
    maxHeight: 400, overflowY: 'auto', border: '1px solid #1a1d25', whiteSpace: 'pre',
  },
  empty: { padding: 40, textAlign: 'center', color: '#4b5563', fontFamily: MONO, fontSize: 12 },
}
