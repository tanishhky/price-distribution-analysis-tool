"""
Tearsheet Engine — Comprehensive post-backtest analytics.
Computes full quantitative tearsheet from daily_log data,
comparable to pyfolio/quantstats output.
"""

import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, List, Optional, Any
from datetime import datetime
import math
import io


def compute_tearsheet(daily_log: List[Dict], config: Dict = None) -> Dict[str, Any]:
    """
    Compute full tearsheet metrics from a daily_log.
    
    Parameters
    ----------
    daily_log : list of dict
        Each entry must have 'date', 'portfolio_value'.
        Optional: 'benchmark_value', 'regime', 'rebalanced'.
    config : dict, optional
        Strategy config with 'initial_capital', etc.
    
    Returns
    -------
    dict with sections: returns, risk, benchmark, distribution, exposure, 
                        drawdowns, monthly_returns, rolling, equity_curve
    """
    config = config or {}
    initial_capital = config.get('initial_capital', 100000)
    
    df = pd.DataFrame(daily_log)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)
    
    pv = df['portfolio_value'].astype(float)
    returns = pv.pct_change().dropna()
    n_days = len(returns)
    
    has_benchmark = 'benchmark_value' in df.columns and df['benchmark_value'].notna().sum() > 1

    # ═══════════════════════════════════════════════
    #  RETURN METRICS
    # ═══════════════════════════════════════════════
    total_return = (pv.iloc[-1] / pv.iloc[0]) - 1 if len(pv) > 1 else 0
    years = n_days / 252.0
    cagr = (1 + total_return) ** (1 / max(years, 0.01)) - 1
    
    # YTD
    last_date = df['date'].iloc[-1]
    ytd_mask = df['date'].dt.year == last_date.year
    ytd_start = pv[ytd_mask].iloc[0] if ytd_mask.sum() > 0 else pv.iloc[0]
    ytd_return = (pv.iloc[-1] / ytd_start) - 1

    # Best/worst day
    best_day = float(returns.max()) if len(returns) > 0 else 0
    worst_day = float(returns.min()) if len(returns) > 0 else 0
    best_day_date = str(df['date'].iloc[returns.idxmax() + 1].date()) if len(returns) > 0 else None
    worst_day_date = str(df['date'].iloc[returns.idxmin() + 1].date()) if len(returns) > 0 else None

    # Monthly returns
    df_m = df.set_index('date')[['portfolio_value']].copy()
    monthly_vals = df_m['portfolio_value'].resample('ME').last().dropna()
    monthly_returns_series = monthly_vals.pct_change().dropna()
    
    best_month = float(monthly_returns_series.max()) if len(monthly_returns_series) > 0 else 0
    worst_month = float(monthly_returns_series.min()) if len(monthly_returns_series) > 0 else 0

    # Yearly returns
    yearly_vals = df_m['portfolio_value'].resample('YE').last().dropna()
    yearly_returns_series = yearly_vals.pct_change().dropna()
    best_year = float(yearly_returns_series.max()) if len(yearly_returns_series) > 0 else 0
    worst_year = float(yearly_returns_series.min()) if len(yearly_returns_series) > 0 else 0

    # Monthly returns heatmap (year × month matrix)
    monthly_heatmap = _build_monthly_heatmap(df)

    # Rolling returns
    rolling_returns = {}
    for label, window in [('1Y', 252), ('3Y', 756), ('5Y', 1260)]:
        if len(pv) > window:
            roll = (pv / pv.shift(window) - 1).dropna()
            rolling_returns[label] = {
                'current': round(float(roll.iloc[-1]), 4),
                'mean': round(float(roll.mean()), 4),
                'min': round(float(roll.min()), 4),
                'max': round(float(roll.max()), 4),
            }

    # Ratios
    ann_vol = float(returns.std() * np.sqrt(252)) if n_days > 1 else 0
    
    # Max drawdown
    cummax = pv.cummax()
    dd = (pv - cummax) / cummax
    max_dd = float(dd.min())
    
    calmar = cagr / abs(max_dd) if max_dd != 0 else 0
    
    # Sortino (downside deviation)
    downside = returns[returns < 0]
    downside_std = float(downside.std() * np.sqrt(252)) if len(downside) > 1 else 0.001
    sortino = cagr / downside_std if downside_std > 0 else 0
    
    # Omega ratio
    threshold = 0
    gains = returns[returns > threshold].sum()
    losses = abs(returns[returns <= threshold].sum())
    omega = float(gains / losses) if losses > 0 else float('inf')
    
    # Tail ratio
    if len(returns) > 20:
        p95 = np.percentile(returns, 95)
        p5 = abs(np.percentile(returns, 5))
        tail_ratio = float(p95 / p5) if p5 > 0 else 0
    else:
        tail_ratio = 0
    
    sharpe = cagr / ann_vol if ann_vol > 0 else 0
    
    return_metrics = {
        'total_return': round(total_return, 4),
        'cagr': round(cagr, 4),
        'ytd_return': round(float(ytd_return), 4),
        'annualized_volatility': round(ann_vol, 4),
        'sharpe': round(sharpe, 2),
        'sortino': round(sortino, 2),
        'calmar': round(calmar, 2),
        'omega': round(min(omega, 99.99), 2),
        'tail_ratio': round(tail_ratio, 2),
        'best_day': round(best_day, 4), 'best_day_date': best_day_date,
        'worst_day': round(worst_day, 4), 'worst_day_date': worst_day_date,
        'best_month': round(best_month, 4),
        'worst_month': round(worst_month, 4),
        'best_year': round(best_year, 4),
        'worst_year': round(worst_year, 4),
        'rolling_returns': rolling_returns,
        'win_rate': round(float((returns > 0).mean()), 4) if len(returns) > 0 else 0,
    }

    # ═══════════════════════════════════════════════
    #  RISK METRICS
    # ═══════════════════════════════════════════════
    
    # Rolling volatility
    rolling_vol = {}
    for label, window in [('63d', 63), ('126d', 126), ('252d', 252)]:
        rv = returns.rolling(window).std() * np.sqrt(252)
        rv = rv.dropna()
        if len(rv) > 0:
            rolling_vol[label] = {
                'current': round(float(rv.iloc[-1]), 4),
                'mean': round(float(rv.mean()), 4),
                'min': round(float(rv.min()), 4),
                'max': round(float(rv.max()), 4),
            }
    
    # VaR
    var_95_hist = float(np.percentile(returns, 5)) if len(returns) > 20 else 0
    var_99_hist = float(np.percentile(returns, 1)) if len(returns) > 20 else 0
    
    # Parametric (Gaussian) VaR
    mu_r = float(returns.mean())
    sigma_r = float(returns.std())
    var_95_param = mu_r - 1.645 * sigma_r if sigma_r > 0 else 0
    var_99_param = mu_r - 2.326 * sigma_r if sigma_r > 0 else 0
    
    # Cornish-Fisher VaR
    if len(returns) > 30:
        skew_r = float(stats.skew(returns))
        kurt_r = float(stats.kurtosis(returns))
        z = 1.645
        cf_z = z + (z**2 - 1) * skew_r / 6 + (z**3 - 3*z) * kurt_r / 24 - (2*z**3 - 5*z) * skew_r**2 / 36
        var_95_cf = mu_r - cf_z * sigma_r
    else:
        var_95_cf = var_95_param
    
    # CVaR (Expected Shortfall)
    cvar_95 = float(returns[returns <= var_95_hist].mean()) if (returns <= var_95_hist).sum() > 0 else var_95_hist
    cvar_99 = float(returns[returns <= var_99_hist].mean()) if (returns <= var_99_hist).sum() > 0 else var_99_hist
    
    # Max drawdown duration
    dd_info = _compute_drawdown_table(df)
    max_dd_duration = dd_info['max_dd_duration_days']
    
    # Ulcer Index
    dd_sq = dd ** 2
    ulcer_index = float(np.sqrt(dd_sq.mean())) if len(dd) > 0 else 0
    
    # Pain Index (mean of absolute drawdowns)
    pain_index = float(abs(dd).mean()) if len(dd) > 0 else 0
    
    risk_metrics = {
        'rolling_volatility': rolling_vol,
        'var_95_historical': round(var_95_hist, 4),
        'var_99_historical': round(var_99_hist, 4),
        'var_95_parametric': round(var_95_param, 4),
        'var_99_parametric': round(var_99_param, 4),
        'var_95_cornish_fisher': round(float(var_95_cf), 4),
        'cvar_95': round(cvar_95, 4),
        'cvar_99': round(cvar_99, 4),
        'max_drawdown': round(max_dd, 4),
        'max_drawdown_duration_days': max_dd_duration,
        'ulcer_index': round(ulcer_index, 4),
        'pain_index': round(pain_index, 4),
    }

    # ═══════════════════════════════════════════════
    #  BENCHMARK COMPARISON
    # ═══════════════════════════════════════════════
    benchmark_metrics = {}
    if has_benchmark:
        bv = df['benchmark_value'].dropna().astype(float)
        b_ret = bv.pct_change().dropna()
        b_total = (bv.iloc[-1] / bv.iloc[0]) - 1
        b_years = len(b_ret) / 252.0
        b_cagr = (1 + b_total) ** (1 / max(b_years, 0.01)) - 1
        b_vol = float(b_ret.std() * np.sqrt(252))
        b_sharpe = b_cagr / b_vol if b_vol > 0 else 0
        b_cummax = bv.cummax()
        b_dd = (bv - b_cummax) / b_cummax
        
        # Active return
        active_return = cagr - b_cagr
        
        # Tracking error
        aligned = pd.DataFrame({'s': returns, 'b': b_ret}).dropna()
        if len(aligned) > 1:
            excess = aligned['s'] - aligned['b']
            tracking_error = float(excess.std() * np.sqrt(252))
            info_ratio = float(excess.mean() * 252) / tracking_error if tracking_error > 0 else 0
            
            # Beta & Alpha (CAPM)
            cov_mat = np.cov(aligned['s'], aligned['b'])
            beta = cov_mat[0, 1] / cov_mat[1, 1] if cov_mat[1, 1] > 0 else 1
            alpha = float(aligned['s'].mean() - beta * aligned['b'].mean()) * 252
            
            # Up/Down capture
            up_mask = aligned['b'] > 0
            down_mask = aligned['b'] < 0
            up_capture = float(aligned['s'][up_mask].mean() / aligned['b'][up_mask].mean()) if up_mask.sum() > 0 else 1
            down_capture = float(aligned['s'][down_mask].mean() / aligned['b'][down_mask].mean()) if down_mask.sum() > 0 else 1
            
            # Rolling correlation
            roll_corr = aligned['s'].rolling(63).corr(aligned['b']).dropna()
            
            # Rolling beta
            roll_beta_vals = []
            for i in range(63, len(aligned)):
                s_w = aligned['s'].iloc[i-63:i]
                b_w = aligned['b'].iloc[i-63:i]
                c = np.cov(s_w, b_w)
                rb = c[0,1] / c[1,1] if c[1,1] > 0 else 1
                roll_beta_vals.append(float(rb))
        else:
            tracking_error = 0
            info_ratio = 0
            beta = 1
            alpha = 0
            up_capture = 1
            down_capture = 1
            roll_corr = pd.Series([])
            roll_beta_vals = []
        
        benchmark_metrics = {
            'total_return': round(b_total, 4),
            'cagr': round(b_cagr, 4),
            'volatility': round(b_vol, 4),
            'sharpe': round(b_sharpe, 2),
            'max_drawdown': round(float(b_dd.min()), 4),
            'active_return': round(active_return, 4),
            'tracking_error': round(tracking_error, 4),
            'information_ratio': round(info_ratio, 2),
            'beta': round(float(beta), 3),
            'alpha': round(float(alpha), 4),
            'up_capture': round(up_capture, 3),
            'down_capture': round(down_capture, 3),
            'rolling_correlation_current': round(float(roll_corr.iloc[-1]), 3) if len(roll_corr) > 0 else None,
        }

    # ═══════════════════════════════════════════════
    #  DISTRIBUTION ANALYSIS
    # ═══════════════════════════════════════════════
    skewness = float(stats.skew(returns)) if len(returns) > 3 else 0
    kurtosis_val = float(stats.kurtosis(returns)) if len(returns) > 3 else 0
    
    # Jarque-Bera test
    if len(returns) > 20:
        jb_stat, jb_pvalue = stats.jarque_bera(returns)
    else:
        jb_stat, jb_pvalue = 0, 1
    
    # Histogram data for frontend
    hist_counts, hist_edges = np.histogram(returns, bins=50)
    hist_centers = (hist_edges[:-1] + hist_edges[1:]) / 2
    
    # Fitted normal
    normal_x = np.linspace(float(returns.min()) - 0.01, float(returns.max()) + 0.01, 100)
    normal_y = stats.norm.pdf(normal_x, mu_r, sigma_r)
    # Scale to match histogram
    bin_width = hist_edges[1] - hist_edges[0]
    normal_y_scaled = normal_y * len(returns) * bin_width
    
    distribution = {
        'skewness': round(skewness, 3),
        'kurtosis': round(kurtosis_val, 3),
        'jarque_bera_stat': round(float(jb_stat), 2),
        'jarque_bera_pvalue': round(float(jb_pvalue), 4),
        'is_normal': float(jb_pvalue) > 0.05,
        'mean_daily_return': round(mu_r * 100, 4),
        'std_daily_return': round(sigma_r * 100, 4),
        'histogram': {
            'counts': hist_counts.tolist(),
            'centers': [round(c, 5) for c in hist_centers.tolist()],
        },
        'fitted_normal': {
            'x': [round(x, 5) for x in normal_x.tolist()],
            'y': [round(y, 3) for y in normal_y_scaled.tolist()],
        },
    }

    # ═══════════════════════════════════════════════
    #  EXPOSURE & TURNOVER
    # ═══════════════════════════════════════════════
    rebalance_count = df['rebalanced'].sum() if 'rebalanced' in df.columns else 0
    
    exposure_metrics = {
        'total_rebalances': int(rebalance_count),
        'total_days': n_days,
        'years': round(years, 2),
        'initial_capital': initial_capital,
        'final_value': round(float(pv.iloc[-1]), 2),
    }

    # ═══════════════════════════════════════════════
    #  EQUITY CURVE DATA (for Plotly chart)
    # ═══════════════════════════════════════════════
    equity_curve = {
        'dates': [str(d.date()) for d in df['date']],
        'portfolio': pv.tolist(),
        'drawdown': dd.tolist(),
    }
    if has_benchmark:
        equity_curve['benchmark'] = df['benchmark_value'].tolist()
    if 'regime' in df.columns:
        equity_curve['regimes'] = df['regime'].tolist()
    
    # ═══════════════════════════════════════════════
    #  ROLLING METRICS (for Plotly charts)
    # ═══════════════════════════════════════════════
    rolling_data = _compute_rolling_data(returns, df, has_benchmark)

    return {
        'returns': return_metrics,
        'risk': risk_metrics,
        'benchmark': benchmark_metrics,
        'distribution': distribution,
        'exposure': exposure_metrics,
        'drawdowns': dd_info['drawdown_table'],
        'monthly_returns': monthly_heatmap,
        'rolling': rolling_data,
        'equity_curve': equity_curve,
    }


