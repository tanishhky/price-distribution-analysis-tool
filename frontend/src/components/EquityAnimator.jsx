/**
 * EquityAnimator.jsx — Animated equity curve replay.
 *
 * Renders the strategy's daily P&L as an animation:
 *   - Equity curve grows day-by-day
 *   - Regime background bands
 *   - Running P&L counter
 *   - Drawdown shading
 *   - Benchmark overlay
 *   - Speed controls (1x → 50x)
 *   - Scrub bar to jump to any date
 *
 * Data comes from strategyResult.daily_log (produced by strategy_engine.py)
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

const REGIME_COLORS = {
  0: { bg: 'rgba(239,68,68,0.08)', line: '#ef4444', name: 'Crisis' },
  1: { bg: 'rgba(245,158,11,0.08)', line: '#f59e0b', name: 'Stressed' },
  2: { bg: 'rgba(34,197,94,0.08)', line: '#22c55e', name: 'Bull' },
  3: { bg: 'rgba(99,102,241,0.08)', line: '#6366f1', name: 'Transition' },
}

function formatMoney(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

function formatPct(v) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(2)}%`
}

export default function EquityAnimator({ strategyResult }) {
  const canvasRef = useRef(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [showBenchmark, setShowBenchmark] = useState(true)
  const [showDrawdown, setShowDrawdown] = useState(true)
  const animRef = useRef(null)
  const lastTimeRef = useRef(0)

  const log = strategyResult?.daily_log || []
  const totalFrames = log.length
  const initialCapital = strategyResult?.config?.initial_capital || 100000

  // ── Derived data ──
  const { values, benchValues, maxVal, minVal, regimes, drawdowns, dates } = useMemo(() => {
    if (!log.length) return { values: [], benchValues: [], maxVal: 0, minVal: 0, regimes: [], drawdowns: [], dates: [] }
    const v = log.map(d => d.portfolio_value)
    const bv = log.map(d => d.benchmark_value)
    const d = log.map(d => d.date?.slice(0, 10))
    const r = log.map(d => d.regime)

    // Compute running drawdown
    let peak = v[0]
    const dd = v.map(val => {
      if (val > peak) peak = val
      return (val - peak) / peak
    })

    const allVals = [...v, ...bv.filter(x => x != null)]
    return {
      values: v,
      benchValues: bv,
      maxVal: Math.max(...allVals) * 1.02,
      minVal: Math.min(...allVals) * 0.98,
      regimes: r,
      drawdowns: dd,
      dates: d,
    }
  }, [log])

  // ── Animation loop ──
  const tick = useCallback((timestamp) => {
    if (!playing) return
    const elapsed = timestamp - lastTimeRef.current
    const interval = 1000 / (speed * 3) // speed=1 → ~3fps, speed=50 → ~150fps

    if (elapsed >= interval) {
      lastTimeRef.current = timestamp
      setFrame(prev => {
        if (prev >= totalFrames - 1) {
          setPlaying(false)
          return prev
        }
        return prev + 1
      })
    }
    animRef.current = requestAnimationFrame(tick)
  }, [playing, speed, totalFrames])

  useEffect(() => {
    if (playing) {
      lastTimeRef.current = performance.now()
      animRef.current = requestAnimationFrame(tick)
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [playing, tick])

  // ── Canvas draw ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !values.length) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    const PAD_L = 70, PAD_R = 20, PAD_T = 30, PAD_B = 50
    const plotW = W - PAD_L - PAD_R
    const plotH = H - PAD_T - PAD_B

    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#0a0b0d'
    ctx.fillRect(0, 0, W, H)

    const xScale = (i) => PAD_L + (i / Math.max(totalFrames - 1, 1)) * plotW
    const yScale = (v) => PAD_T + plotH - ((v - minVal) / (maxVal - minVal)) * plotH

    // ── Regime background bands ──
    let prevRegime = regimes[0]
    let bandStart = 0
    for (let i = 1; i <= frame; i++) {
      if (regimes[i] !== prevRegime || i === frame) {
        const rc = REGIME_COLORS[prevRegime] || REGIME_COLORS[3]
        ctx.fillStyle = rc.bg
        ctx.fillRect(xScale(bandStart), PAD_T, xScale(i) - xScale(bandStart), plotH)
        prevRegime = regimes[i]
        bandStart = i
      }
    }

    // ── Grid lines ──
    ctx.strokeStyle = '#1a1d25'
    ctx.lineWidth = 0.5
    const nGridY = 5
    for (let g = 0; g <= nGridY; g++) {
      const yVal = minVal + (g / nGridY) * (maxVal - minVal)
      const y = yScale(yVal)
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
      ctx.fillStyle = '#4b5563'
      ctx.font = `10px ${MONO}`
      ctx.textAlign = 'right'
      ctx.fillText(`$${formatMoney(yVal)}`, PAD_L - 6, y + 3)
    }

    // X-axis dates
    ctx.fillStyle = '#4b5563'
    ctx.font = `9px ${MONO}`
    ctx.textAlign = 'center'
    const dateStep = Math.max(1, Math.floor(totalFrames / 8))
    for (let i = 0; i < totalFrames; i += dateStep) {
      ctx.fillText(dates[i] || '', xScale(i), H - PAD_B + 20)
    }

    // ── Drawdown shading ──
    if (showDrawdown && frame > 0) {
      ctx.fillStyle = 'rgba(239,68,68,0.12)'
      ctx.beginPath()
      ctx.moveTo(xScale(0), yScale(values[0]))
      let runPeak = values[0]
      for (let i = 0; i <= frame; i++) {
        if (values[i] > runPeak) runPeak = values[i]
        ctx.lineTo(xScale(i), yScale(runPeak))
      }
      for (let i = frame; i >= 0; i--) {
        ctx.lineTo(xScale(i), yScale(values[i]))
      }
      ctx.closePath()
      ctx.fill()
    }

    // ── Benchmark line ──
    if (showBenchmark) {
      ctx.strokeStyle = '#6b728088'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      let started = false
      for (let i = 0; i <= frame; i++) {
        if (benchValues[i] == null) continue
        if (!started) { ctx.moveTo(xScale(i), yScale(benchValues[i])); started = true }
        else ctx.lineTo(xScale(i), yScale(benchValues[i]))
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── Strategy line ──
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(xScale(0), yScale(values[0]))
    for (let i = 1; i <= frame; i++) {
      ctx.lineTo(xScale(i), yScale(values[i]))
    }
    ctx.stroke()

    // ── Current point glow ──
    if (frame > 0 && frame < values.length) {
      const cx = xScale(frame), cy = yScale(values[frame])
      // Glow
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12)
      grad.addColorStop(0, 'rgba(59,130,246,0.6)')
      grad.addColorStop(1, 'rgba(59,130,246,0)')
      ctx.fillStyle = grad
      ctx.fillRect(cx - 12, cy - 12, 24, 24)
      // Dot
      ctx.fillStyle = '#3b82f6'
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill()
    }

    // ── Rebalance markers ──
    for (let i = 0; i <= frame; i++) {
      if (log[i]?.rebalanced) {
        const x = xScale(i)
        ctx.strokeStyle = '#ffffff22'
        ctx.lineWidth = 0.5
        ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + plotH); ctx.stroke()
      }
    }

  }, [frame, values, benchValues, maxVal, minVal, regimes, drawdowns, dates, showBenchmark, showDrawdown, totalFrames, log])

  // ── No data state ──
  if (!strategyResult || !log.length) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', minHeight: 400, color: '#4b5563',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>▶</div>
        <div style={{ fontSize: 14, fontFamily: DM, fontWeight: 500 }}>Equity Animator</div>
        <div style={{ fontSize: 11, fontFamily: MONO, color: '#374151', marginTop: 6, textAlign: 'center', maxWidth: 360 }}>
          Run a strategy in the STRATEGY tab first, then switch here to watch your P&L build day-by-day with zero look-ahead bias.
        </div>
      </div>
    )
  }

  const currentVal = values[frame] ?? initialCapital
  const benchVal = benchValues[frame]
  const pnl = currentVal - initialCapital
  const pnlPct = pnl / initialCapital
  const currentDD = drawdowns[frame] ?? 0
  const currentRegime = regimes[frame]
  const rc = REGIME_COLORS[currentRegime] || REGIME_COLORS[3]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Top: Live metrics ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid #1a1d25', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>PORTFOLIO</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: '#e5e7eb' }}>
              ${formatMoney(currentVal)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>P&L</div>
            <div style={{
              fontSize: 18, fontWeight: 700, fontFamily: MONO,
              color: pnl >= 0 ? '#4ade80' : '#f87171',
            }}>
              {pnl >= 0 ? '+' : ''}{formatPct(pnlPct)} ({pnl >= 0 ? '+' : ''}${formatMoney(pnl)})
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>DRAWDOWN</div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: MONO, color: currentDD < -0.05 ? '#f87171' : '#9ca3af' }}>
              {formatPct(currentDD)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>REGIME</div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: MONO, color: rc.line }}>
              {rc.name} (R{currentRegime ?? '?'})
            </div>
          </div>
          {benchVal != null && (
            <div>
              <div style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO }}>vs BENCH</div>
              <div style={{
                fontSize: 14, fontWeight: 600, fontFamily: MONO,
                color: currentVal > benchVal ? '#4ade80' : '#f87171',
              }}>
                {currentVal > benchVal ? '+' : ''}{formatPct((currentVal - benchVal) / benchVal)}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: '#6b7280' }}>
            {dates[frame] || '—'} ({frame + 1}/{totalFrames})
          </span>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 300 }}>
        <canvas
          ref={canvasRef}
          width={1200}
          height={500}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* ── Bottom: Controls ── */}
      <div style={{
        padding: '10px 16px', borderTop: '1px solid #1a1d25', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {/* Play/Pause */}
        <button onClick={() => {
          if (frame >= totalFrames - 1) setFrame(0)
          setPlaying(p => !p)
        }} style={{
          background: playing ? '#dc2626' : '#1d4ed8', color: '#fff',
          border: 'none', borderRadius: 4, padding: '6px 16px',
          fontFamily: MONO, fontWeight: 600, fontSize: 12, cursor: 'pointer',
        }}>
          {playing ? '⏸ Pause' : frame >= totalFrames - 1 ? '⟳ Replay' : '▶ Play'}
        </button>

        {/* Scrubber */}
        <input
          type="range" min={0} max={Math.max(totalFrames - 1, 0)} value={frame}
          onChange={e => { setFrame(+e.target.value); setPlaying(false) }}
          style={{ flex: 1, accentColor: '#3b82f6', cursor: 'pointer', height: 4 }}
        />

        {/* Speed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: '#6b7280' }}>Speed</span>
          {[1, 5, 10, 25, 50].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{
              background: speed === s ? '#1d4ed8' : '#151820',
              color: speed === s ? '#fff' : '#6b7280',
              border: `1px solid ${speed === s ? '#3b82f6' : '#1e2230'}`,
              borderRadius: 3, padding: '2px 6px', fontSize: 10,
              fontFamily: MONO, cursor: 'pointer',
            }}>
              {s}x
            </button>
          ))}
        </div>

        {/* Toggles */}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, fontFamily: MONO, color: '#6b7280' }}>
            <input type="checkbox" checked={showBenchmark} onChange={e => setShowBenchmark(e.target.checked)}
              style={{ accentColor: '#6b7280' }} />
            Bench
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, fontFamily: MONO, color: '#6b7280' }}>
            <input type="checkbox" checked={showDrawdown} onChange={e => setShowDrawdown(e.target.checked)}
              style={{ accentColor: '#ef4444' }} />
            DD
          </label>
        </div>

        {/* Jump buttons */}
        <button onClick={() => { setFrame(0); setPlaying(false) }} style={ctrlBtn}>⏮</button>
        <button onClick={() => { setFrame(totalFrames - 1); setPlaying(false) }} style={ctrlBtn}>⏭</button>
      </div>
    </div>
  )
}

const ctrlBtn = {
  background: '#151820', border: '1px solid #1e2230', borderRadius: 3,
  color: '#6b7280', padding: '4px 8px', fontSize: 12, cursor: 'pointer',
  fontFamily: MONO,
}
