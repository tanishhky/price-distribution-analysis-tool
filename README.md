# ◈ VolEdge — Volatility Trading System v2.0

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
│   │       ├── Controls.jsx          # Sidebar with all params
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

## What's New in v2.0

### Volatility Engine (self-computed, no paid tier needed)
- **Black-Scholes pricing** — full implementation with continuous dividends
- **Implied Volatility** — Brent root-finding on BS model
- **Greeks** — Delta, Gamma, Theta, Vega, Rho computed analytically
- **Parkinson volatility** — high-low estimator (more efficient than close-to-close)

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
6. Navigate tabs: CHARTS | PROFILE | VOL | SIGNALS | DATA

## API Endpoints

```
GET  /health                → Health check
GET  /supported-intervals   → Valid timeframes
POST /fetch                 → Fetch OHLCV from Polygon
POST /analyze               → GMM distribution analysis
POST /volatility            → Full volatility + options + signals pipeline
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

## Disclaimer

This tool is for educational and research purposes only. It does not constitute financial advice.
Options trading involves substantial risk of loss. Past performance does not guarantee future results.
Always consult a qualified financial advisor before making investment decisions.
