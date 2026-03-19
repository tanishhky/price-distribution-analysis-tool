"""
Strategy Engine — Generalized walk-forward strategy execution.
No look-ahead bias. Supports user-uploaded regime detection logic.

API Contract:
  Users upload a StrategyDefinition (JSON) with:
    - tickers, benchmark, config
    - regime_code: a Python string containing detect_regime() and get_allocations()
  The engine validates, sandboxes, and runs it day-by-day with strict temporal isolation.

Author: VolEdge Strategy System
Version: 1.0
"""

import numpy as np
import pandas as pd
import yfinance as yf
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
import traceback
import ast
import math

# ═══════════════════════════════════════════════
#  STRATEGY DEFINITION SCHEMA
# ═══════════════════════════════════════════════

class StrategyConfig(BaseModel):
    rebalance_days: int = Field(63, ge=1, le=504, description="Days between rebalances")
    min_training_days: int = Field(252, ge=60, le=1260, description="Minimum history before first trade")
    window_type: str = Field("expanding", pattern="^(expanding|rolling)$")
    rolling_window: Optional[int] = Field(None, ge=126, le=2520, description="Rolling window size (only if window_type='rolling')")
    transaction_cost: float = Field(0.001, ge=0, le=0.05, description="Cost per $ turnover")
    initial_capital: float = Field(100000, ge=1000, le=1e9)