def _build_monthly_heatmap(df: pd.DataFrame) -> Dict:
    """Build year×month return matrix for heatmap."""
    df_temp = df.set_index('date')[['portfolio_value']].copy()
    monthly = df_temp['portfolio_value'].resample('ME').last().dropna()
    monthly_ret = monthly.pct_change().dropna()
    
    years = sorted(set(monthly_ret.index.year))
    months = list(range(1, 13))
    month_labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    
    matrix = []
    for y in years:
        row = []
        for m in months:
            vals = monthly_ret[(monthly_ret.index.year == y) & (monthly_ret.index.month == m)]
            row.append(round(float(vals.iloc[0]) * 100, 2) if len(vals) > 0 else None)
        matrix.append(row)
    
    return {
        'years': [str(y) for y in years],
        'months': month_labels,
        'matrix': matrix,
    }


def _compute_drawdown_table(df: pd.DataFrame) -> Dict:
    """Compute top 5 drawdowns with start, trough, recovery dates."""
    pv = df['portfolio_value'].astype(float)
    dates = df['date']
    cummax = pv.cummax()
    dd = (pv - cummax) / cummax
    
    # Find drawdown periods
    drawdowns = []
    in_dd = False
    dd_start = None
    dd_trough = None
    dd_trough_val = 0
    
    for i in range(len(dd)):
        if dd.iloc[i] < 0:
            if not in_dd:
                in_dd = True
                dd_start = i
                dd_trough = i
                dd_trough_val = dd.iloc[i]
            elif dd.iloc[i] < dd_trough_val:
                dd_trough = i
                dd_trough_val = dd.iloc[i]
        else:
            if in_dd:
                drawdowns.append({
                    'start_date': str(dates.iloc[dd_start].date()),
                    'trough_date': str(dates.iloc[dd_trough].date()),
                    'recovery_date': str(dates.iloc[i].date()),
                    'depth': round(float(dd_trough_val), 4),
                    'duration_days': i - dd_start,
                    'recovery_days': i - dd_trough,
                })
                in_dd = False
    
    # Handle ongoing drawdown
    if in_dd:
        drawdowns.append({
            'start_date': str(dates.iloc[dd_start].date()),
            'trough_date': str(dates.iloc[dd_trough].date()),
            'recovery_date': None,
            'depth': round(float(dd_trough_val), 4),
            'duration_days': len(dd) - dd_start,
            'recovery_days': None,
        })
    
    # Sort by depth (most negative first), take top 5
    drawdowns.sort(key=lambda x: x['depth'])
    top5 = drawdowns[:5]
    
    max_duration = max((d['duration_days'] for d in drawdowns), default=0)
    
    return {
        'drawdown_table': top5,
        'max_dd_duration_days': max_duration,
    }


