# VolEdge Strategy Engine — Integration Guide

## Quick Start

### Backend Setup

1. **Copy `strategy_engine.py`** into your `backend/` directory.

2. **Add imports to `main.py`** (top of file):
```python
from strategy_engine import (
    StrategyDefinition, StrategyRunner, StrategyConfig, RegimeDefinition,
    validate_strategy_code, STRATEGY_TEMPLATES, STRATEGY_API_DOCS,
)
```

3. **Add pip dependencies** to `requirements.txt`:
```
hmmlearn
yfinance
```

4. **Paste the endpoints** from `strategy_routes.py` at the bottom of your `main.py` (after `/volatility/reprocess`).

### Frontend Setup

1. **Copy** `StrategyPanel.jsx` and `EquityAnimator.jsx` into `frontend/src/components/`.

2. **Patch `App.jsx`** — follow the 4 steps in `APP_PATCH_GUIDE.jsx`:
   - Add imports
   - Add `strategyResult` state
   - Add two entries to the `TABS` array
   - Add tab content in the render

3. That's it. Start both servers and open the STRATEGY tab.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                          │
│  ┌──────────────┐  ┌──────────────┐                │
│  │StrategyPanel │──│EquityAnimator│                │
│  │ - Code editor│  │ - Canvas anim│                │
│  │ - Templates  │  │ - Speed ctrl │                │
│  │ - Basket     │  │ - Regime band│                │
│  │ - Config     │  │ - DD shading │                │
│  │ - Execute    │  │ - Scrubber   │                │
│  └──────┬───────┘  └──────┬───────┘                │
│         │  POST /strategy/run  │ strategyResult     │
│         └──────────┬───────────┘                    │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────┐
│                Backend                               │
│  ┌─────────────────▼──────────────────┐             │
│  │       strategy_engine.py           │             │
│  │  ┌────────────────────────────┐    │             │
│  │  │  Code Validator (AST)      │    │             │
│  │  │  • Forbidden imports check │    │             │
│  │  │  • Required funcs check    │    │             │
│  │  │  • Dangerous calls check   │    │             │
│  │  └────────────────────────────┘    │             │
│  │  ┌────────────────────────────┐    │             │
│  │  │  Walk-Forward Runner       │    │             │
│  │  │  • data.iloc[:t] ONLY     │    │  yfinance   │
│  │  │  • Day-by-day execution    │────│──→ fetch    │
│  │  │  • Regime detect per rebal │    │             │
│  │  │  • Transaction costs       │    │             │
│  │  └────────────────────────────┘    │             │
│  │  ┌────────────────────────────┐    │             │
│  │  │  Templates Registry        │    │             │
│  │  │  • HMM Regime             │    │             │
│  │  │  • Simple Vol             │    │             │
│  │  │  • Momentum               │    │             │
│  │  └────────────────────────────┘    │             │
│  └────────────────────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

---

## Strategy API Specification

### Endpoint: `POST /strategy/run`

**Request Body:**
```json
{
  "name": "My HMM Strategy",
  "tickers": ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE"],
  "benchmark": "SPY",
  "regime_code": "def detect_regime(data, config):\n    ...\n    return 0\n\ndef get_allocations(regime, data, tickers, config):\n    ...\n    return {'XLK': 0.2, 'XLF': 0.3, ...}",
  "start_date": "2019-01-01",
  "end_date": "2025-02-01",
  "config": {
    "rebalance_days": 63,
    "min_training_days": 252,
    "window_type": "expanding",
    "rolling_window": null,
    "transaction_cost": 0.001,
    "initial_capital": 100000
  }
}
```

