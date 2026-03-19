const BASE = '/api'

function extractError(data, fallback) {
  const d = data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(e => e?.msg || JSON.stringify(e)).join('; ')
  return JSON.stringify(d)
}

export async function fetchCandles(params) {
  const res = await fetch(`${BASE}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to fetch candles'))
  return data
}

export async function analyzeData(params) {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to analyze data'))
  return data
}

export async function runVolatilityAnalysis(params) {
  const res = await fetch(`${BASE}/volatility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Volatility analysis failed'))
  return data
}

export async function reprocessVolatility(params) {
  const res = await fetch(`${BASE}/volatility/reprocess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Reprocessing failed'))
  return data
}

export async function getSupportedIntervals() {
  const res = await fetch(`${BASE}/supported-intervals`)
  return res.json()
}

// ── Manual Mode API ──

export async function uploadManualData(files) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  const res = await fetch(`${BASE}/strategy/manual/upload-data`, {
    method: 'POST',
    body: formData,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to upload data'))
  return data
}

export async function validateManualStrategy(code) {
  const res = await fetch(`${BASE}/strategy/manual/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Validation failed'))
  return data
}

export async function runManualStrategy(params) {
  const res = await fetch(`${BASE}/strategy/manual/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Manual strategy execution failed'))
  return data
}

// ── Tearsheet & Reports ──

export async function fetchTearsheet(dailyLog, config = {}) {
  const res = await fetch(`${BASE}/strategy/tearsheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_log: dailyLog, config }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Tearsheet computation failed'))
  return data
}

export async function runMonteCarlo(dailyLog, nSims = 5000, horizonDays = 252) {
  const res = await fetch(`${BASE}/strategy/monte-carlo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_log: dailyLog, n_simulations: nSims, horizon_days: horizonDays }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Monte Carlo failed'))
  return data
}

export async function downloadReport(dailyLog, config = {}, strategyName = 'Strategy') {
  const res = await fetch(`${BASE}/strategy/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_log: dailyLog, config, strategy_name: strategyName }),
  })
  if (!res.ok) throw new Error('Report generation failed')
  return res.blob()
}

// ── Strategy Library ──

export async function listStrategies() {
  const res = await fetch(`${BASE}/strategy/library`)
  return res.json()
}

export async function saveStrategy(name, code, config, description = '', mode = 'manual', tags = '') {
  const res = await fetch(`${BASE}/strategy/library/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, code, config, description, mode, tags }),
  })
  return res.json()
}

export async function deleteStrategy(id) {
  const res = await fetch(`${BASE}/strategy/library/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function loadStrategy(id) {
  const res = await fetch(`${BASE}/strategy/library/${id}`)
  return res.json()
}

// ── Data Quality ──

export async function checkDataQuality(sessionId) {
  const res = await fetch(`${BASE}/strategy/data-quality`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Data quality check failed'))
  return data
}

// ── Run History ──

export async function listRuns(limit = 50) {
  const res = await fetch(`${BASE}/strategy/runs?limit=${limit}`)
  return res.json()
}
export async function runSensitivity(params) {
  const res = await fetch(`${BASE}/strategy/sensitivity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Sensitivity analysis failed'))
  return data
}

export async function runWFO(params) {
  const res = await fetch(`${BASE}/strategy/wfo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Walk-Forward Optimization failed'))
  return data
}

// ── Strategy Library ──

export async function getStrategyLibrary() {
  const res = await fetch(`${BASE}/strategy/library`)
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to list library'))
  return data
}

export async function saveToLibrary(params) {
  const res = await fetch(`${BASE}/strategy/library/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to save strategy'))
  return data
}

export async function deleteFromLibrary(id) {
  const res = await fetch(`${BASE}/strategy/library/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(extractError(data, 'Failed to delete strategy'))
  return data
}
