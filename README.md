# ◈ VolEdge — Volatility Trading System

A full-stack quantitative trading platform that combines **price distribution analysis** (GMM)
with **options volatility analysis** and **automated trade signal generation**.

Built on Polygon.io (free tier compatible). All greeks and IV computed locally via Black-Scholes.

## Architecture

```
price-distribution-tool/
├── backend/
│   ├── main.py                 # FastAPI — all endpoints
│   ├── polygon_client.py       # Polygon.io stock/crypto/forex OHLCV + parallel fetch
│   ├── options_client.py       # Polygon.io options contracts + bars
│   ├── analysis.py             # D1, D2 distributions + GMM + moment evolution
│   ├── volatility_engine.py    # Black-Scholes, IV, VRP, signal generation
│   ├── models.py               # Pydantic data models
│   ├── strategy_engine.py      # Walk-forward engine, AST validator, sandboxing
│   ├── strategy_routes.py      # API route definitions for strategy execution
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx               # Main layout, State, Routing
│   │   ├── api.js                # API client with validation error unwrapping
│   │   └── components/
│   │       ├── Controls.jsx          # Collapsible sidebar: multi-key input, core params
│   │       ├── SettingsModal.jsx     # Header dropdown: batch sizes, expiry ranges, moment rules
│   │       ├── CandlestickChart.jsx  # Plotly OHLCV + volume
│   │       ├── DistributionChart.jsx # D1/D2 histogram + KDE
│   │       ├── GMMChart.jsx          # GMM decomposition breakdown
│   │       ├── ComparisonChart.jsx   # D1 vs D2 overlay
│   │       ├── VolatilityPanel.jsx   # IV surface, term structure, skew, chain table
│   │       ├── SignalsPanel.jsx      # Trade signals with legs, greeks, PnL
│   │       ├── ResultsPanel.jsx      # Textual narrative output + tables
│   │       ├── MomentsChart.jsx      # 2×2 moment evolution charts (Mean, σ, Weight, Kurtosis)
│   │       ├── MergePanel.jsx        # Cache file merger with dedup statistics
│   │       ├── StrategyPanel.jsx     # Strategy config, code editor, and walk-forward execution
│   │       └── EquityAnimator.jsx    # Animated P&L replay with interactive scrubbing
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## Core Workflows & Features

### Demonstrations

Check out the interactive backtesting and analysis features:

- **API Mode Walk-Forward Execution:** Execute complex multi-regime strategies with zero look-ahead bias right out of the box.
![Strategy API Execution Demo](assets/demos/strategy_demo.webp)

- **Parameter Sensitivity Sweep:** Instantly visualize how tiny configuration changes impact your CAGR and Sharpe using 3D surface plots.
![Sensitivity Panel Demo](assets/demos/sensitivity_demo.webp)

- **Walk-Forward Optimization (WFO):** Dynamically optimize and map metrics over moving training windows.
![WFO Panel & Tearsheet Demo](assets/demos/tearsheet_wfo_demo.webp)

### 1. Data Fetching & Parallel Processing
- **Multi-API Key Support** — Paste multiple Polygon keys (one per line or comma-separated) to bypass free tier constraints.
- **Parallel Chunking** — The backend automatically splits historical date ranges across all available keys for concurrent fetching.
- **Batched Option Lookups** — Options bars are fetched via round-robin key assignment. Rate limits are exactly managed (batch sizes and delays are configurable in settings).

### 2. Gaussian Mixture Model (GMM) Analysis
- **Independent or Synced Fitting** — Fit N components independently to Time-at-Price (D1) and Volume-Weighted (D2) distributions, or use "Sync D1/D2" to find the universally best shared N minimizing combined BIC.
- **Moment Evolution** — Track how each Gaussian component's Mean, Volatility (σ), and Probability Weight drift over time via a sliding window, alongside the full Mixture Kurtosis.
- **Re-Analyze** — Change bins or the maximum/desired components via the themed sliders and instantly re-run the math without re-fetching underlying candles.

### 3. Volatility Engine (Locally Computed)
- **Black-Scholes Pricing** — Full implementation with continuous dividends handling call/put greeks analytically.
- **Implied Volatility Tracking** — Brent root-finding for IV calculation mapped to a 3D Volatility Surface.
- **Metrics Dashboard** — 25Δ Put-Call Skew (fear premium), Volatility Risk Premium (VRP: IV minus realized vol), Term Structure, and Parkinson high-low volatility estimators.

### 4. Trade Signal Generation
Evaluates real-time math thresholds against the enriched options chain to output actionable strategies:
1. **Vol Crush** — When VRP > 5%, sell short strangles to capture premium.
2. **Skew Trade** — When 25Δ Put Skew exceeds GMM tail risk, sell put credit spreads.
3. **Calendar Spread** — When term structure inverts (backwardation), sell near / buy far.
4. **Mean Reversion** — When price displaces from primary High Volume Nodes, buy directional options.
5. **Gamma Scalp** — When GMM distribution is distinctly multi-modal, buy straddle + delta-hedge.

### 5. Caching & Merging System
- **Raw-Only Cache** — Session data (candles, option contracts, closed bars) saves locally as `.json`. No computed data is exported, ensuring purity.
- **Instant Restore** — Uploading a cache file skips all API hits and immediately recomputes GMM and options greeks.
- **Merge Tool** — Dedicated MERGE tab lets you drag-and-drop multiple cache files. It intelligently dedupes overlapping overlapping candles (by timestamp) and contracts (by ID) to synthesize larger continuous datasets.

### 6. Strategy Lab & Walk-Forward Engine
- **Zero Look-Ahead Bias** — Upload custom Python code for regime detection and allocation. The engine executes day-by-day, ensuring logic strictly receives `t-1` historical data.
- **Built-in Templates** — Fast-start with pre-configured strategies including Gaussian HMM Regime Switching, Dual MA Momentum, and simple Volatility thresholding.
- **Interactive Animator** — Animate walk-forward P&L alongside an overlaid historical price chart, dynamically shaded by active regimes with scrubbing and speed controls.
- **Strict Sandboxing** — The Python code evaluator strips dangerous built-ins and uses AST parsing to rigidly lock down imports to secure numerical libraries (numpy, pandas, scipy, sklearn, hmmlearn).

### 7. Dynamic UI/UX
- **Collapsible Sidebar** — The Controls sidebar is draggable/resizable (200px-450px) and collapses into a micro-icon strip to maximize chart space.
- **Configuration Hub** — A header gear icon ⚙ opens Settings for tweaking batch variables (requests vs delay), option expirations (near/far boundaries), and sliding window ratios.
- **Theming** — Fully unified dark-mode styling with natively customized WebKit range sliders (`#3b82f6` accents).

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

