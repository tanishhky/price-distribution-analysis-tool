# ◈ VolEdge — Volatility Trading System v3.0

A full-stack quantitative trading platform that combines **price distribution analysis** (GMM)
with **options volatility analysis** and **automated trade signal generation**.

Built on Polygon.io (free tier compatible). All greeks and IV computed locally via Black-Scholes.

## Architecture

```
price-distribution-tool/
├── backend/
│   ├── main.py                 # FastAPI — all endpoints
│   ├── polygon_client.py       # Polygon.io stock/crypto/forex OHLCV
│   ├── options_client.py       # Polygon.io options contracts + bars
│   ├── analysis.py             # D1, D2 distributions + GMM + moment evolution
│   ├── volatility_engine.py    # Black-Scholes, IV, VRP, signal generation
│   ├── models.py               # Pydantic data models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/
│   │       ├── Controls.jsx          # Sidebar: multi-key, GMM params, sync toggle
│   │       ├── CandlestickChart.jsx  # OHLCV + volume
│   │       ├── DistributionChart.jsx # D1/D2 histogram + KDE
│   │       ├── GMMChart.jsx          # GMM decomposition
│   │       ├── ComparisonChart.jsx   # D1 vs D2 overlay
│   │       ├── VolatilityPanel.jsx   # IV surface, vol compare, chain table
│   │       ├── SignalsPanel.jsx      # Trade signals with legs + greeks
│   │       ├── ResultsPanel.jsx      # Textual output + tables
│   │       ├── MomentsChart.jsx      # 2×2 moment evolution charts
│   │       └── MergePanel.jsx        # Cache file merger with dedup
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## What's New in v3.0

### Consistency & Cache Overhaul
- **Re-Analyze button** — Change GMM N or bins and click "⟳ Re-Analyze (GMM)" to refit without re-fetching candles from Polygon
- **Raw-only caching** — Downloaded cache files (v3) contain only candles + contracts + bars — no computed analysis. Prevents stale/conflicting results when merging files
- **Auto-recompute on upload** — Loading a cache file triggers fresh GMM analysis + vol reprocessing automatically

### Multi-API Key Parallel Fetching
- **Multiple API keys** — Paste multiple Polygon keys (one per line or comma-separated) in the CONNECTION section
- **Round-robin batching** — Keys are distributed across option bar batches: N keys → N×5 req/min throughput
- **Key counter** — UI shows how many keys detected and effective request rate

### Cache File Merger
- **MERGE tab** — Upload multiple cache files, auto-detect overlapping candles by timestamp
- **Dedup stats** — Shows input vs merged counts for candles, contracts, bars
- **Download merged** — Export combined file for upload into any VolEdge session

### Synced GMMs
- **Sync D1/D2 toggle** — Finds optimal N minimizing combined BIC across both distributions
- **Shared N** — When enabled, D1 and D2 use the same number of Gaussian components

### GMM Moment Evolution
- **Sliding window analysis** — Tracks how each Gaussian component's mean, σ, and weight evolve as the data window moves forward
- **Mixture kurtosis** — Computes excess kurtosis of the full mixture distribution at each window step
- **MOMENTS tab** — 2×2 grid of charts for D1 and D2: component means, σ, weights, and mixture kurtosis over time

## What's New in v2.1

### Bug Fixes & Correctness Improvements

- **Black-Scholes theta** — Fixed sign errors in both call and put theta for dividend-paying stocks
- **Multi-asset annualization** — Realized vol uses correct factors per asset class: Stocks (252d × 6.5h), Crypto (365d × 24h), Forex (252d × 24h)
- **Window lookback** — "RV 10d" now correctly converts day-based windows to candle counts (e.g. 10 days × 6.5 = 65 hourly candles)
- **Weekend/holiday crash** — Option bar lookup now walks backwards to find last trading day instead of hardcoding "yesterday"
- **Options chain completeness** — Raised contract fetch limit from 250 to 1000 to capture the full chain for liquid assets like SPY
- **Naked option max-loss** — Corrected from arbitrary `3× credit` to proper theoretical values (unlimited for calls, `strike × 100 − credit` for puts)
- **Pagination fix** — Polygon pagination no longer sends duplicate `apiKey` query params
- **GMM component stats** — Skewness/kurtosis now use theoretical Gaussian values (0.0) instead of noisy random sampling
- **GMM vol display** — Backend summary and frontend metric card now show price-space dispersion as `$5.63` instead of `5802.0%`
- **IV Surface chart** — Uses `surface` with `connectgaps: true` for dense data, falls back to `scatter3d` markers for sparse chains (e.g. GOOG on free tier)
- **Return type hint** — `build_distributions` type hint corrected to match 6-item return

### Data Caching & Reprocessing

- **Instant parameter tweaking** — After running vol analysis, change risk-free rate or dividend yield and click **⟳ Reprocess (cached)** to recompute greeks, IV, and signals without re-fetching from Polygon
- **New `/volatility/reprocess` endpoint** — Accepts cached contracts + bars, skips all API calls
- **Save / Load cache** — **↓ Save** exports all session data (candles, analysis, contracts, bars, vol results) as a JSON file. **↑ Load** restores it instantly — all tabs (DATA, VOL, SIGNALS, CHARTS) repopulate without any API calls
- **Rate-limited batching** — Option bar fetching now processes 5 contracts per batch with 13s delays, respecting Polygon free tier (5 req/min). Progress logged to backend terminal
- **Debug info bar** — VOL tab shows surface point count, unique strikes/expiries, and chain size for troubleshooting
- **Frontend caching** — Raw option data stored in React state for instant reuse

## Features

### Volatility Engine (self-computed, no paid tier needed)
- **Black-Scholes pricing** — full implementation with continuous dividends
- **Implied Volatility** — Brent root-finding on BS model
- **Greeks** — Delta, Gamma, Theta, Vega, Rho computed analytically
- **Parkinson volatility** — high-low estimator (more efficient than close-to-close)
- **Multi-timeframe annualization** — correct factors for 1min through 1week candles

### Options Chain Analysis
- Fetches all active contracts from Polygon reference endpoint
- Gets daily bars for each contract (free tier)
- Enriches every contract with self-computed IV + all greeks
- Displays full chain with calls/puts side-by-side

### IV Surface & Volatility Metrics
- **3D IV Surface** — strike × expiry × IV interactive visualization
- **IV Smile** — grouped by expiry, plotted against moneyness
- **ATM IV** — near-term and far-term
- **Term Structure** — contango/backwardation/flat detection
- **25Δ Put-Call Skew** — fear premium measurement
- **VRP (Volatility Risk Premium)** — IV minus realized vol at 10d/20d/30d
- **GMM-enhanced realized vol** — mixture-weighted variance + kurtosis

### Trade Signal Generation (5 strategy types)
1. **Vol Crush** — When VRP is high, sell premium via short strangles
2. **Skew Trade** — When put skew exceeds GMM tail risk, sell put credit spreads
3. **Calendar Spread** — When term structure is inverted, sell near / buy far
4. **Mean Reversion** — When price is displaced from HVN, buy directional options
5. **Gamma Scalp** — When GMM shows multi-modal distribution, buy straddle + delta-hedge

Each signal includes:
- Specific contract legs with tickers
- Max profit / max loss / probability estimates
- Net position greeks (Δ, Γ, Θ, ν)
- Risk/reward ratio and breakeven levels

## Setup & Run

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Usage

1. Enter one or more Polygon.io API keys (one per line or comma-separated — more keys = faster fetching)
2. Enter ticker (e.g. SPY, AAPL, QQQ)
3. Set date range and timeframe
4. Optional: toggle **Sync D1/D2** to find a shared GMM N across both distributions
5. Click **▶ Fetch & Analyze** — runs GMM distribution analysis + moment evolution
6. Adjust GMM N or bins → click **⟳ Re-Analyze (GMM)** to refit without re-fetching
7. Click **◈ Run Vol Analysis** — fetches options chain, computes IV surface, generates signals
8. Tweak risk-free rate or dividend yield → click **⟳ Reprocess (cached)** for instant results
9. Click **↓ Save** to export raw data cache — reload later with **↑ Load** (auto-recomputes all analysis)
10. Navigate tabs: CHARTS | PROFILE | VOL | SIGNALS | DATA | MOMENTS | MERGE
11. Use **MERGE** tab to combine multiple cache files and download unified data

## API Endpoints

```
GET  /health                   → Health check
GET  /supported-intervals      → Valid timeframes
POST /fetch                    → Fetch OHLCV from Polygon
POST /analyze                  → GMM distribution analysis
POST /volatility               → Full volatility + options + signals pipeline
POST /volatility/reprocess     → Reprocess with cached data (no API calls)
```

## Limitations & Notes

- **Free tier rate limits**: 5 API calls/min per key. Use multiple keys for faster throughput (N keys → N×5 req/min).
  The system round-robins across keys and batches requests.
- **Options data**: Daily bars only on free tier. For real-time bid/ask, upgrade to paid.
- **IV accuracy**: BS model assumes European exercise. For American options (most US equity options),
  there's a small pricing discrepancy. The system uses BS as an approximation.
- **Signal quality**: Signals are mathematically derived from statistical analysis.
  They are NOT investment advice. Always validate with your own research and risk management.
- **Volume**: Some option contracts have very low volume. The system filters out contracts
  where IV cannot be reliably computed.
- **Weekend/holiday handling**: The system skips weekends when looking up option bars.
  Market holidays are not explicitly handled — if the most recent weekday was a holiday,
  the bar lookup may still return empty for some contracts.

## Disclaimer

This tool is for educational and research purposes only. It does not constitute financial advice.
Options trading involves substantial risk of loss. Past performance does not guarantee future results.
Always consult a qualified financial advisor before making investment decisions.
