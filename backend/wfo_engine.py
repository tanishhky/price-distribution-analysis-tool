"""
Walk-Forward Optimization Engine
Splits data into overlapping train/test folds, runs a grid search on the train fold,
then evaluates the best parameter configuration on the out-of-sample test fold.
Stitches the out-of-sample equity curves together to create an unbiased backtest.
"""

import pandas as pd
import numpy as np
import itertools
from typing import Dict, List, Any
from strategy_engine import run_manual_strategy

def run_walk_forward_optimization(
    code: str,
    data: pd.DataFrame,
    base_config: dict,
    param_grid: dict,
    n_folds: int = 5,
    train_ratio: float = 0.7,
    initial_capital: float = 100000.0,
) -> dict:
    """
    Run Out-of-Sample Walk-Forward Optimization.
    """
    if data.empty:
        raise ValueError("Data cannot be empty for WFO.")
    
    total_len = len(data)
    if total_len < 500:
        raise ValueError(f"Not enough data for WFO (need >500 rows, got {total_len})")

    keys = list(param_grid.keys())
    values = list(param_grid.values())
    combos = list(itertools.product(*values))
    
    if len(combos) > 50:
        raise ValueError(f"Too many combinations for WFO ({len(combos)}). Max 50 per fold.")

    # Create fold indices
    # We want sequential overlapping windows.
    # Ex: 5 folds. Test periods are non-overlapping chunks taking up the last 50% of data.
    # Train periods are rolling windows just before the test period.
    
    test_size = int((1.0 - train_ratio) * total_len / n_folds)
    train_size = int(train_ratio * total_len)
    
    if test_size < 21:
        raise ValueError("Test chunk size too small (<21 days). Reduce n_folds or adjust train_ratio.")
        
    folds = []
    end_idx = total_len
    for i in range(n_folds):
        start_test = end_idx - test_size
        start_train = max(0, start_test - train_size)
        folds.append({'train': (start_train, start_test), 'test': (start_test, end_idx)})
        end_idx = start_test
        
    folds.reverse()  # chronological order
    
    fold_results = []
    oos_daily_log = []
    current_capital = initial_capital
    
    for fold_idx, fold in enumerate(folds):
        train_data = data.iloc[fold['train'][0] : fold['train'][1]].copy()
        test_data = data.iloc[fold['test'][0] : fold['test'][1]].copy()
        
        # 1. Grid Search In-Sample
        best_sharpe = -100
        best_params = {}
        
        for combo in combos:
            config = {**base_config}
            for k, v in zip(keys, combo):
                config[k] = v
                
            try:
                res, _ = run_manual_strategy(
                    code=code, data=train_data.copy(), config=config, initial_capital=100000
                )
                sharpe = res.get('metrics', {}).get('sharpe', -100)
                if sharpe > best_sharpe:
                    best_sharpe = sharpe
                    best_params = dict(zip(keys, combo))
            except Exception:
                continue
                
        if not best_params:
            best_params = dict(zip(keys, combos[0])) # fallback
            
        # 2. Run Out-Of-Sample with best params
        oos_config = {**base_config, **best_params}
        
        try:
            # We must prepend the min_training_days to the test data so the strategy can warm up
            warmup_needed = oos_config.get('min_training_days', 252)
            warmup_start = max(0, fold['test'][0] - warmup_needed)
            warmup_data = data.iloc[warmup_start : fold['test'][0]].copy()
            full_test_data = pd.concat([warmup_data, test_data])
            
            res, _ = run_manual_strategy(
                code=code, data=full_test_data.copy(), config=oos_config, initial_capital=current_capital
            )
            
            # Slice results to ONLY the test period (ignore warmup logs)
            test_start_date = test_data.index[0].isoformat() if hasattr(test_data.index[0], 'isoformat') else str(test_data.index[0])
            test_log = [d for d in res['daily_log'] if str(d['date']) >= test_start_date]
            
            if test_log:
                current_capital = test_log[-1]['portfolio_value']
                oos_daily_log.extend(test_log)
                
            fold_results.append({
                'fold': fold_idx + 1,
                'train_dates': [str(train_data.index[0]), str(train_data.index[-1])],
                'test_dates': [str(test_data.index[0]), str(test_data.index[-1])],
                'best_params': best_params,
                'in_sample_sharpe': best_sharpe,
                'out_of_sample_sharpe': res.get('metrics', {}).get('sharpe', 0),
                'out_of_sample_return': res.get('metrics', {}).get('total_return', 0)
            })
            
        except Exception as e:
            fold_results.append({
                'fold': fold_idx + 1,
                'error': str(e)
            })
            
    # Need to recompute total metrics from the stitched OOS daily log
    import pandas as pd_mt
    df = pd_mt.DataFrame(oos_daily_log)
    if not df.empty and 'portfolio_value' in df.columns:
        pv = df['portfolio_value'].astype(float)
        rets = pv.pct_change().dropna()
        cagr = (pv.iloc[-1] / pv.iloc[0]) ** (252 / len(pv)) - 1 if len(pv) > 252 else pv.iloc[-1]/pv.iloc[0] - 1
        vol = rets.std() * np.sqrt(252)
        sharpe = (cagr / vol) if vol > 0 else 0
        total_return = pv.iloc[-1] / pv.iloc[0] - 1
        
        running_max = pv.cummax()
        drawdown = (pv - running_max) / running_max
        max_dd = drawdown.min()
    else:
        cagr = sharpe = vol = total_return = max_dd = 0

    return {
        'folds': fold_results,
        'oos_daily_log': oos_daily_log,
        'oos_metrics': {
            'cagr': cagr,
            'sharpe': sharpe,
            'volatility': vol,
            'total_return': total_return,
            'max_drawdown': max_dd
        }
    }