### 3. Usage Guide

1. **Setup**: Paste your Polygon.io API key(s) in the CONNECTION sidebar. More keys = much faster loads.
2. **Fetch**: Enter a ticker (e.g. SPY, BTCUSD), select a timeframe, and click **▶ Fetch & Analyze**.
3. **Tweak Analysis**: Slide the Bin/N sliders. Click **⟳ Re-Analyze (GMM)** to instantly update the charts in the CHARTS and MOMENTS tabs.
4. **Vol Scan**: Click **◈ Run Vol Analysis** to pull the options chain and compute the Volatility Surface and Signals.
5. **Simulate**: Click the ⚙ icon top right to adjust near/far expiration constraints or edit Dividend/Risk-Free rates in the sidebar, then hit **⟳ Reprocess (cached)**.
6. **Data Portability**: Click **↓ Save** at the bottom of the sidebar to dump raw data. Use the **MERGE** tab to combine it with older saves.
7. **Strategy Lab**: Switch to the **STRATEGY** tab to code, validate, and execute zero look-ahead bias backtests using your own active regime detection.
8. **Animator**: Once a strategy successfully executes, navigate to the **ANIMATE** tab to replay the P&L timeline alongside historical price data.

## API Endpoints

```text
GET  /health                   → Health check
GET  /supported-intervals      → Valid timeframes
POST /fetch                    → Fetch OHLCV + auto-detects asset class
POST /analyze                  → GMM distribution + sliding moment evolution
POST /volatility               → Full vol surface + options + signals pipeline
POST /volatility/reprocess     → Recalculates greeks + signals instantly (no API)
POST /strategy/validate        → Validates user-uploaded Python strategy code
POST /strategy/run             → Executes a walk-forward strategy backtest
POST /strategy/run-template    → Runs a built-in strategy template
GET  /strategy/templates       → List of all available strategy templates
GET  /strategy/docs            → Core API specifications for strategy logic
```

## Limitations & Notes

- **Free Tier Rate Limits**: Polygon allows 5 calls/min per key. The settings menu defaults ensure you stay exactly within this limit (`Batch Size`=5, `Delay`=61s). Providing multiple keys automatically scales throughput linearly.
- **Options Data Limitations**: The free tier provides *daily* closing option bars. Real-time intraday bid/ask spreads require a paid Polygon tier.
- **IV Accuracy**: Black-Scholes inherently prices European options. For American equity options, there is a minor early-exercise discrepancy, but BS serves as the standard approximation.
- **Signal Disclaimer**: Generated signals are mathematical indicators derived purely from statistical anomalies (VRP, Skew, KDE multimodality). They are **not** investment advice.
