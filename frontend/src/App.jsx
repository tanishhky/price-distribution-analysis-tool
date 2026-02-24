import { useState } from 'react'
import Controls from './components/Controls'
import CandlestickChart from './components/CandlestickChart'
import DistributionChart from './components/DistributionChart'
import GMMChart from './components/GMMChart'
import ComparisonChart from './components/ComparisonChart'
import ResultsPanel from './components/ResultsPanel'
import VolatilityPanel from './components/VolatilityPanel'
import SignalsPanel from './components/SignalsPanel'
import { fetchCandles, analyzeData, runVolatilityAnalysis, reprocessVolatility } from './api'

const H = 340

export default function App() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [candles, setCandles] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [volData, setVolData] = useState(null)
  const [activeTab, setActiveTab] = useState('charts')
  // Store params for vol analysis
  const [lastParams, setLastParams] = useState(null)
  // Cached data for reprocessing
  const [cachedContracts, setCachedContracts] = useState(null)
  const [cachedBars, setCachedBars] = useState(null)

  const setErr = (msg) => setStatus({ type: 'error', message: msg })
  const setInfo = (msg) => setStatus({ type: 'info', message: msg })
  const setOk = (msg) => setStatus({ type: 'success', message: msg })

  const handleFetchAndAnalyze = async (params) => {
    setLoading(true)
    setStatus(null); setCandles(null); setAnalysis(null); setVolData(null)
    try {
      setInfo('Fetching candles from Polygon.io…')
      const fetchResult = await fetchCandles({
        api_key: params.api_key, ticker: params.ticker, asset_class: params.asset_class,
        timeframe: params.timeframe, start_date: params.start_date, end_date: params.end_date,
      })
      setCandles(fetchResult.candles)
      setLastParams({ ...params, fetchResult })
      setInfo(`${fetchResult.total_candles} candles. Running GMM analysis…`)

      const analysisResult = await analyzeData({
        ticker: fetchResult.ticker, asset_class: fetchResult.asset_class,
        timeframe: fetchResult.timeframe, start_date: fetchResult.start_date,
        end_date: fetchResult.end_date, candles: fetchResult.candles,
        num_bins: params.num_bins, n_components_override: params.n_components_override,
      })
      setAnalysis(analysisResult)
      setOk(`GMM complete — D1: ${analysisResult.gmm_d1.n_components}, D2: ${analysisResult.gmm_d2.n_components} components`)
    } catch (err) { setErr(err.message) }
    finally { setLoading(false) }
  }

  const handleRunVolatility = async (volParams) => {
    if (!candles || !analysis) {
      return setErr('Run Fetch & Analyze first to load underlying data.')
    }
    setLoading(true)
    setVolData(null)
    try {
      setInfo('Fetching options chain & computing Black-Scholes greeks…')
      const spot = candles[candles.length - 1].close
      const result = await runVolatilityAnalysis({
        api_key: volParams.api_key,
        ticker: volParams.ticker,
        candles: candles,
        spot_price: spot,
        timeframe: lastParams?.fetchResult?.timeframe || '1day',
        asset_class: lastParams?.fetchResult?.asset_class || 'stocks',
        gmm_d2: analysis.gmm_d2,
        risk_free_rate: volParams.risk_free_rate,
        dividend_yield: volParams.dividend_yield,
        strike_range_pct: volParams.strike_range_pct,
      })
      setVolData(result)
      // Cache the raw data for reprocessing
      setCachedContracts(result.cached_contracts || null)
      setCachedBars(result.cached_bars || null)
      const nSignals = result.trade_signals?.length || 0
      const nContracts = result.volatility_analysis?.chain?.length || 0
      setOk(`Vol analysis complete — ${nContracts} contracts, ${nSignals} signals`)
      setActiveTab('volatility')
    } catch (err) { setErr(err.message) }
    finally { setLoading(false) }
  }

  const handleReprocess = async (reprocessParams) => {
    if (!candles || !analysis || !cachedContracts || !cachedBars) {
      return setErr('No cached data available. Run Vol Analysis first.')
    }
    setLoading(true)
    setVolData(null)
    try {
      setInfo('Reprocessing with updated parameters (no API calls)…')
      const spot = candles[candles.length - 1].close
      const result = await reprocessVolatility({
        ticker: analysis.ticker,
        candles: candles,
        spot_price: spot,
        timeframe: lastParams?.fetchResult?.timeframe || '1day',
        asset_class: lastParams?.fetchResult?.asset_class || 'stocks',
        gmm_d2: analysis.gmm_d2,
        risk_free_rate: reprocessParams.risk_free_rate,
        dividend_yield: reprocessParams.dividend_yield,
        strike_range_pct: reprocessParams.strike_range_pct,
        cached_contracts: cachedContracts,
        cached_bars: cachedBars,
      })
      setVolData(result)
      setCachedContracts(result.cached_contracts || cachedContracts)
      setCachedBars(result.cached_bars || cachedBars)
      const nSignals = result.trade_signals?.length || 0
      const nContracts = result.volatility_analysis?.chain?.length || 0
      setOk(`Reprocessed — ${nContracts} contracts, ${nSignals} signals (no API calls)`)
      setActiveTab('volatility')
    } catch (err) { setErr(err.message) }
    finally { setLoading(false) }
  }

  const TABS = [
    { id: 'charts', label: 'CHARTS', icon: '▤' },
    { id: 'profile', label: 'PROFILE', icon: '▥' },
    { id: 'volatility', label: 'VOL', icon: '◈', accent: true },
    { id: 'signals', label: 'SIGNALS', icon: '⚡', accent: true },
    { id: 'results', label: 'DATA', icon: '≡' },
  ]

  return (
    <div style={S.root}>
      <Controls
        onFetchAndAnalyze={handleFetchAndAnalyze}
        onRunVolatility={handleRunVolatility}
        onReprocess={handleReprocess}
        hasVolCache={!!(cachedContracts && cachedBars)}
        loading={loading}
        status={status}
      />

      <div style={S.main}>
        {/* Tab bar */}
        <div style={S.topBar}>
          <div style={S.tabs}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ ...S.tab, ...(activeTab === t.id ? S.tabActive : {}), ...(t.accent && activeTab === t.id ? S.tabAccent : {}) }}>
                <span style={S.tabIcon}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div style={S.statusIndicator}>
            {analysis && <span style={S.dot} title="GMM loaded" />}
            {volData && <span style={{ ...S.dot, background: '#a78bfa' }} title="Vol loaded" />}
            <span style={S.tickerBadge}>{analysis?.ticker || '—'}</span>
          </div>
        </div>

        {/* Content */}
        <div style={S.content}>
          {!analysis && !loading && (
            <div style={S.placeholder}>
              <div style={S.placeholderIcon}>◈</div>
              <div style={S.placeholderTitle}>VolEdge Trading System</div>
              <div style={S.placeholderSub}>Enter parameters and run Fetch & Analyze</div>
              <div style={S.placeholderHint}>Supports US Equities · Crypto · Forex</div>
            </div>
          )}

          {loading && (
            <div style={S.placeholder}>
              <div style={{ ...S.placeholderIcon, animation: 'none' }}>⟳</div>
              <div style={S.placeholderTitle}>{status?.message || 'Processing…'}</div>
            </div>
          )}

          {analysis && !loading && (
            <>
              {activeTab === 'charts' && (
                <div style={S.grid}>
                  <div style={{ ...S.cell, height: 300 }}>
                    <CandlestickChart candles={candles} ticker={analysis.ticker} />
                  </div>
                  <div style={{ ...S.cell, height: H }}>
                    <GMMChart dist={analysis.d1} gmm={analysis.gmm_d1} label="D1: Time-at-Price" distKey="d1" height={H} />
                  </div>
                  <div style={{ ...S.cell, height: H }}>
                    <GMMChart dist={analysis.d2} gmm={analysis.gmm_d2} label="D2: Volume-Weighted" distKey="d2" height={H} />
                  </div>
                  <div style={{ ...S.cell, height: H }}>
                    <ComparisonChart d1={analysis.d1} d2={analysis.d2} gmmD1={analysis.gmm_d1} gmmD2={analysis.gmm_d2} height={H} />
                  </div>
                </div>
              )}

              {activeTab === 'profile' && (
                <div style={S.grid}>
                  <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1a1d25', height: 320 }}>
                    <div style={{ flex: 2, minWidth: 0 }}>
                      <CandlestickChart candles={candles} ticker={analysis.ticker} />
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <DistributionChart dist={analysis.d1} label="D1" distKey="d1" orientation="horizontal" height={320} />
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <DistributionChart dist={analysis.d2} label="D2" distKey="d2" orientation="horizontal" height={320} />
                    </div>
                  </div>
                  <div style={S.cell}>
                    <DistributionChart dist={analysis.d1} label="D1: Time-at-Price" distKey="d1" height={H} />
                  </div>
                  <div style={S.cell}>
                    <DistributionChart dist={analysis.d2} label="D2: Volume-Weighted" distKey="d2" height={H} />
                  </div>
                </div>
              )}

              {activeTab === 'volatility' && (
                volData
                  ? <VolatilityPanel volData={volData} />
                  : <div style={S.placeholder}>
                    <div style={S.placeholderIcon}>◈</div>
                    <div style={S.placeholderTitle}>Run Vol Analysis</div>
                    <div style={S.placeholderSub}>Click "◈ Run Vol Analysis" in the sidebar to compute IV surface, greeks, and trade signals</div>
                  </div>
              )}

              {activeTab === 'signals' && (
                volData
                  ? <SignalsPanel signals={volData.trade_signals} summaryText={volData.summary_text} />
                  : <div style={S.placeholder}>
                    <div style={S.placeholderIcon}>⚡</div>
                    <div style={S.placeholderTitle}>No Signals Yet</div>
                    <div style={S.placeholderSub}>Run volatility analysis to generate trade signals</div>
                  </div>
              )}

              {activeTab === 'results' && (
                <ResultsPanel resultsText={analysis.results_text} analysisData={analysis} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const MONO = "'JetBrains Mono', monospace"
const DM = "'DM Sans', sans-serif"

const S = {
  root: {
    display: 'flex', height: '100vh', background: '#0a0b0d',
    color: '#e5e7eb', fontFamily: DM, overflow: 'hidden',
  },
  main: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0,
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px', height: 38, background: '#0d0e12',
    borderBottom: '1px solid #1a1d25', flexShrink: 0,
  },
  tabs: { display: 'flex', gap: 2, height: '100%', alignItems: 'stretch' },
  tab: {
    background: 'transparent', border: 'none', borderBottom: '2px solid transparent',
    color: '#6b7280', padding: '0 12px', fontSize: 10, cursor: 'pointer',
    fontFamily: MONO, fontWeight: 600, letterSpacing: 0.8,
    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.12s',
  },
  tabActive: { color: '#e5e7eb', borderBottomColor: '#3b82f6' },
  tabAccent: { borderBottomColor: '#a78bfa' },
  tabIcon: { fontSize: 12 },
  statusIndicator: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#22c55e' },
  tickerBadge: {
    fontSize: 10, fontFamily: MONO, color: '#9ca3af', fontWeight: 600,
    background: '#151820', padding: '2px 8px', borderRadius: 3, border: '1px solid #1e2230',
  },
  content: { flex: 1, overflowY: 'auto' },
  placeholder: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', minHeight: 400,
  },
  placeholderIcon: { fontSize: 36, color: '#1e2230', marginBottom: 16 },
  placeholderTitle: { fontSize: 16, color: '#6b7280', fontWeight: 500, fontFamily: DM },
  placeholderSub: { fontSize: 12, color: '#4b5563', marginTop: 6, fontFamily: MONO, textAlign: 'center', maxWidth: 380 },
  placeholderHint: { fontSize: 11, color: '#2a2d35', marginTop: 12, fontFamily: MONO },
  grid: { display: 'flex', flexDirection: 'column', gap: 0 },
  cell: { borderBottom: '1px solid #1a1d25', padding: '2px 4px' },
}