**Response:**
```json
{
  "name": "My HMM Strategy",
  "tickers": ["XLK", "XLF", ...],
  "benchmark": "SPY",
  "config": { ... },
  "daily_log": [
    {
      "date": "2020-01-02",
      "portfolio_value": 100234.56,
      "benchmark_value": 100150.00,
      "regime": 2,
      "rebalanced": false
    },
    ...
  ],
  "rebalance_log": [
    {
      "date": "2020-03-15",
      "regime": 0,
      "weights": {"XLK": 0.08, "XLF": 0.05, ...},
      "turnover": 0.45,
      "cost": 45.00,
      "capital_after": 89955.00
    },
    ...
  ],
  "regime_history": [
    {"date": "2020-01-02", "regime": 2},
    {"date": "2020-03-15", "regime": 0},
    ...
  ],
  "metrics": {
    "total_return": 0.4523,
    "annual_return": 0.0812,
    "volatility": 0.1634,
    "sharpe": 0.50,
    "max_drawdown": -0.1892,
    "win_rate": 0.5321,
    "total_trades": 24,
    "benchmark": {
      "total_return": 0.3891,
      "annual_return": 0.0701,
      "volatility": 0.1821,
      "sharpe": 0.38,
      "max_drawdown": -0.2345
    }
  },
  "total_days": 1512,
  "start_date": "2020-01-02",
  "end_date": "2025-02-01"
}
```

---

## Writing Your Own Strategy

### Required: `detect_regime(data, config) -> int`

```python
def detect_regime(data, config):
    """
    Parameters
    ----------
    data : pd.DataFrame
        Close prices for each ticker in your basket.
        Index = DatetimeIndex. Columns = ticker symbols.
        ⚠️  ONLY contains data up to yesterday.
        The engine NEVER passes future data.

    config : dict
        Your strategy config:
        {
            'rebalance_days': 63,
            'min_training_days': 252,
            'window_type': 'expanding' | 'rolling',
            'rolling_window': int | None,
        }

    Returns
    -------
    int : Regime label (any integer). The same label is passed
          to get_allocations().
    """
    # Example: volatility-based regime
    market = data.iloc[:, 0]
    vol = market.pct_change().rolling(21).std().iloc[-1] * (252 ** 0.5)
    if vol > 0.30:
        return 0   # crisis
    elif vol < 0.12:
        return 2   # bull
    return 1       # normal
```

### Optional: `get_allocations(regime, data, tickers, config) -> dict`

```python
def get_allocations(regime, data, tickers, config):
    """
    Parameters
    ----------
    regime : int
        The label returned by detect_regime().
    data : pd.DataFrame
        Same historical data (up to yesterday).
    tickers : list[str]
        The ticker basket.
    config : dict
        Same config dict.

    Returns
    -------
    dict : {ticker: weight}
        Weights must be non-negative. They are auto-normalized to sum to 1.0.
        Missing tickers default to 0.
    """
    if regime == 0:  # crisis → minimize exposure
        return {t: 0.3 / len(tickers) for t in tickers}
    else:  # normal → equal weight
        return {t: 1.0 / len(tickers) for t in tickers}
```

### Allowed Imports

| Module | Alias | Usage |
|--------|-------|-------|
| `numpy` | `np` | Arrays, math |
| `pandas` | `pd` | DataFrames |
| `math` | — | Standard math |
| `scipy.stats` | — | Distributions, tests |
| `scipy.optimize` | — | Optimization |
| `sklearn.mixture.GaussianMixture` | — | GMM fitting |
| `sklearn.cluster.KMeans` | — | Clustering |
| `hmmlearn.hmm` | — | Hidden Markov Models |
| `collections`, `itertools`, `functools` | — | Standard utilities |
| `datetime`, `copy` | — | Standard lib |

### Forbidden

- **No filesystem access**: `os`, `sys`, `pathlib`, `shutil`, `glob`
- **No network access**: `socket`, `http`, `requests`, `httpx`
- **No dynamic execution**: `exec()`, `eval()`, `compile()`, `__import__()`
- **No file I/O**: `open()`, `pickle`, `sqlite3`
- **No system interaction**: `subprocess`, `multiprocessing`

---

## Look-Ahead Bias Guarantee

