import { useState, useRef, useCallback } from 'react'
import Controls from './components/Controls'
import CandlestickChart from './components/CandlestickChart'
import DistributionChart from './components/DistributionChart'
import GMMChart from './components/GMMChart'
import ComparisonChart from './components/ComparisonChart'
import ResultsPanel from './components/ResultsPanel'
import VolatilityPanel from './components/VolatilityPanel'
import SignalsPanel from './components/SignalsPanel'
import MergePanel from './components/MergePanel'
import MomentsChart from './components/MomentsChart'
import SettingsModal, { useSettings } from './components/SettingsModal'
import { fetchCandles, analyzeData, runVolatilityAnalysis, reprocessVolatility } from './api'
import StrategyPanel from './components/StrategyPanel'
import EquityAnimator from './components/EquityAnimator'
import TearsheetPanel from './components/TearsheetPanel'
import ComparePanel from './components/ComparePanel'
import SensitivityPanel from './components/SensitivityPanel'
import WfoPanel from './components/WfoPanel'
import LibraryPanel from './components/LibraryPanel'

const H = 340

export default function App() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [candles, setCandles] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [volData, setVolData] = useState(null)
  const [activeTab, setActiveTab] = useState('charts')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, updateSettings, resetSettings] = useSettings()
  const [strategyResult, setStrategyResult] = useState(null)
  const [strategyHistory, setStrategyHistory] = useState([])
  const [loadedStrategy, setLoadedStrategy] = useState(null)
  // Sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isDragging = useRef(false)
  // Store params for vol analysis
  const [lastParams, setLastParams] = useState(null)
  // Cached data for reprocessing
  const [cachedContracts, setCachedContracts] = useState(null)
  const [cachedBars, setCachedBars] = useState(null)

  // FIX v3.1: Track current GMM params so cache upload uses them consistently
  const gmmParamsRef = useRef({ num_bins: 200, n_components_override: null, sync_gmm: false })

  const setErr = (msg) => setStatus({ type: 'error', message: msg })
  const setInfo = (msg) => setStatus({ type: 'info', message: msg })
  const setOk = (msg) => setStatus({ type: 'success', message: msg })

  // Called by Controls whenever GMM params change
  const handleGmmParamsChange = (params) => {
    gmmParamsRef.current = params
  }

  const handleFetchAndAnalyze = async (params) => {
    setLoading(true)
    setStatus(null); setCandles(null); setAnalysis(null); setVolData(null)
    try {
      setInfo('Fetching candles from Polygon.io…')
      const fetchResult = await fetchCandles({
        api_keys: params.api_keys, ticker: params.ticker, asset_class: params.asset_class,
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
        sync_gmm: params.sync_gmm || false,
        moment_window_ratio: settings.moment_window_ratio,
        moment_step_ratio: settings.moment_step_ratio,
      })
      setAnalysis(analysisResult)
      setOk(`GMM complete — D1: ${analysisResult.gmm_d1.n_components}, D2: ${analysisResult.gmm_d2.n_components} components`)
    } catch (err) { setErr(err?.message || String(err)) }
    finally { setLoading(false) }
  }

  const handleReAnalyze = async (params) => {
    if (!candles || !lastParams?.fetchResult) {
      return setErr('No candles loaded. Run Fetch & Analyze first.')
    }
    setLoading(true)
    setAnalysis(null); setVolData(null)
    try {
      const fr = lastParams.fetchResult
      setInfo(`Re-analyzing ${candles.length} candles with GMM N=${params.n_components_override || 'Auto'}…`)
      const analysisResult = await analyzeData({
        ticker: fr.ticker, asset_class: fr.asset_class,
        timeframe: fr.timeframe, start_date: fr.start_date,
        end_date: fr.end_date, candles: candles,
        num_bins: params.num_bins, n_components_override: params.n_components_override,
        sync_gmm: params.sync_gmm || false,
        moment_window_ratio: settings.moment_window_ratio,
        moment_step_ratio: settings.moment_step_ratio,
      })
      setAnalysis(analysisResult)
      setLastParams(prev => ({ ...prev, num_bins: params.num_bins, n_components_override: params.n_components_override }))
      setOk(`Re-analysis complete — D1: ${analysisResult.gmm_d1.n_components}, D2: ${analysisResult.gmm_d2.n_components} components`)
    } catch (err) { setErr(err?.message || String(err)) }
    finally { setLoading(false) }
  }

  const handleRunVolatility = async (volParams) => {
    if (!candles || !analysis) {
      return setErr('Run Fetch & Analyze first to load underlying data.')
    }
    setLoading(true)
    setVolData(null)
    try {
      // Use the ticker from the actual fetched data, not the Controls input
      // (user may have changed the input after fetching)
      const effectiveTicker = lastParams?.fetchResult?.ticker || volParams.ticker
      setInfo(`Fetching options chain for ${effectiveTicker}…`)
      const spot = candles[candles.length - 1].close
      const result = await runVolatilityAnalysis({
        api_keys: volParams.api_keys,
        ticker: effectiveTicker,
        candles: candles,
        spot_price: spot,
        timeframe: lastParams?.fetchResult?.timeframe || '1day',
        asset_class: lastParams?.fetchResult?.asset_class || 'stocks',
        gmm_d2: analysis.gmm_d2,
        risk_free_rate: volParams.risk_free_rate,
        dividend_yield: volParams.dividend_yield,
        strike_range_pct: volParams.strike_range_pct,
        near_expiry_min_days: settings.near_expiry_min_days,
        near_expiry_max_days: settings.near_expiry_max_days,
        far_expiry_min_days: settings.far_expiry_min_days,
        far_expiry_max_days: settings.far_expiry_max_days,
        batch_size: settings.batch_size,
        batch_delay: settings.batch_delay,
      })
      setVolData(result)
      setCachedContracts(result.cached_contracts || null)
      setCachedBars(result.cached_bars || null)
      const nSignals = result.trade_signals?.length || 0
      const nContracts = result.volatility_analysis?.chain?.length || 0
      setOk(`Vol analysis complete — ${nContracts} contracts, ${nSignals} signals`)
      setActiveTab('volatility')
    } catch (err) { setErr(err?.message || String(err)) }
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
    } catch (err) { setErr(err?.message || String(err)) }
    finally { setLoading(false) }
  }

  const handleDownloadCache = () => {
    if (!candles) {
      return setErr('No data to download. Run Fetch & Analyze first.')
    }
    // FIX v3.1: Cache file stores ONLY raw data — no computed analysis
    const payload = {
      _version: 3,
      ticker: lastParams?.fetchResult?.ticker || analysis?.ticker || 'UNKNOWN',
      timeframe: lastParams?.fetchResult?.timeframe || '1day',
      asset_class: lastParams?.fetchResult?.asset_class || 'stocks',
      start_date: lastParams?.fetchResult?.start_date || '',
      end_date: lastParams?.fetchResult?.end_date || '',
      candles,
      cached_contracts: cachedContracts || [],
      cached_bars: cachedBars || {},
      saved_at: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voledge_${payload.ticker}_${payload.timeframe}_${payload.start_date}_${payload.end_date}.json`
    a.click()
    URL.revokeObjectURL(url)
    setOk(`Cache exported — raw data only (${(blob.size / 1024).toFixed(0)} KB)`)
  }

  const handleUploadCache = async (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.candles) {
          return setErr('Invalid cache file — missing candles.')
        }
        // Restore raw data
        setCandles(data.candles)
        setCachedContracts(data.cached_contracts || null)
        setCachedBars(data.cached_bars || null)
        setLastParams(prev => ({
          ...prev,
          fetchResult: {
            ticker: data.ticker || 'UNKNOWN',
            asset_class: data.asset_class || 'stocks',
            timeframe: data.timeframe || '1day',
            start_date: data.start_date || '',
            end_date: data.end_date || '',
          },
        }))

        // FIX v3.1: Auto re-analyze using CURRENT sidebar GMM params (not hardcoded)
        const gmmP = gmmParamsRef.current
        setLoading(true)
        setInfo(`Cache loaded: ${data.ticker}. Re-computing GMM analysis (N=${gmmP.n_components_override || 'Auto'}, Sync=${gmmP.sync_gmm})…`)
        try {
          const analysisResult = await analyzeData({
            ticker: data.ticker || 'UNKNOWN',
            asset_class: data.asset_class || 'stocks',
            timeframe: data.timeframe || '1day',
            start_date: data.start_date || '',
            end_date: data.end_date || '',
            candles: data.candles,
            num_bins: gmmP.num_bins,
            n_components_override: gmmP.n_components_override,
            sync_gmm: gmmP.sync_gmm,
          })
          setAnalysis(analysisResult)

          // Auto reprocess vol if contracts+bars exist
          if (data.cached_contracts?.length > 0 && data.cached_bars && Object.keys(data.cached_bars).length > 0) {
            setInfo('Re-computing volatility analysis from cached data…')
            const spot = data.candles[data.candles.length - 1].close
            const volResult = await reprocessVolatility({
              ticker: data.ticker || 'UNKNOWN',
              candles: data.candles,
              spot_price: spot,
              timeframe: data.timeframe || '1day',
              asset_class: data.asset_class || 'stocks',
              gmm_d2: analysisResult.gmm_d2,
              risk_free_rate: 0.05,
              dividend_yield: 0.0,
              strike_range_pct: 0.15,
              cached_contracts: data.cached_contracts,
              cached_bars: data.cached_bars,
            })
            setVolData(volResult)
            setOk(`Cache restored: ${data.ticker} — GMM + Vol recomputed (${data.cached_contracts.length} contracts)`)
          } else {
            setOk(`Cache restored: ${data.ticker} — GMM recomputed (${data.candles.length} candles)`)
          }
        } catch (err) {
          setErr(`Cache loaded but analysis failed: ${err.message}`)
        } finally {
          setLoading(false)
        }
      } catch { setErr('Failed to parse cache file.') }
    }
    reader.readAsText(file)
  }

  const TABS = [
    { id: 'charts', label: 'CHARTS', icon: '▤' },
    { id: 'profile', label: 'PROFILE', icon: '▥' },
    { id: 'volatility', label: 'VOL', icon: '◈', accent: true },
    { id: 'signals', label: 'SIGNALS', icon: '⚡', accent: true },
    { id: 'results', label: 'DATA', icon: '≡' },
    { id: 'moments', label: 'MOMENTS', icon: '📈' },
    { id: 'strategy', label: 'STRATEGY', icon: '⚗', accent: true },
    { id: 'library', label: 'LIBRARY', icon: '📚' },
    { id: 'tearsheet', label: 'TEARSHEET', icon: '📊', accent: true },
    { id: 'compare', label: 'COMPARE', icon: '⚖' },
    { id: 'sensitivity', label: 'SENSITIVITY', icon: '🎛', accent: true },
    { id: 'wfo', label: 'WFO', icon: '🚶‍♂️', accent: true },
    { id: 'animate', label: 'ANIMATE', icon: '▶', accent: true },
    { id: 'merge', label: 'MERGE', icon: '⊕' },
  ]

  const handleDragStart = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    const onMove = (ev) => {
      if (!isDragging.current) return
      const newW = Math.min(450, Math.max(200, ev.clientX))
      setSidebarWidth(newW)
    }
    const onUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div style={S.root}>
      <Controls
        onFetchAndAnalyze={handleFetchAndAnalyze}
        onReAnalyze={handleReAnalyze}
        onRunVolatility={handleRunVolatility}
        onReprocess={handleReprocess}
        onDownloadCache={handleDownloadCache}
        onUploadCache={handleUploadCache}
        onGmmParamsChange={handleGmmParamsChange}
        hasCandles={!!candles}
        hasVolCache={!!(cachedContracts && cachedBars)}
        loading={loading}
        status={status}
        sidebarWidth={sidebarWidth}
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(p => !p)}
        maxGmmComponents={settings.max_gmm_components}
      />

      {/* Drag handle for resize */}
      {!sidebarCollapsed && (
        <div onMouseDown={handleDragStart}
          style={{
            width: 4, cursor: 'col-resize', background: 'transparent',
            flexShrink: 0, position: 'relative', zIndex: 10
          }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 1, width: 2,
            background: isDragging.current ? '#3b82f6' : '#1a1d25',
            transition: 'background 0.15s'
          }} />
        </div>
      )}

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
          <div style={{ ...S.statusIndicator, position: 'relative' }}>
            {analysis && <span style={S.dot} title="GMM loaded" />}
            {volData && <span style={{ ...S.dot, background: '#a78bfa' }} title="Vol loaded" />}
            <span style={S.tickerBadge}>{analysis?.ticker || '—'}</span>
            <button onClick={() => setSettingsOpen(p => !p)}
              style={{
                background: 'none', border: 'none', color: settingsOpen ? '#3b82f6' : '#6b7280',
                fontSize: 14, cursor: 'pointer', padding: '2px 6px', marginLeft: 4
              }}
              title="Settings"
            >⚙</button>
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}
              settings={settings} onUpdate={updateSettings} onReset={resetSettings} />
          </div>
        </div>

        {/* Content */}
        <div style={S.content}>
          {!analysis && !loading && !['strategy', 'animate', 'merge', 'tearsheet', 'compare', 'library', 'sensitivity', 'wfo'].includes(activeTab) && (
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

              {activeTab === 'moments' && analysis.moment_evolution && (
                <div>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1d25', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#9ca3af' }}>
                    D1: Time-at-Price
                  </div>
                  <MomentsChart momentEvolution={analysis.moment_evolution} distLabel="d1" />
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1d25', borderTop: '1px solid #1a1d25', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#9ca3af' }}>
                    D2: Volume-Weighted
                  </div>
                  <MomentsChart momentEvolution={analysis.moment_evolution} distLabel="d2" />
                </div>
              )}
            </>
          )}
          {activeTab === 'strategy' && (
            <StrategyPanel 
              loadedStrategy={loadedStrategy}
              onResult={(data) => {
                setStrategyResult(data)
                setStrategyHistory(prev => [...prev, data])
                setActiveTab('tearsheet')
              }} 
            />
          )}

          {activeTab === 'library' && (
            <div style={S.panel}>
              <LibraryPanel onSelectStrategy={(s) => {
                setLoadedStrategy(s)
                setActiveTab('strategy')
              }} />
            </div>
          )}

          {activeTab === 'tearsheet' && (
            <TearsheetPanel strategyResult={strategyResult} />
          )}

          {activeTab === 'compare' && (
            <ComparePanel strategyHistory={strategyHistory} />
          )}

          {activeTab === 'sensitivity' && (
            <SensitivityPanel strategyResult={strategyResult} sessionId={strategyResult?.session_id} code={strategyResult?.code} />
          )}

          {activeTab === 'wfo' && (
            <WfoPanel strategyResult={strategyResult} sessionId={strategyResult?.session_id} code={strategyResult?.code} />
          )}

          {activeTab === 'animate' && (
            <EquityAnimator strategyResult={strategyResult} />
          )}

          {activeTab === 'merge' && (
            <MergePanel />
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
