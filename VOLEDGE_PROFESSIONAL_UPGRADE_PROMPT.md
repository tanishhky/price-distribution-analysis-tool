# VolEdge Professional Upgrade — Engineering Prompt

## Context

VolEdge is a full-stack quantitative trading platform (FastAPI + React/Vite) that combines GMM-based price distribution analysis, options volatility analysis (self-computed Black-Scholes), and a walk-forward strategy backtesting engine. The codebase is functional but needs to be upgraded from a "working prototype" to a "professionally deployable strategy testing platform."

The existing stack:
- **Backend**: FastAPI (Python 3.9+), numpy, scipy, sklearn, hmmlearn, yfinance, Polygon.io API
- **Frontend**: React 18, Vite, Plotly.js, inline styles (dark theme, JetBrains Mono + DM Sans)
- **Strategy Engine**: AST-validated sandboxed Python execution, walk-forward methodology, zero look-ahead bias guarantee, manual mode with file upload
- **Architecture**: Single `main.py` with all routes, `strategy_engine.py` for backtest logic, separate analysis/volatility modules

The system already has: GMM fitting (D1/D2), moment evolution, IV surface construction, 5 signal types, 3 strategy templates (HMM/Vol/Momentum), equity curve animator, cache merge tool, manual mode with `run_strategy(data, config)` API.

---

## Phase 1: Professional Analytics & Reporting (Priority: HIGH)

### 1.1 — Quantitative Tearsheet Generator

Add a comprehensive post-backtest analytics module that produces a full tearsheet, comparable to what pyfolio/quantstats generate. This should be computed server-side and rendered as a dedicated "TEARSHEET" tab in the frontend.

**Backend (`tearsheet_engine.py`)**:

Compute and return the following metrics from the daily_log:

**Return Metrics:**
- CAGR (Compound Annual Growth Rate)
- Total return, YTD return
- Best/worst day, best/worst month, best/worst year
- Monthly returns heatmap data (year × month matrix)
- Rolling 1Y, 3Y, 5Y returns
- Calmar ratio (CAGR / max drawdown)
- Sortino ratio (using downside deviation only)
- Omega ratio
- Tail ratio (95th percentile gain / 5th percentile loss)

**Risk Metrics:**
- Annualized volatility (already have, but add rolling)
- Rolling 63d, 126d, 252d volatility
- Value at Risk (VaR) — historical, parametric (Gaussian), Cornish-Fisher
- Conditional VaR (CVaR / Expected Shortfall) at 95% and 99%
- Maximum drawdown duration (days)
- Drawdown table: top 5 drawdowns with start, trough, recovery dates, depth, duration
- Ulcer Index
- Pain Index

**Benchmark Comparison:**
- Active return (strategy - benchmark) decomposition
- Tracking error
- Information ratio
- Beta, alpha (both CAPM single-factor and rolling)
- Up-capture / down-capture ratios
- Rolling 63d correlation with benchmark

**Distribution Analysis:**
- Return distribution histogram with fitted normal overlay
- Skewness, kurtosis of daily returns
- Jarque-Bera test for normality (p-value)
- Monthly return distribution

**Exposure & Turnover:**
- Average number of positions over time
- Average portfolio turnover per rebalance
- Cumulative transaction costs as % of AUM
- Cash drag (average uninvested fraction)

**Frontend (`TearsheetPanel.jsx`)**:

Create a new tab "TEARSHEET" that renders:
1. **Summary ribbon** — key metrics in cards (CAGR, Sharpe, Sortino, Max DD, Calmar)
2. **Equity curve** — Plotly line chart with benchmark overlay, log scale toggle, drawdown shading below
3. **Underwater plot** — separate drawdown chart showing depth over time
4. **Monthly returns heatmap** — Plotly heatmap (rows=years, cols=months, color=return)
5. **Rolling metrics** — 2×2 grid: rolling Sharpe, rolling volatility, rolling beta, rolling drawdown
6. **Return distribution** — histogram + fitted normal + annotated skew/kurt
7. **Drawdown table** — top 5 drawdowns with all metadata
8. **Risk metrics table** — VaR/CVaR/Ulcer in a clean table