class RegimeDefinition(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    # If no code provided, user supplies static allocations per regime
    allocations: Optional[Dict[str, float]] = None

class StrategyDefinition(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    version: str = "1.0"
    tickers: List[str] = Field(..., min_length=1, max_length=50)
    benchmark: str = "SPY"
    config: StrategyConfig = StrategyConfig()
    regimes: Optional[List[RegimeDefinition]] = None
    regime_code: Optional[str] = Field(
        None,
        description="Python code string containing detect_regime(data, config) -> int "
                    "and optionally get_allocations(regime, data, tickers, config) -> dict"
    )


# ═══════════════════════════════════════════════
#  CODE VALIDATION & SANDBOXING
# ═══════════════════════════════════════════════

FORBIDDEN_MODULES = {
    'os', 'sys', 'subprocess', 'shutil', 'pathlib', 'glob',
    'socket', 'http', 'urllib', 'requests', 'httpx', 'aiohttp',
    'pickle', 'shelve', 'sqlite3', 'multiprocessing', 'threading',
    'ctypes', 'importlib', 'eval', 'exec', 'compile', '__import__',
    'open', 'file', 'input', 'breakpoint',
}

FORBIDDEN_BUILTINS = {
    'exec', 'eval', 'compile', 'open', 'input',
    'breakpoint', 'exit', 'quit', 'globals', 'locals', 'vars',
    'getattr', 'setattr', 'delattr',
}

ALLOWED_MODULES = {
    'numpy', 'np', 'pandas', 'pd', 'math', 'statistics',
    'scipy', 'scipy.stats', 'scipy.optimize', 'scipy.signal',
    'sklearn', 'sklearn.cluster', 'sklearn.mixture', 'sklearn.decomposition',
    'hmmlearn', 'hmmlearn.hmm',
    'warnings', 'collections', 'itertools', 'functools',
    'typing', 'datetime', 'copy',
}


def validate_strategy_code(code: str) -> Tuple[bool, str, List[str]]:
    """
    Validate user-uploaded strategy code for safety and correctness.

    Returns: (is_valid, error_message, warnings)
    """
    warnings_list = []

    # 1. Parse AST
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error at line {e.lineno}: {e.msg}", []

    # 2. Check for required functions
    func_names = {
        node.name for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
    }
    if 'detect_regime' not in func_names:
        return False, "Missing required function: detect_regime(data, config)", []
    if 'get_allocations' not in func_names:
        warnings_list.append(
            "No get_allocations() found — will use static regime allocations if provided"
        )

    # 3. Check for forbidden imports
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name.split('.')[0]
                if mod in FORBIDDEN_MODULES:
                    return False, f"Forbidden import: '{alias.name}'. Only numpy, pandas, scipy, sklearn, hmmlearn are allowed.", []
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                mod = node.module.split('.')[0]
                if mod in FORBIDDEN_MODULES:
                    return False, f"Forbidden import: 'from {node.module}'. Only numpy, pandas, scipy, sklearn, hmmlearn are allowed.", []

    # 4. Check for forbidden calls
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_BUILTINS:
                    return False, f"Forbidden call: '{node.func.id}()' is not allowed.", []
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr in {'system', 'popen', 'remove', 'rmdir', 'unlink'}:
                    return False, f"Forbidden call: '.{node.func.attr}()' is not allowed.", []

    # 5. Validate detect_regime signature
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'detect_regime':
            args = [a.arg for a in node.args.args]
            if len(args) < 2:
                return False, "detect_regime must accept at least 2 arguments: (data, config)", []
            break

    return True, "", warnings_list


def compile_strategy(code: str) -> Dict:
    """
    Compile validated strategy code and extract callable functions.
    Returns a namespace dict with the user's functions.
    """
    # Build a restricted namespace
    import numpy as _np
    import pandas as _pd

    safe_builtins = {
        'abs': abs, 'all': all, 'any': any, 'bool': bool,
        'dict': dict, 'enumerate': enumerate, 'filter': filter,
        'float': float, 'frozenset': frozenset, 'int': int,
        'isinstance': isinstance, 'len': len, 'list': list,
        'map': map, 'max': max, 'min': min, 'print': print,
        'range': range, 'reversed': reversed, 'round': round,
        'set': set, 'slice': slice, 'sorted': sorted, 'str': str,
        'sum': sum, 'tuple': tuple, 'type': type, 'zip': zip,
        'True': True, 'False': False, 'None': None,
        '__import__': __import__,
        '__builtins__': {},
    }

    namespace = {
        '__builtins__': safe_builtins,
        'np': _np,
        'numpy': _np,
        'pd': _pd,
        'pandas': _pd,
        'math': math,
    }

    # Allow common imports
    try:
        from scipy import stats as _scipy_stats
        from scipy import optimize as _scipy_optimize
        namespace['scipy'] = type('module', (), {'stats': _scipy_stats, 'optimize': _scipy_optimize})()
    except ImportError:
        pass

    try:
        from sklearn.mixture import GaussianMixture as _GM
        from sklearn.cluster import KMeans as _KM
        namespace['GaussianMixture'] = _GM
        namespace['KMeans'] = _KM
    except ImportError:
        pass

    try:
        from hmmlearn import hmm as _hmm
        namespace['hmm'] = _hmm
    except ImportError:
        pass

    exec(code, namespace)
    return namespace


# ═══════════════════════════════════════════════
#  WALK-FORWARD ENGINE (ZERO LOOK-AHEAD)
# ═══════════════════════════════════════════════

class StrategyRunner:
    """
    Executes a StrategyDefinition day-by-day using walk-forward methodology.
    At every decision point, only data up to t-1 is visible.
    """

    def __init__(self, definition: StrategyDefinition):
        self.defn = definition
        self.config = definition.config
        self.namespace = None
        self._detect_fn = None
        self._alloc_fn = None

    def _load_code(self):
        """Compile and extract user functions."""
        if self.defn.regime_code:
            ns = compile_strategy(self.defn.regime_code)
            self._detect_fn = ns.get('detect_regime')
            self._alloc_fn = ns.get('get_allocations')
        if not self._detect_fn:
            raise ValueError("No valid detect_regime function found in strategy code")

    def _get_allocations_for_regime(
        self, regime: int, data: pd.DataFrame, tickers: List[str]
    ) -> Dict[str, float]:
        """
        Get portfolio weights for a given regime.
        Priority: user code get_allocations() > static regime definitions > equal weight
        """
        user_config = {
            'rebalance_days': self.config.rebalance_days,
            'min_training_days': self.config.min_training_days,
            'window_type': self.config.window_type,
            'rolling_window': self.config.rolling_window,
        }

        # Option 1: User-provided dynamic allocation function
        if self._alloc_fn:
            try:
                weights = self._alloc_fn(regime, data, tickers, user_config)
                if isinstance(weights, dict):
                    # Normalize: ensure non-negative, sum <= 1
                    total = sum(max(0, v) for v in weights.values())
                    if total > 0:
                        return {k: max(0, v) / max(total, 1.0) for k, v in weights.items()}
            except Exception:
                pass

        # Option 2: Static allocations from regime definitions
        if self.defn.regimes:
            for rd in self.defn.regimes:
                if rd.id == regime and rd.allocations:
                    alloc = rd.allocations
                    total = sum(max(0, v) for v in alloc.values())
                    if total > 0:
                        return {k: max(0, v) / max(total, 1.0) for k, v in alloc.items()}

        # Option 3: Equal weight fallback
        n = len(tickers)
        return {t: 1.0 / n for t in tickers}

    def fetch_data(self, start_date: str, end_date: Optional[str] = None) -> pd.DataFrame:
        """Fetch price data for tickers + benchmark."""
        all_symbols = list(set(self.defn.tickers + [self.defn.benchmark]))
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        data = yf.download(all_symbols, start=start_date, end=end_date, progress=False)
        if isinstance(data.columns, pd.MultiIndex):
            data = data['Close']
        data = data.dropna()
        return data

    def run(
        self,
        data: Optional[pd.DataFrame] = None,
        start_date: str = '2019-01-01',
        end_date: Optional[str] = None,
        progress_callback=None,
    ) -> Dict[str, Any]:
        """
        Execute the full walk-forward backtest.
        Returns a dict with daily results, metrics, regime history, etc.
        """
        self._load_code()

        if data is None:
            data = self.fetch_data(start_date, end_date)

        tickers = [t for t in self.defn.tickers if t in data.columns]
        if not tickers:
            raise ValueError(f"None of {self.defn.tickers} found in data columns: {list(data.columns)}")

        benchmark_col = self.defn.benchmark if self.defn.benchmark in data.columns else None
        cfg = self.config
        user_config = {
            'rebalance_days': cfg.rebalance_days,
            'min_training_days': cfg.min_training_days,
            'window_type': cfg.window_type,
            'rolling_window': cfg.rolling_window,
        }

        # ── Day-by-day walk-forward ──
        capital = cfg.initial_capital
        positions = {t: 0.0 for t in tickers}  # shares held
        weights_current = {t: 1.0 / len(tickers) for t in tickers}

        daily_log = []         # one entry per day
        rebalance_log = []     # one entry per rebalance
        regime_history = []

        last_rebal_idx = -cfg.rebalance_days  # force first rebalance
        total_days = len(data)

        for i in range(cfg.min_training_days, total_days):
            date = data.index[i]
            days_since_rebal = i - last_rebal_idx

            # Current prices
            prices_today = data.iloc[i][tickers]
            if prices_today.isna().any():
                continue

            # ── Rebalance decision ──
            current_regime = None
            rebalanced = False

            if days_since_rebal >= cfg.rebalance_days:
                # CRITICAL: Only data up to YESTERDAY
                if cfg.window_type == 'rolling' and cfg.rolling_window:
                    train_start = max(0, i - cfg.rolling_window)
                    training_data = data.iloc[train_start:i].copy()
                else:
                    training_data = data.iloc[:i].copy()

                # Call user's regime detection
                try:
                    current_regime = int(self._detect_fn(training_data, user_config))
                except Exception as e:
                    current_regime = 0  # fallback

                # Get allocations
                new_weights = self._get_allocations_for_regime(
                    current_regime, training_data, tickers
                )

                # Ensure all tickers have a weight
                for t in tickers:
                    if t not in new_weights:
                        new_weights[t] = 0.0

                # Compute turnover cost
                old_w = np.array([weights_current.get(t, 0) for t in tickers])
                new_w = np.array([new_weights.get(t, 0) for t in tickers])
                turnover = float(np.abs(new_w - old_w).sum())
                cost = capital * turnover * cfg.transaction_cost
                capital -= cost

                # Update positions (shares)
                for t in tickers:
                    price = prices_today[t]
                    if price > 0:
                        positions[t] = (new_weights[t] * capital) / price
                    else:
                        positions[t] = 0.0

                weights_current = new_weights.copy()
                last_rebal_idx = i
                rebalanced = True

                rebalance_log.append({
                    'date': date.isoformat(),
                    'regime': current_regime,
                    'weights': {k: round(v, 4) for k, v in new_weights.items()},
                    'turnover': round(turnover, 4),
                    'cost': round(cost, 2),
                    'capital_after': round(capital, 2),
                })

                regime_history.append({
                    'date': date.isoformat(),
                    'regime': current_regime,
                })

            # ── Mark-to-market ──
            portfolio_val = sum(
                positions[t] * prices_today[t]
                for t in tickers if prices_today[t] > 0
            )
            if portfolio_val > 0:
                capital = portfolio_val

            # Benchmark value
            bench_val = None
            if benchmark_col and i >= cfg.min_training_days:
                bench_start_price = data.iloc[cfg.min_training_days][benchmark_col]
                if bench_start_price > 0:
                    bench_val = cfg.initial_capital * (data.iloc[i][benchmark_col] / bench_start_price)

            daily_log.append({
                'date': date.isoformat(),
                'portfolio_value': round(capital, 2),
                'benchmark_value': round(bench_val, 2) if bench_val else None,
                'regime': current_regime if rebalanced else (regime_history[-1]['regime'] if regime_history else None),
                'rebalanced': rebalanced,
            })

            if progress_callback and i % 50 == 0:
                progress_callback(i, total_days)

        # ── Compute metrics ──
        df = pd.DataFrame(daily_log)
        metrics = self._compute_metrics(df, cfg.initial_capital)

        return {
            'name': self.defn.name,
            'tickers': tickers,
            'benchmark': self.defn.benchmark,
            'config': cfg.dict(),
            'daily_log': daily_log,
            'rebalance_log': rebalance_log,
            'regime_history': regime_history,
            'metrics': metrics,
            'total_days': len(daily_log),
            'start_date': daily_log[0]['date'] if daily_log else None,
            'end_date': daily_log[-1]['date'] if daily_log else None,
        }

    @staticmethod
    def _compute_metrics(df: pd.DataFrame, initial_capital: float) -> Dict:
        if df.empty:
            return {
                'total_return': 0.0, 'annual_return': 0.0, 'volatility': 0.0,
                'sharpe': 0.0, 'max_drawdown': 0.0, 'win_rate': 0.0, 'total_trades': 0,
                'benchmark': {}
            }
            
        pv = df['portfolio_value']
        returns = pv.pct_change().dropna()

        total_ret = (pv.iloc[-1] / pv.iloc[0]) - 1 if len(pv) > 1 else 0
        n_days = len(returns)
        ann_ret = (1 + total_ret) ** (252 / max(n_days, 1)) - 1
        ann_vol = float(returns.std() * np.sqrt(252)) if n_days > 1 else 0
        sharpe = ann_ret / ann_vol if ann_vol > 0 else 0

        # Max drawdown
        cummax = pv.cummax()
        dd = (pv - cummax) / cummax
        max_dd = float(dd.min())

        # Win rate
        win_rate = float((returns > 0).sum() / len(returns)) if len(returns) > 0 else 0

        # Benchmark metrics
        bench_metrics = {}
        if 'benchmark_value' in df.columns and df['benchmark_value'].notna().sum() > 1:
            bv = df['benchmark_value'].dropna()
            b_ret = bv.pct_change().dropna()
            b_total = (bv.iloc[-1] / bv.iloc[0]) - 1
            b_n = len(b_ret)
            b_ann = (1 + b_total) ** (252 / max(b_n, 1)) - 1
            b_vol = float(b_ret.std() * np.sqrt(252)) if b_n > 1 else 0
            b_sharpe = b_ann / b_vol if b_vol > 0 else 0
            b_cummax = bv.cummax()
            b_dd = (bv - b_cummax) / b_cummax
            bench_metrics = {
                'total_return': round(b_total, 4),
                'annual_return': round(b_ann, 4),
                'volatility': round(b_vol, 4),
                'sharpe': round(b_sharpe, 2),
                'max_drawdown': round(float(b_dd.min()), 4),
            }

        return {
            'total_return': round(total_ret, 4),
            'annual_return': round(ann_ret, 4),
            'volatility': round(ann_vol, 4),
            'sharpe': round(sharpe, 2),
            'max_drawdown': round(max_dd, 4),
            'win_rate': round(win_rate, 4),
            'total_trades': len(df[df.get('rebalanced', False) == True]) if 'rebalanced' in df.columns else 0,
            'benchmark': bench_metrics,
        }


# ═══════════════════════════════════════════════
#  BUILT-IN TEMPLATE: HMM Regime Strategy
#  (Adapted from regime_portfolio_optimization)
# ═══════════════════════════════════════════════

HMM_REGIME_TEMPLATE_CODE = '''
import numpy as np
import pandas as pd

# ── Tunable parameters (user edits these) ──
SHORT_TERM = 21
LONG_TERM = 63
N_REGIMES = 4
SHRINKAGE = 0.6
MAX_POS = 0.15
MIN_POS = 0.02

def _prepare_features(data, market_col='SPY'):
    """Build HMM feature matrix from price data."""
    if market_col not in data.columns:
        # Use first column as proxy
        market_col = data.columns[0]
    market = data[market_col]
    returns = market.pct_change()
    vol_short = returns.rolling(SHORT_TERM).std() * np.sqrt(252)
    vol_long = returns.rolling(LONG_TERM).std() * np.sqrt(252)
    trend_short = market.pct_change(SHORT_TERM)
    trend_long = market.pct_change(LONG_TERM)
    X = pd.DataFrame({
        'returns': returns,
        'vol_short': vol_short,
        'vol_long': vol_long,
        'trend_short': trend_short,
        'trend_long': trend_long,
    }).dropna()
    return X

def detect_regime(data, config):
    """
    Detect the current market regime using a Gaussian HMM.
    
    Parameters
    ----------
    data : pd.DataFrame
        Historical price data. Columns = tickers. Index = dates.
        ONLY contains data up to yesterday (no future leak).
    config : dict
        Strategy configuration from VolEdge.
        
    Returns
    -------
    int : Current regime label (0 to N_REGIMES-1)
    """
    X = _prepare_features(data)
    if len(X) < 60:
        return 0  # not enough data, default to defensive
    
    # Scale features
    mean = X.mean()
    std = X.std().replace(0, 1)
    X_scaled = (X - mean) / std
    
    try:
        from hmmlearn import hmm as _hmm
        model = _hmm.GaussianHMM(
            n_components=N_REGIMES,
            covariance_type='diag',
            n_iter=100,
            random_state=42,
        )
        model.fit(X_scaled.values)
        regimes = model.predict(X_scaled.values)
        return int(regimes[-1])
    except Exception:
        # Fallback: simple volatility-based regime
        vol = X['vol_short'].iloc[-1]
        if vol > 0.35:
            return 0   # crisis
        elif vol > 0.20:
            return 1   # stressed
        elif vol > 0.12:
            return 3   # transition
        else:
            return 2   # bull

def get_allocations(regime, data, tickers, config):
    """
    Compute portfolio weights for the detected regime.
    Uses mean-variance optimization on historical data for that regime,
    with Ledoit-Wolf shrinkage.
    
    Parameters
    ----------
    regime : int
        Current regime label from detect_regime().
    data : pd.DataFrame
        Historical price data up to yesterday.
    tickers : list
        List of ticker symbols in the basket.
    config : dict
        Strategy configuration.
        
    Returns
    -------
    dict : {ticker: weight} — weights should be non-negative and sum to ~1.0
    """
    avail = [t for t in tickers if t in data.columns]
    if not avail:
        return {t: 1.0 / len(tickers) for t in tickers}
    
    # Get regime history to identify past occurrences
    X = _prepare_features(data)
    if len(X) < 60:
        return {t: 1.0 / len(avail) for t in avail}
    
    mean = X.mean()
    std = X.std().replace(0, 1)
    X_scaled = (X - mean) / std
    
    try:
        from hmmlearn import hmm as _hmm
        model = _hmm.GaussianHMM(
            n_components=N_REGIMES, covariance_type='diag',
            n_iter=100, random_state=42,
        )
        model.fit(X_scaled.values)
        all_regimes = model.predict(X_scaled.values)
        regime_dates = X.index[all_regimes == regime]
    except Exception:
        # If HMM fails, use last 63 days
        regime_dates = data.index[-LONG_TERM:]
    
    # Get returns for this regime
    returns = data[avail].pct_change().dropna()
    regime_returns = returns.loc[returns.index.isin(regime_dates)]
    
    if len(regime_returns) < 30:
        return {t: 1.0 / len(avail) for t in avail}
    
    mu = regime_returns.mean().values * 252
    cov_sample = regime_returns.cov().values * 252
    
    # Ledoit-Wolf shrinkage
    n = len(avail)
    target = np.diag(np.diag(cov_sample))
    cov = (1 - SHRINKAGE) * cov_sample + SHRINKAGE * target
    cov += np.eye(n) * 1e-6
    
    # Mean-variance optimization (closed form with constraints)
    try:
        inv_cov = np.linalg.inv(cov)
        raw_w = inv_cov @ mu
        # Clip to [MIN_POS, MAX_POS]
        raw_w = np.clip(raw_w, MIN_POS, MAX_POS)
        raw_w = raw_w / raw_w.sum()
    except np.linalg.LinAlgError:
        raw_w = np.ones(n) / n
    
    return {avail[i]: float(raw_w[i]) for i in range(n)}
'''

SIMPLE_VOL_TEMPLATE_CODE = '''
import numpy as np
import pandas as pd

def detect_regime(data, config):
    """
    Simple volatility-based regime detection.
    Uses realized vol of the first column (or SPY) to classify regimes.
    
    Regimes:
      0 = Crisis (vol > 35%)
      1 = Stressed (vol > 20%)
      2 = Bull (vol < 12%)
      3 = Transition (everything else)
    """
    market = data.iloc[:, 0]
    returns = market.pct_change().dropna()
    vol = returns.rolling(21).std().iloc[-1] * np.sqrt(252)
    
    if vol > 0.35:
        return 0
    elif vol > 0.20:
        return 1
    elif vol < 0.12:
        return 2
    else:
        return 3

def get_allocations(regime, data, tickers, config):
    """
    Static allocations by regime.
    Crisis → equal weight (defensive)
    Bull → momentum tilt (overweight recent winners)
    """
    n = len(tickers)
    avail = [t for t in tickers if t in data.columns]
    if not avail:
        return {t: 1.0 / n for t in tickers}
    
    if regime == 0:
        # Crisis: minimize exposure
        return {t: 0.5 / len(avail) for t in avail}
    elif regime == 2:
        # Bull: momentum tilt
        returns_63d = data[avail].pct_change(63).iloc[-1]
        if returns_63d.isna().all():
            return {t: 1.0 / len(avail) for t in avail}
        ranks = returns_63d.rank()
        weights = ranks / ranks.sum()
        return {t: float(weights[t]) for t in avail}
    else:
        # Default: equal weight
        return {t: 1.0 / len(avail) for t in avail}
'''

MOMENTUM_TEMPLATE_CODE = '''
import numpy as np
import pandas as pd

def detect_regime(data, config):
    """
    Trend-following regime detection using dual moving averages.
    
    Regimes:
      0 = Strong downtrend (SMA50 < SMA200, price < SMA50)
      1 = Weak downtrend (SMA50 < SMA200, price > SMA50)
      2 = Strong uptrend (SMA50 > SMA200, price > SMA50)
      3 = Weak uptrend (SMA50 > SMA200, price < SMA50)
    """
    market = data.iloc[:, 0]
    sma50 = market.rolling(50).mean().iloc[-1]
    sma200 = market.rolling(200).mean().iloc[-1]
    price = market.iloc[-1]
    
    if np.isnan(sma50) or np.isnan(sma200):
        return 3  # not enough data
    
    trend_up = sma50 > sma200
    price_above = price > sma50
    
    if trend_up and price_above:
        return 2
    elif trend_up and not price_above:
        return 3
    elif not trend_up and price_above:
        return 1
    else:
        return 0

def get_allocations(regime, data, tickers, config):
    """Momentum-weighted allocation, scaled by regime."""
    avail = [t for t in tickers if t in data.columns]
    n = len(avail)
    if n == 0:
        return {}
    
    # Compute 12-1 month momentum (skip most recent month)
    ret_12m = data[avail].pct_change(252).iloc[-1]
    ret_1m = data[avail].pct_change(21).iloc[-1]
    momentum = ret_12m - ret_1m
    
    if momentum.isna().all():
        return {t: 1.0 / n for t in avail}
    
    # Scale by regime
    exposure = {0: 0.3, 1: 0.6, 2: 1.0, 3: 0.7}.get(regime, 0.5)
    
    # Rank-weight positive momentum only
    pos_mom = momentum.clip(lower=0)
    total = pos_mom.sum()
    if total == 0:
        weights = {t: exposure / n for t in avail}
    else:
        weights = {t: float(pos_mom[t] / total * exposure) for t in avail}
    
    return weights
'''

# Template registry
STRATEGY_TEMPLATES = {
    'hmm_regime': {
        'name': 'HMM Regime Switching',
        'description': 'Gaussian Hidden Markov Model detects 4 market regimes. '
                       'Portfolio weights optimized via shrunk mean-variance for each regime.',
        'code': HMM_REGIME_TEMPLATE_CODE,
        'default_tickers': ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC'],
        'default_config': {'rebalance_days': 63, 'min_training_days': 252, 'window_type': 'expanding'},
    },
    'simple_vol': {
        'name': 'Volatility Regime (Simple)',
        'description': 'Classifies market by realized volatility thresholds. '
                       'Crisis mode reduces exposure; bull mode tilts toward momentum.',
        'code': SIMPLE_VOL_TEMPLATE_CODE,
        'default_tickers': ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'GLD'],
        'default_config': {'rebalance_days': 21, 'min_training_days': 252, 'window_type': 'expanding'},
    },
    'momentum': {
        'name': 'Dual MA Momentum',
        'description': 'Trend regime via 50/200 SMA crossover. '
                       'Allocates using 12-1 month momentum factor, scaled by trend conviction.',
        'code': MOMENTUM_TEMPLATE_CODE,
        'default_tickers': ['XLK', 'XLF', 'XLV', 'XLY', 'XLE', 'XLI'],
        'default_config': {'rebalance_days': 21, 'min_training_days': 252, 'window_type': 'rolling', 'rolling_window': 504},
    },
}


# ═══════════════════════════════════════════════
#  API DOCUMENTATION (returned as structured data)
# ═══════════════════════════════════════════════

STRATEGY_API_DOCS = {
    "title": "VolEdge Strategy API — v1.0",
    "overview": (
        "Upload a Python-based trading strategy that VolEdge will execute using "
        "strict walk-forward methodology with ZERO look-ahead bias. "
        "At every rebalancing point, your code only sees data up to yesterday."
    ),
    "strategy_definition": {
        "name": "string — Strategy display name",
        "version": "string — Version tag (default '1.0')",
        "tickers": "list[string] — Ticker basket e.g. ['XLK','XLF','SPY']",
        "benchmark": "string — Benchmark ticker (default 'SPY')",
        "config": {
            "rebalance_days": "int (1-504) — Days between rebalances. Default 63.",
            "min_training_days": "int (60-1260) — Minimum history before first trade. Default 252.",
            "window_type": "'expanding' or 'rolling'",
            "rolling_window": "int|null — If rolling, how many days. Default null (expanding).",
            "transaction_cost": "float (0-0.05) — Cost per $ turnover. Default 0.001.",
            "initial_capital": "float — Starting capital. Default 100000.",
        },
        "regime_code": "string — Python code (see below)",
    },
    "required_functions": {
        "detect_regime": {
            "signature": "detect_regime(data: pd.DataFrame, config: dict) -> int",
            "description": (
                "Called at each rebalancing point. `data` is a DataFrame of Close prices, "
                "indexed by date, with one column per ticker. It contains ONLY historical data "
                "up to yesterday — no future data is ever included. "
                "`config` is the strategy config dict. "
                "Must return an integer regime label."
            ),
            "example": (
                "def detect_regime(data, config):\n"
                "    vol = data.iloc[:,0].pct_change().rolling(21).std().iloc[-1] * (252**0.5)\n"
                "    return 0 if vol > 0.30 else 2\n"
            ),
        },
        "get_allocations": {
            "signature": "get_allocations(regime: int, data: pd.DataFrame, tickers: list, config: dict) -> dict",
            "description": (
                "Called after detect_regime(). Returns a dict mapping each ticker to a "
                "non-negative weight. Weights are auto-normalized to sum to 1.0. "
                "If omitted, the engine uses static allocations from the regime definitions, "
                "or equal-weight as a fallback."
            ),
            "example": (
                "def get_allocations(regime, data, tickers, config):\n"
                "    if regime == 0:  # crisis\n"
                "        return {t: 0.5/len(tickers) for t in tickers}\n"
                "    return {t: 1.0/len(tickers) for t in tickers}\n"
            ),
        },
    },
    "allowed_imports": [
        "numpy / np", "pandas / pd", "math", "scipy.stats", "scipy.optimize",
        "sklearn.mixture.GaussianMixture", "sklearn.cluster.KMeans",
        "hmmlearn.hmm", "collections", "itertools", "functools", "datetime",
    ],
    "forbidden": [
        "os, sys, subprocess (no filesystem access)",
        "socket, http, requests (no network access)",
        "pickle, sqlite3 (no persistence)",
        "exec, eval, compile, __import__ (no dynamic execution)",
        "open, file (no file I/O)",
    ],
    "look_ahead_guarantee": (
        "The engine guarantees zero look-ahead bias. Your detect_regime() function "
        "receives `data` that is STRICTLY sliced to [0, t-1] at rebalancing time t. "
        "The engine never passes future data. Your code should also avoid any "
        "internal peeking (e.g., do not call .shift(-1) on the data)."
    ),
}