def _compute_rolling_data(returns, df, has_benchmark):
    """Compute rolling Sharpe, vol, beta, drawdown for charts."""
    window = 63  # ~3 months
    
    # Rolling Sharpe
    roll_mean = returns.rolling(window).mean() * 252
    roll_std = returns.rolling(window).std() * np.sqrt(252)
    roll_sharpe = (roll_mean / roll_std).dropna()
    
    # Rolling drawdown (already have cumulative, compute rolling max DD)
    pv = df['portfolio_value'].astype(float)
    roll_dd = pd.Series(index=pv.index, dtype=float)
    for i in range(window, len(pv)):
        w = pv.iloc[i-window:i+1]
        cm = w.cummax()
        d = (w - cm) / cm
        roll_dd.iloc[i] = d.min()
    roll_dd = roll_dd.dropna()
    
    dates_for_rolling = [str(df['date'].iloc[i].date()) for i in roll_sharpe.index]
    
    result = {
        'dates': dates_for_rolling,
        'sharpe': [round(float(v), 3) for v in roll_sharpe.values],
        'volatility': [round(float(v), 4) for v in (returns.rolling(window).std() * np.sqrt(252)).dropna().values],
        'drawdown': [round(float(v), 4) for v in roll_dd.values[-len(dates_for_rolling):]],
    }
    
    # Rolling beta (if benchmark exists)
    if has_benchmark and 'benchmark_value' in df.columns:
        bv = df['benchmark_value'].astype(float)
        b_ret = bv.pct_change()
        aligned = pd.DataFrame({'s': returns, 'b': b_ret}).dropna()
        
        roll_betas = []
        for i in range(window, len(aligned)):
            sw = aligned['s'].iloc[i-window:i]
            bw = aligned['b'].iloc[i-window:i]
            c = np.cov(sw, bw)
            beta = c[0,1] / c[1,1] if c[1,1] > 0 else 1
            roll_betas.append(round(float(beta), 3))
        
        # Trim to match dates
        result['beta'] = roll_betas[-len(dates_for_rolling):] if len(roll_betas) >= len(dates_for_rolling) else roll_betas
    
    return result