Use the same dark theme (background #0a0b0d, plot #0d0e12, accent #3b82f6). All charts via react-plotly.js.

### 1.2 — PDF/DOCX Report Export

Add a "Download Report" button on the tearsheet that generates a professional PDF or DOCX report.

**Backend approach**: Use `reportlab` (PDF) or `python-docx` (DOCX) to generate a multi-page report containing:
- Title page with strategy name, date range, author
- Executive summary (key metrics table)
- Equity curve chart (matplotlib, saved as image, embedded)
- Monthly returns heatmap
- Drawdown analysis
- Risk metrics
- Regime distribution breakdown
- Configuration parameters used

Create endpoint: `POST /strategy/report` that accepts the strategy result JSON and returns a file download.

---

## Phase 2: Advanced Strategy Engine Features (Priority: HIGH)

### 2.1 — Multi-Strategy Comparison

Allow users to run multiple strategies (or the same strategy with different configs) and compare them side-by-side.

**Backend changes:**
- Add `POST /strategy/compare` endpoint that accepts a list of strategy definitions
- Run each sequentially, return all results in a single response
- Compute pairwise correlation of strategy returns

**Frontend (`ComparePanel.jsx`):**
- Table comparing all strategies' metrics side-by-side
- Overlaid equity curves on one chart
- Correlation matrix heatmap
- Highlight best/worst per metric

### 2.2 — Parameter Sensitivity Analysis (Grid Search)

Add the ability to sweep over a parameter range and see how strategy performance varies.

**Backend:**
- `POST /strategy/sensitivity` — accepts a strategy definition plus parameter ranges (e.g., `rebalance_days: [21, 42, 63, 126]`, `transaction_cost: [0.001, 0.002, 0.005]`)
- Runs the strategy for each parameter combination
- Returns a matrix of (params → metrics)

**Frontend:**
- Heatmap of Sharpe ratio across 2 swept parameters
- Table of all runs sorted by chosen metric
- Warning if the best config is an edge case (potential overfit)

### 2.3 — Walk-Forward Optimization (Out-of-Sample Testing)

Implement proper walk-forward optimization:
1. Split data into N folds (e.g., 5 × [2 years train, 1 year test])
2. For each fold: optimize params on train, evaluate on test
3. Report out-of-sample metrics aggregated across all test folds

This is critical for detecting overfitting. The current engine does walk-forward execution but not walk-forward *optimization*.

**Backend (`wfo_engine.py`):**
- Accept parameter grid + fold specification
- For each fold: run grid search on in-sample, pick best params, run on out-of-sample
- Aggregate out-of-sample results
- Return in-sample vs out-of-sample comparison

### 2.4 — Position Sizing Models

Currently the engine uses equal-weight or user-defined weights. Add built-in position sizing modules:

- **Kelly Criterion** — optimal fraction based on win rate and payoff ratio
- **Risk Parity** — weight inversely proportional to volatility contribution
- **Mean-Variance (Markowitz)** — already partially in HMM template, formalize it
- **Maximum Diversification** — maximize diversification ratio
- **Minimum Variance** — minimize portfolio variance subject to full investment
- **Black-Litterman** — incorporate user views on expected returns

Add these as selectable options in the config, or as importable functions in the user's strategy code sandbox.

### 2.5 — Realistic Transaction Cost Modeling

Replace the flat `transaction_cost` parameter with a more realistic model:

```python
class TransactionCostModel:
    spread_bps: float = 2.0        # bid-ask spread (half-spread applied)
    commission_per_share: float = 0.005  # e.g., IBKR
    min_commission: float = 1.0
    market_impact_bps: float = 1.0  # linear market impact
    slippage_pct: float = 0.01     # random slippage (uniform)
```

Apply these per-trade based on the actual dollar amount and number of shares, not just a flat % of turnover.

---

## Phase 3: Data Infrastructure (Priority: MEDIUM-HIGH)

### 3.1 — Database Layer

Replace the in-memory `_manual_data_store` dict with a proper database. Use SQLite for single-user deployment or PostgreSQL for multi-user.

**Schema:**
- `sessions` — session_id, created_at, user_id
- `strategies` — id, name, code, config_json, created_at, user_id
- `backtest_runs` — id, strategy_id, result_json, metrics_json, created_at
- `cached_data` — id, ticker, timeframe, data_blob, created_at

This enables:
- Saving/loading strategies across sessions
- Comparing historical runs
- Audit trail of all backtests

Use SQLAlchemy or raw `sqlite3` — keep it simple.

### 3.2 — Multi-Source Data Fetching

Currently relies on Polygon.io (candles) and yfinance (strategy mode). Add support for:

- **Alpha Vantage** — free tier, different rate limits
- **FRED** — macro data (yield curves, VIX, unemployment)
- **Yahoo Finance enhanced** — dividends, splits, fundamental data
- **CSV/Parquet upload** — already have in manual mode, but formalize it
- **Tiingo** — good free tier for daily data

Create a `DataFetcher` abstraction:
```python
class DataFetcher:
    async def fetch(self, tickers, start, end, source='auto') -> pd.DataFrame
```

The frontend should let users pick their data source per fetch.

### 3.3 — Data Quality Checks

Before running any strategy, automatically check:
- Missing dates (gaps > 3 business days)
- Stale prices (same close for > 5 consecutive days)
- Extreme returns (|daily return| > 50% — likely a split/error)
- Survivorship bias warning (if a ticker disappears mid-series)
- Duplicate timestamps
- Non-trading day data (weekends for equities)

Display warnings in the UI before execution.

---

## Phase 4: Deployment & DevOps (Priority: MEDIUM)

### 4.1 — Docker Containerization

Create `docker-compose.yml` with:
- `backend` service (FastAPI + uvicorn)
- `frontend` service (Vite build served by nginx)
- `db` service (PostgreSQL, optional)

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes: ["./data:/app/data"]
    environment:
      - DATABASE_URL=sqlite:///./data/voledge.db
  
  frontend:
    build: ./frontend
    ports: ["80:80"]
    depends_on: [backend]
```

Backend Dockerfile:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Frontend Dockerfile:
```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### 4.2 — Environment Configuration

Move all hardcoded values to environment variables:
- `POLYGON_API_KEY` (default keys)
- `DATABASE_URL`
- `CORS_ORIGINS`
- `MAX_UPLOAD_SIZE_MB`
- `SANDBOX_TIMEOUT_SECONDS` (for strategy execution)

Use `pydantic-settings` for backend config management.

### 4.3 — API Rate Limiting & Timeouts

- Add timeout to strategy execution (e.g., 5 minutes max)
- Add request size limits (reject uploads > 50MB)
- Add API rate limiting per session (prevent abuse)
- Add proper error recovery — if a strategy crashes, return partial results + error message rather than 500

### 4.4 — Logging & Monitoring

- Add structured logging (JSON format) with `structlog` or `loguru`
- Log every strategy run with: duration, tickers, config, result summary
- Add `/health` endpoint improvements: include uptime, last run time, memory usage
- Consider adding Prometheus metrics endpoint for monitoring

---

## Phase 5: Frontend Polish (Priority: MEDIUM)

### 5.1 — Strategy Library / Saved Strategies

Add a "LIBRARY" section where users can:
- Save strategies with name, description, tags
- Load previously saved strategies
- Fork/duplicate a strategy to iterate
- Export strategy as `.py` + `.json` config bundle
- Import strategy bundles

Use localStorage for single-user, or the database for multi-user.

### 5.2 — Interactive Equity Curve (Replace Canvas)

The current EquityAnimator uses raw Canvas. Replace the main equity curve visualization with a Plotly chart that has:
- Crosshair with date, portfolio value, benchmark value, regime
- Click-to-zoom on specific periods
- Toggle: linear vs log scale
- Toggle: show/hide benchmark, drawdown shading, rebalance markers
- Regime background bands (already in canvas, port to Plotly shapes)

Keep the Canvas animator as a separate "replay" feature, but make the main tearsheet chart interactive Plotly.

### 5.3 — Code Editor Upgrade

Replace the plain `<textarea>` code editor with a proper editor. Options:
- **Monaco Editor** (VS Code's editor) via `@monaco-editor/react` — best DX, syntax highlighting, autocomplete
- **CodeMirror 6** via `@codemirror/lang-python` — lighter weight

Whichever you choose, add:
- Python syntax highlighting
- Line error indicators (when validation fails, highlight the line)
- Auto-indent
- Bracket matching
- Basic autocomplete for allowed imports (`np.`, `pd.`, `hmm.`)

### 5.4 — Real-Time Progress Updates

Strategy execution can take 30-120 seconds. Replace the current polling with WebSocket or SSE (Server-Sent Events) for live progress:
- "Fetching data for 11 tickers…"
- "Training period: day 252/1500"
- "Rebalance 5/24 complete"
- "Computing FF5 attribution…"

Backend: Use FastAPI's `StreamingResponse` or WebSocket endpoint.
Frontend: Display a progress bar with percentage + stage name.

### 5.5 — Responsive Layout

The current layout assumes desktop (>1200px). Add:
- Collapsible panels for tablet (768-1200px)
- Stacked layout for mobile (<768px)
- Touch-friendly controls for the animator scrubber

---

## Phase 6: Advanced Features (Priority: LOW — Future Roadmap)

### 6.1 — Paper Trading Mode
Connect to a broker API (Alpaca, IBKR) to forward-test strategies with fake money in real-time.

### 6.2 — Alerts & Scheduling
Let users schedule strategy re-runs (e.g., daily at market close) and send alerts when regime changes or signals fire.

### 6.3 — Multi-User Authentication
Add user accounts with JWT auth, personal strategy libraries, and shared public strategies.

### 6.4 — Factor Attribution
Integrate Fama-French factor data (already done in the Regime-Aware backtest repo) into the tearsheet. Run FF3/FF5 regression on strategy returns, report alpha, factor loadings, R².

### 6.5 — Options Strategy Backtesting
Extend the strategy engine to support options positions (not just equity weights). This requires historical options data (expensive) but would be a major differentiator.

### 6.6 — Monte Carlo Simulation
Add a Monte Carlo module that:
- Bootstraps historical daily returns (block bootstrap to preserve autocorrelation)
- Simulates 10,000 paths forward
- Reports confidence intervals for terminal wealth, max drawdown, Sharpe
- Displays fan chart of simulated equity curves

---

## Implementation Order (Recommended)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Tearsheet generator (1.1) | 2-3 days | Very High |
| 2 | Docker containerization (4.1) | 1 day | High |
| 3 | Database layer (3.1) | 1-2 days | High |
| 4 | Multi-strategy comparison (2.1) | 1-2 days | High |
| 5 | Code editor upgrade (5.3) | 0.5 days | Medium |
| 6 | Data quality checks (3.3) | 0.5 days | Medium |
| 7 | PDF report export (1.2) | 1 day | Medium |
| 8 | Parameter sensitivity (2.2) | 1-2 days | Medium |
| 9 | Realistic txn costs (2.5) | 0.5 days | Medium |
| 10 | Position sizing models (2.4) | 1 day | Medium |
| 11 | Walk-forward optimization (2.3) | 2 days | High |
| 12 | Environment config (4.2) | 0.5 days | Medium |
| 13 | Progress updates via SSE (5.4) | 1 day | Medium |
| 14 | Monte Carlo (6.6) | 1 day | Medium |
| 15 | Factor attribution (6.4) | 1 day | Medium |

---

## Technical Constraints

- Keep all computation server-side (Python). The frontend is display-only.
- Maintain the existing dark theme consistently. All new components use the same color palette: bg #0a0b0d, surface #0d0e12, border #1a1d25, accent #3b82f6, warn #f59e0b, error #ef4444, success #22c55e.
- All new Plotly charts must use the existing `darkLayout` / `darkAxis` helper pattern from `VolatilityPanel.jsx`.
- Strategy code sandboxing rules must remain strict — no filesystem, network, or dynamic execution.
- Use `'Close'` instead of `'Adj Close'` when working with yfinance data.
- Font stack: JetBrains Mono for data/code, DM Sans for UI text.
- No external state management (Redux, etc.) — keep using React useState/useRef as currently.
- All backend endpoints follow the existing pattern: Pydantic request/response models, HTTPException for errors.