The engine provides **zero look-ahead bias** through strict temporal isolation:

1. At each rebalance time `t`, your `detect_regime()` receives `data.iloc[:t]` — strictly past data only.
2. The engine **never** includes the current day's data in the training set.
3. Weights are applied starting from `t` and held until the next rebalance at `t + rebalance_days`.
4. Transaction costs are deducted at rebalancing time based on portfolio turnover.

```
Timeline:
  ───[training data]──→ ◆ rebalance ──[hold weights]──→ ◆ rebalance ──→
                         ↑                                ↑
                    detect_regime()                   detect_regime()
                    sees data[:t]                     sees data[:t+63]
                    get_allocations()                 get_allocations()
```

**Your responsibility:** Don't call `.shift(-1)`, `.iloc[future_idx]`, or any other operation that would peek ahead within your own code. The engine can't detect internal look-ahead in your logic.

---

## D1/D2 Distribution Trading Without Look-Ahead

The existing D1/D2 GMM analysis can be used for regime detection. Here's how to do it **without** look-ahead bias:

```python
import numpy as np
import pandas as pd

def detect_regime(data, config):
    """
    Use D1 (time-at-price) distribution kurtosis as a regime signal.
    High kurtosis = concentrated around a node → trending regime.
    Low kurtosis = spread out → ranging regime.
    """
    market = data.iloc[:, 0]
    prices = market.values
    
    # Build D1 distribution from historical prices only
    num_bins = 100
    hist, bin_edges = np.histogram(prices, bins=num_bins, density=True)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    
    # Compute kurtosis of the distribution
    mean_price = np.average(bin_centers, weights=hist)
    var = np.average((bin_centers - mean_price)**2, weights=hist)
    std = np.sqrt(var) if var > 0 else 1e-8
    kurt = np.average(((bin_centers - mean_price) / std)**4, weights=hist) - 3
    
    # Also use volatility
    vol = market.pct_change().rolling(21).std().iloc[-1] * np.sqrt(252)
    
    if vol > 0.30:
        return 0   # crisis
    elif kurt > 3.0 and vol < 0.15:
        return 2   # trending/bull (concentrated distribution)
    elif kurt < 0.5:
        return 3   # ranging/transition (flat distribution)
    else:
        return 1   # normal

def get_allocations(regime, data, tickers, config):
    """Weight by inverse volatility, scaled by regime conviction."""
    avail = [t for t in tickers if t in data.columns]
    if not avail:
        return {t: 1.0 / len(tickers) for t in tickers}
    
    # Inverse vol weighting
    vols = data[avail].pct_change().rolling(63).std().iloc[-1] * np.sqrt(252)
    inv_vol = 1.0 / vols.clip(lower=0.01)
    weights = inv_vol / inv_vol.sum()
    
    # Scale by regime
    exposure = {0: 0.3, 1: 0.7, 2: 1.0, 3: 0.5}.get(regime, 0.5)
    return {t: float(weights[t] * exposure) for t in avail}
```

This approach:
- Uses only historical prices available at time `t`
- Builds D1-style distribution from past data only
- Derives regime signal from distribution shape (kurtosis)
- Combines with realized vol for robustness
- No GMM model fitted on future data

---

## Built-in Templates

### 1. HMM Regime Switching (`hmm_regime`)
- Gaussian HMM with 4 regimes trained on returns, vol, trend features
- Mean-variance optimization with Ledoit-Wolf shrinkage per regime
- Default: GICS sector ETFs, quarterly rebalance

### 2. Simple Volatility (`simple_vol`)
- Realized vol thresholds for regime classification
- Crisis: reduce exposure; Bull: momentum tilt
- Default: SPY/QQQ/IWM/EFA/EEM/TLT/GLD, monthly rebalance

### 3. Dual MA Momentum (`momentum`)
- 50/200 SMA crossover for trend regime
- 12-1 month momentum factor for weighting
- Default: Sector ETFs, monthly rebalance, rolling 2yr window
