const BASE = '/api'

export async function fetchCandles(params) {
  const res = await fetch(`${BASE}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Failed to fetch candles')
  return data
}

export async function analyzeData(params) {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Failed to analyze data')
  return data
}

export async function runVolatilityAnalysis(params) {
  const res = await fetch(`${BASE}/volatility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Volatility analysis failed')
  return data
}

export async function getSupportedIntervals() {
  const res = await fetch(`${BASE}/supported-intervals`)
  return res.json()
}
