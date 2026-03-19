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