# ═══════════════════════════════════════════════
#  MONTE CARLO SIMULATION
# ═══════════════════════════════════════════════

def monte_carlo_simulation(daily_log: List[Dict], n_sims: int = 10000, 
                           horizon_days: int = 252, block_size: int = 21) -> Dict:
    """
    Block bootstrap Monte Carlo simulation.
    
    Uses block bootstrap (default 21-day blocks) to preserve autocorrelation.
    Simulates n_sims paths forward from current portfolio value.
    """
    df = pd.DataFrame(daily_log)
    pv = df['portfolio_value'].astype(float)
    returns = pv.pct_change().dropna().values
    
    if len(returns) < block_size * 2:
        return {'error': 'Not enough data for Monte Carlo simulation'}
    
    start_value = float(pv.iloc[-1])
    n_blocks = math.ceil(horizon_days / block_size)
    
    terminal_values = []
    max_drawdowns = []
    paths_sample = []  # Store subset of paths for fan chart
    
    for sim in range(n_sims):
        # Block bootstrap
        path = [start_value]
        for _ in range(n_blocks):
            # Random block start
            start_idx = np.random.randint(0, len(returns) - block_size)
            block = returns[start_idx:start_idx + block_size]
            for r in block:
                path.append(path[-1] * (1 + r))
        
        path = path[:horizon_days + 1]
        terminal_values.append(path[-1])
        
        # Max drawdown of simulated path
        peak = path[0]
        max_dd = 0
        for v in path:
            peak = max(peak, v)
            dd = (v - peak) / peak
            max_dd = min(max_dd, dd)
        max_drawdowns.append(max_dd)
        
        # Store every 200th path for fan chart
        if sim % (n_sims // 50) == 0:
            paths_sample.append([round(v, 2) for v in path])
    
    terminal_values = np.array(terminal_values)
    max_drawdowns = np.array(max_drawdowns)
    
    # Percentiles
    percentiles = [5, 10, 25, 50, 75, 90, 95]
    terminal_pcts = {f'p{p}': round(float(np.percentile(terminal_values, p)), 2) for p in percentiles}
    dd_pcts = {f'p{p}': round(float(np.percentile(max_drawdowns, p)), 4) for p in percentiles}
    
    # Sharpe distribution
    sharpe_values = []
    for path in paths_sample:
        p_arr = np.array(path)
        p_ret = np.diff(p_arr) / p_arr[:-1]
        if len(p_ret) > 1 and np.std(p_ret) > 0:
            s = (np.mean(p_ret) * 252) / (np.std(p_ret) * np.sqrt(252))
            sharpe_values.append(float(s))
    
    return {
        'n_simulations': n_sims,
        'horizon_days': horizon_days,
        'block_size': block_size,
        'start_value': start_value,
        'terminal_wealth': terminal_pcts,
        'max_drawdown': dd_pcts,
        'prob_loss': round(float((terminal_values < start_value).mean()), 4),
        'prob_gain_20pct': round(float((terminal_values > start_value * 1.2).mean()), 4),
        'expected_terminal': round(float(terminal_values.mean()), 2),
        'fan_chart_paths': paths_sample,
    }


# ═══════════════════════════════════════════════
#  PDF REPORT GENERATION
# ═══════════════════════════════════════════════

def generate_pdf_report(tearsheet: Dict, strategy_name: str = 'Strategy', 
                        config: Dict = None) -> bytes:
    """Generate a professional PDF report from tearsheet data."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
    except ImportError:
        raise ImportError("reportlab required for PDF generation. Install with: pip install reportlab")
    
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        raise ImportError("matplotlib required for PDF charts. Install with: pip install matplotlib")
    
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=22, textColor=colors.HexColor('#1a1a2e'), spaceAfter=6)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=11, textColor=colors.grey, spaceAfter=20)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, textColor=colors.HexColor('#1a1a2e'), spaceBefore=16, spaceAfter=8)
    
    elements = []
    
    # Title
    elements.append(Paragraph(f"📊 {strategy_name} — Tearsheet Report", title_style))
    ret = tearsheet.get('returns', {})
    exp = tearsheet.get('exposure', {})
    elements.append(Paragraph(f"Period: {exp.get('years', '?')} years | Initial Capital: ${exp.get('initial_capital', 0):,.0f} | Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", subtitle_style))
    
    # Key Metrics
    elements.append(Paragraph("Key Performance Metrics", heading_style))
    
    risk = tearsheet.get('risk', {})
    bench = tearsheet.get('benchmark', {})
    dist = tearsheet.get('distribution', {})
    
    metrics_data = [
        ['Metric', 'Strategy', 'Benchmark'],
        ['CAGR', f"{ret.get('cagr',0)*100:.1f}%", f"{bench.get('cagr',0)*100:.1f}%" if bench else 'N/A'],
        ['Total Return', f"{ret.get('total_return',0)*100:.1f}%", f"{bench.get('total_return',0)*100:.1f}%" if bench else 'N/A'],
        ['Sharpe Ratio', f"{ret.get('sharpe',0):.2f}", f"{bench.get('sharpe',0):.2f}" if bench else 'N/A'],
        ['Sortino Ratio', f"{ret.get('sortino',0):.2f}", 'N/A'],
        ['Calmar Ratio', f"{ret.get('calmar',0):.2f}", 'N/A'],
        ['Max Drawdown', f"{risk.get('max_drawdown',0)*100:.1f}%", f"{bench.get('max_drawdown',0)*100:.1f}%" if bench else 'N/A'],
        ['Volatility', f"{ret.get('annualized_volatility',0)*100:.1f}%", f"{bench.get('volatility',0)*100:.1f}%" if bench else 'N/A'],
        ['Win Rate', f"{ret.get('win_rate',0)*100:.1f}%", 'N/A'],
        ['VaR (95%)', f"{risk.get('var_95_historical',0)*100:.2f}%", 'N/A'],
        ['CVaR (95%)', f"{risk.get('cvar_95',0)*100:.2f}%", 'N/A'],
        ['Skewness', f"{dist.get('skewness',0):.3f}", 'N/A'],
        ['Kurtosis', f"{dist.get('kurtosis',0):.3f}", 'N/A'],
    ]
    
    if bench:
        metrics_data.extend([
            ['Alpha (ann.)', f"{bench.get('alpha',0)*100:.2f}%", '—'],
            ['Beta', f"{bench.get('beta',0):.3f}", '—'],
            ['Info Ratio', f"{bench.get('information_ratio',0):.2f}", '—'],
            ['Tracking Error', f"{bench.get('tracking_error',0)*100:.1f}%", '—'],
            ['Up Capture', f"{bench.get('up_capture',0):.2f}", '—'],
            ['Down Capture', f"{bench.get('down_capture',0):.2f}", '—'],
        ])
    
    t = Table(metrics_data, colWidths=[2.5*inch, 2*inch, 1.5*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
        ('ROWCOLORS', (0, 1), (-1, -1), colors.HexColor('#f8f8fc'), colors.white),
    ]))
    elements.append(t)
    
    # Equity Curve Chart
    eq = tearsheet.get('equity_curve', {})
    if eq.get('dates') and eq.get('portfolio'):
        elements.append(Paragraph("Equity Curve", heading_style))
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.5, 4), height_ratios=[3, 1], sharex=True)
        
        dates_dt = pd.to_datetime(eq['dates'])
        ax1.plot(dates_dt, eq['portfolio'], color='#3b82f6', linewidth=1, label='Strategy')
        if 'benchmark' in eq:
            bvals = [v for v in eq['benchmark'] if v is not None]
            if bvals:
                bdates = [d for d, v in zip(dates_dt, eq['benchmark']) if v is not None]
                ax1.plot(bdates, bvals, color='#6b7280', linewidth=0.8, alpha=0.7, label='Benchmark')
        ax1.set_ylabel('Portfolio Value', fontsize=8)
        ax1.legend(fontsize=7)
        ax1.grid(True, alpha=0.15)
        ax1.tick_params(labelsize=7)
        
        # Underwater
        ax2.fill_between(dates_dt, [d * 100 for d in eq['drawdown']], 0, color='#ef4444', alpha=0.4)
        ax2.set_ylabel('Drawdown %', fontsize=8)
        ax2.grid(True, alpha=0.15)
        ax2.tick_params(labelsize=7)
        
        plt.tight_layout()
        chart_buf = io.BytesIO()
        fig.savefig(chart_buf, format='png', dpi=150, bbox_inches='tight')
        plt.close(fig)
        chart_buf.seek(0)
        elements.append(Image(chart_buf, width=7*inch, height=3.8*inch))
    
    # Drawdown Table
    dds = tearsheet.get('drawdowns', [])
    if dds:
        elements.append(Paragraph("Top Drawdowns", heading_style))
        dd_data = [['#', 'Start', 'Trough', 'Recovery', 'Depth', 'Duration (d)']]
        for i, d in enumerate(dds[:5]):
            dd_data.append([
                str(i+1), d['start_date'], d['trough_date'],
                d.get('recovery_date') or 'Ongoing',
                f"{d['depth']*100:.1f}%", str(d['duration_days']),
            ])
        dt = Table(dd_data, colWidths=[0.4*inch, 1.2*inch, 1.2*inch, 1.2*inch, 0.8*inch, 1*inch])
        dt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
        ]))
        elements.append(dt)
    
    doc.build(elements)
    return buf.getvalue()
