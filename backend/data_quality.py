"""
Data Quality Checks — Pre-execution validation for uploaded data.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Any


def check_data_quality(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Run comprehensive data quality checks on a DataFrame.
    
    Returns list of warnings, each with: level ('warning'|'error'|'info'), 
    message, and details.
    """
    warnings_list = []
    
    if df.empty:
        return [{'level': 'error', 'message': 'Dataset is empty', 'details': {}}]
    
    # 1. Check for duplicate timestamps
    if hasattr(df.index, 'duplicated'):
        dups = df.index.duplicated().sum()
        if dups > 0:
            warnings_list.append({
                'level': 'warning',
                'message': f'{dups} duplicate timestamps found',
                'details': {'count': int(dups)},
                'type': 'duplicate_timestamps',
            })
    
    # 2. Check for missing dates (gaps > 3 business days)
    if hasattr(df.index, 'to_series'):
        date_diffs = df.index.to_series().diff().dt.days.dropna()
        gaps = date_diffs[date_diffs > 5]  # >5 calendar days ≈ >3 business days
        if len(gaps) > 0:
            gap_details = [
                {'date': str(df.index[i].date()), 'gap_days': int(date_diffs.iloc[i])}
                for i in gaps.index[:5]
            ]
            warnings_list.append({
                'level': 'warning',
                'message': f'{len(gaps)} date gaps > 3 business days found',
                'details': {'gaps': gap_details},
                'type': 'missing_dates',
            })
    
    # 3. Check for stale prices (same close for >5 consecutive days)
    stale_tickers = []
    for col in df.columns:
        if df[col].dtype not in ['float64', 'float32', 'int64']:
            continue
        rolling_std = df[col].rolling(6).std()
        stale_count = (rolling_std == 0).sum()
        if stale_count > 5:
            stale_tickers.append(col)
    
    if stale_tickers:
        warnings_list.append({
            'level': 'warning',
            'message': f'{len(stale_tickers)} tickers have stale prices (unchanged >5 consecutive days)',
            'details': {'tickers': stale_tickers[:10]},
            'type': 'stale_prices',
        })
    
    # 4. Extreme returns (|daily return| > 50%)
    extreme_tickers = []
    for col in df.columns:
        if df[col].dtype not in ['float64', 'float32']:
            continue
        pct = df[col].pct_change().dropna()
        extremes = pct.abs() > 0.5
        if extremes.sum() > 0:
            extreme_tickers.append({
                'ticker': col,
                'count': int(extremes.sum()),
                'max': round(float(pct.abs().max()), 4),
            })
    
    if extreme_tickers:
        warnings_list.append({
            'level': 'warning',
            'message': f'{len(extreme_tickers)} tickers have extreme daily returns (>50% — likely split/error)',
            'details': {'tickers': extreme_tickers[:10]},
            'type': 'extreme_returns',
        })
    
    # 5. Survivorship bias (tickers disappearing mid-series)
    disappearing = []
    total_rows = len(df)
    for col in df.columns:
        if df[col].dtype not in ['float64', 'float32']:
            continue
        last_valid = df[col].last_valid_index()
        if last_valid is not None and last_valid < df.index[-1]:
            coverage = df[col].notna().sum() / total_rows
            if coverage < 0.9:
                disappearing.append({
                    'ticker': col,
                    'last_date': str(last_valid.date()) if hasattr(last_valid, 'date') else str(last_valid),
                    'coverage': round(coverage, 2),
                })
    
    if disappearing:
        warnings_list.append({
            'level': 'info',
            'message': f'{len(disappearing)} tickers have incomplete data (possible delisting)',
            'details': {'tickers': disappearing[:10]},
            'type': 'survivorship_bias',
        })
    
    # 6. Weekend/non-trading day data
    if hasattr(df.index, 'dayofweek'):
        weekends = (df.index.dayofweek >= 5).sum()
        if weekends > 0:
            warnings_list.append({
                'level': 'info',
                'message': f'{weekends} weekend/non-trading day rows found',
                'details': {'count': int(weekends)},
                'type': 'non_trading_days',
            })
    
    # 7. NaN summary
    nan_pct = df.isna().mean()
    high_nan = nan_pct[nan_pct > 0.2]
    if len(high_nan) > 0:
        warnings_list.append({
            'level': 'info',
            'message': f'{len(high_nan)} columns have >20% missing values',
            'details': {'columns': {str(k): round(v, 2) for k, v in high_nan.head(10).items()}},
            'type': 'missing_values',
        })
    
    # Summary
    if not warnings_list:
        warnings_list.append({
            'level': 'info',
            'message': 'All data quality checks passed',
            'details': {},
            'type': 'all_passed',
        })
    
    return warnings_list
