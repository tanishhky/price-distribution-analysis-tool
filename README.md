# ◈ VolEdge — Volatility Trading System v2.1

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
│   ├── analysis.py             # D1, D2 distributions + GMM
│   ├── volatility_engine.py    # Black-Scholes, IV, VRP, signal generation
│   ├── models.py               # Pydantic data models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/
│   │       ├── Controls.jsx          # Sidebar with all params + reprocess
│   │       ├── CandlestickChart.jsx  # OHLCV + volume
│   │       ├── DistributionChart.jsx # D1/D2 histogram + KDE
│   │       ├── GMMChart.jsx          # GMM decomposition
│   │       ├── ComparisonChart.jsx   # D1 vs D2 overlay
│   │       ├── VolatilityPanel.jsx   # IV surface, vol compare, chain table
│   │       ├── SignalsPanel.jsx      # Trade signals with legs + greeks
│   │       └── ResultsPanel.jsx      # Textual output + tables
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

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
- **GMM vol display** — Summary now shows price-space dispersion as `$5.63` instead of incorrectly formatting as `563.00%`
- **IV Surface chart** — Switched from Plotly `surface` (requires perfect 2D grid) to `mesh3d` (Delaunay triangulation handles sparse option data)
- **Return type hint** — `build_distributions` type hint corrected to match 6-item return

### Data Caching & Reprocessing

- **Instant parameter tweaking** — After running vol analysis, change risk-free rate or dividend yield and click **⟳ Reprocess (cached)** to recompute greeks, IV, and signals without re-fetching from Polygon
- **New `/volatility/reprocess` endpoint** — Accepts cached contracts + bars, skips all API calls
- **Save / Load cache** — **↓ Save** exports all session data (candles, analysis, contracts, bars, vol results) as a JSON file. **↑ Load** restores it instantly — all tabs (DATA, VOL, SIGNALS, CHARTS) repopulate without any API calls
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

1. Enter Polygon.io API key (free tier works)
2. Enter ticker (e.g. SPY, AAPL, QQQ)
3. Set date range and timeframe
4. Click **▶ Fetch & Analyze** — runs GMM distribution analysis
5. Click **◈ Run Vol Analysis** — fetches options chain, computes IV surface, generates signals
6. Tweak risk-free rate or dividend yield → click **⟳ Reprocess (cached)** for instant results
7. Click **↓ Save** to export session cache as JSON — reload later with **↑ Load** (zero API calls)
8. Navigate tabs: CHARTS | PROFILE | VOL | SIGNALS | DATA

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

- **Free tier rate limits**: 5 API calls/min. Options chain fetching may be slow for large chains.
  The system batches requests and skips contracts that fail.
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
