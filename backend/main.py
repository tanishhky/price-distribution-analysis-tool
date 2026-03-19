from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, date, timedelta
import asyncio
import numpy as np
import time
import json

from models import (
    FetchRequest, FetchResponse, AnalyzeRequest, AnalyzeResponse,
    VolatilityRequest, VolatilityResponse, VolatilityAnalysis,
    OptionsChainRequest, OptionContractWithGreeks, ReprocessRequest,
)
from polygon_client import (
    fetch_candles, fetch_candles_parallel,
    detect_asset_class, normalize_ticker, SUPPORTED_INTERVALS,
)
from options_client import (
    fetch_options_contracts, fetch_option_daily_bar,
    fetch_previous_close, fetch_option_last_trade, fetch_option_last_quote,
)
from analysis import build_distributions, fit_gmm, fit_synced_gmm, generate_results_text, compute_moment_evolution
from volatility_engine import (
    compute_realized_vol, compute_parkinson_vol, compute_gmm_weighted_vol,
    enrich_contract, build_iv_surface, compute_atm_iv, compute_put_call_skew,
    generate_signals, generate_vol_summary, _candles_per_day,
)

from strategy_engine import (
    StrategyDefinition, StrategyRunner, StrategyConfig, RegimeDefinition,
    validate_strategy_code, STRATEGY_TEMPLATES, STRATEGY_API_DOCS,
    validate_manual_strategy_code, run_manual_strategy,
)
from wfo_engine import run_walk_forward_optimization
from tearsheet_engine import compute_tearsheet, monte_carlo_simulation, generate_pdf_report
from data_quality import check_data_quality
import database as db
from config import settings
import uuid
import io
import pandas as pd

app = FastAPI(title="VolEdge — Quantitative Trading Platform", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS + ["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory store for manual mode uploaded data ──
_manual_data_store: dict = {}  # session_id -> pd.DataFrame

@app.get("/health")
async def health():
    return {"status": "ok", "service": "price-distribution-vol-tool", "version": "3.1.0"}


@app.get("/supported-intervals")
async def supported_intervals():
    return SUPPORTED_INTERVALS


# ── Existing endpoints ──

@app.post("/fetch", response_model=FetchResponse)
async def fetch(req: FetchRequest):
    """
    Fetch OHLCV candles from Polygon.

    FIX v3.1: When multiple API keys are provided, splits the date range
    across keys and fetches chunks in parallel for faster throughput.
    Single-key requests use the original sequential fetch.
    """
    try:
        asset_class = req.asset_class
        if asset_class == "auto":
            asset_class = detect_asset_class(req.ticker)

        n_keys = len(req.api_keys)

        if n_keys > 1:
            # Parallel multi-key fetch
            candles = await fetch_candles_parallel(
                api_keys=req.api_keys,
                ticker=req.ticker,
                asset_class=asset_class,
                timeframe=req.timeframe,
                start_date=req.start_date,
                end_date=req.end_date,
            )
        else:
            # Single key — sequential
            candles = await fetch_candles(
                api_key=req.api_keys[0],
                ticker=req.ticker,
                asset_class=asset_class,
                timeframe=req.timeframe,
                start_date=req.start_date,
                end_date=req.end_date,
            )

        if len(candles) == 0:
            raise HTTPException(status_code=404, detail=f"No data for {req.ticker}.")

        normalized = normalize_ticker(req.ticker, asset_class)
        return FetchResponse(
            ticker=normalized, asset_class=asset_class, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            candles=candles, total_candles=len(candles),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    """
    GMM distribution analysis.

    FIX v3.1: Consistent N handling across main GMM fit and moment evolution.
    - When sync_gmm=True AND n_components_override is None: find best shared N via combined BIC
    - When sync_gmm=True AND n_components_override is set: use override N for both (sync is moot)
    - When sync_gmm=False AND n_components_override is None: auto BIC per distribution
    - When sync_gmm=False AND n_components_override is set: use override N for both

    Moment evolution always uses the SAME N as the main GMM fit.
    """
    try:
        if len(req.candles) < 5:
            raise HTTPException(status_code=400, detail="Need at least 5 candles.")

        d1, d2, d1_raw, d2_raw, bin_centers, bin_width = build_distributions(
            candles=req.candles, num_bins=req.num_bins,
        )

        # Determine the effective N for moment evolution
        effective_n_for_moments = None  # None = let moment evolution auto-detect

        if req.sync_gmm and req.n_components_override is None:
            # Sync mode, auto N — find best shared N
            gmm_d1, gmm_d2, synced_n = fit_synced_gmm(
                bin_centers=np.array(bin_centers), d1_density=d1_raw, d2_density=d2_raw)
            effective_n_for_moments = synced_n
        elif req.n_components_override is not None and req.n_components_override >= 1:
            # Manual override — use it for both, regardless of sync toggle
            gmm_d1 = fit_gmm(bin_centers=np.array(bin_centers), density=d1_raw,
                              n_components_override=req.n_components_override)
            gmm_d2 = fit_gmm(bin_centers=np.array(bin_centers), density=d2_raw,
                              n_components_override=req.n_components_override)
            effective_n_for_moments = req.n_components_override
        else:
            # Auto, independent per distribution
            gmm_d1 = fit_gmm(bin_centers=np.array(bin_centers), density=d1_raw)
            gmm_d2 = fit_gmm(bin_centers=np.array(bin_centers), density=d2_raw)
            # Use D1's auto N for moment evolution consistency
            effective_n_for_moments = gmm_d1.n_components

        results_text = generate_results_text(
            ticker=req.ticker, asset_class=req.asset_class, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            total_candles=len(req.candles), num_bins=req.num_bins,
            gmm_d1=gmm_d1, gmm_d2=gmm_d2,
        )

        # Compute moment evolution (sliding window) with the SAME N
        moment_evo = compute_moment_evolution(
            candles=req.candles,
            window_size=max(30, len(req.candles) // req.moment_window_ratio),
            step_size=max(5, len(req.candles) // req.moment_step_ratio),
            num_bins=req.num_bins,
            n_components=effective_n_for_moments,
            sync_gmm=req.sync_gmm,
        )

        return AnalyzeResponse(
            ticker=req.ticker, asset_class=req.asset_class, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            total_candles=len(req.candles), num_bins=req.num_bins,
            d1=d1, d2=d2, gmm_d1=gmm_d1, gmm_d2=gmm_d2, results_text=results_text,
            moment_evolution=moment_evo,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Volatility Analysis endpoint ──

@app.post("/volatility", response_model=VolatilityResponse)
async def volatility_analysis(req: VolatilityRequest):
    """
    Full volatility analysis pipeline:
    1. Fetch options contracts from Polygon
    2. Get market prices for each contract
    3. Compute IV + greeks (Black-Scholes, locally)
    4. Build IV surface
    5. Compare IV vs realized vol (VRP)
    6. Generate trade signals

    FIX v3.1: Uses multiple API keys for option bar fetching (round-robin batching).
    """
    try:
        today = date.today()
        spot = req.spot_price

        if spot <= 0:
            raise HTTPException(status_code=400, detail="Invalid spot price")

        # ── Step 1: Compute realized volatility from candles ──
        cpd = _candles_per_day(req.timeframe, req.asset_class)
        w10 = max(2, int(10 * cpd))
        w20 = max(2, int(20 * cpd))
        w30 = max(2, int(30 * cpd))
        w60 = max(2, int(60 * cpd))

        rv_10 = compute_realized_vol(req.candles, w10, req.timeframe, req.asset_class)
        rv_20 = compute_realized_vol(req.candles, w20, req.timeframe, req.asset_class)
        rv_30 = compute_realized_vol(req.candles, w30, req.timeframe, req.asset_class)
        rv_60 = compute_realized_vol(req.candles, w60, req.timeframe, req.asset_class)
        park_20 = compute_parkinson_vol(req.candles, w20, req.timeframe, req.asset_class)

        rv_best_20 = park_20 if park_20 else rv_20

        # GMM-enhanced vol
        gmm_vol, gmm_kurt = 0.0, 0.0
        if req.gmm_d2:
            gmm_vol, gmm_kurt = compute_gmm_weighted_vol(req.gmm_d2)

        # ── Step 2: Fetch option contracts ──
        strike_lo = spot * (1 - req.strike_range_pct)
        strike_hi = spot * (1 + req.strike_range_pct)

        exp_gte = (today + timedelta(days=req.near_expiry_min_days)).strftime("%Y-%m-%d")
        exp_lte = (today + timedelta(days=req.far_expiry_max_days)).strftime("%Y-%m-%d")

        contracts = await fetch_options_contracts(
            api_key=req.api_keys[0],
            underlying_ticker=req.ticker,
            expiration_date_gte=exp_gte,
            expiration_date_lte=exp_lte,
            strike_price_gte=strike_lo,
            strike_price_lte=strike_hi,
            limit=1000,
        )

        if not contracts:
            raise HTTPException(
                status_code=404,
                detail=f"No option contracts found for {req.ticker}. "
                       "Ensure ticker is a US equity with listed options."
            )

        # ── Step 3: Get market prices and compute greeks ──
        # Walk backwards from today to find the last trading day
        bar_date = today
        for _ in range(7):
            if bar_date.weekday() < 5:
                break
            bar_date -= timedelta(days=1)
        bar_date_str = bar_date.strftime("%Y-%m-%d")

        # Polygon free tier: 5 req/min/key. Configurable via settings.
        n_keys = len(req.api_keys)
        batch_size = req.batch_size  # requests per key per batch
        total_rate = batch_size * n_keys

        enriched_chain: list[OptionContractWithGreeks] = []
        cached_bars: dict = {}

        for batch_start in range(0, len(contracts), total_rate):
            batch = contracts[batch_start:batch_start + total_rate]

            if batch_start > 0:
                print(f"  [Vol] Rate limit pause ({req.batch_delay}s) before batch {batch_start}–{batch_start+len(batch)} ({len(contracts)} total)...")
                await asyncio.sleep(req.batch_delay)

            # Assign contracts to keys round-robin
            key_batches: dict = {i: [] for i in range(n_keys)}
            for idx, contract in enumerate(batch):
                key_idx = idx % n_keys
                key_batches[key_idx].append(contract)

            # Fetch bars in parallel across keys
            async def fetch_batch_for_key(key_idx, key_contracts):
                results = []
                for contract in key_contracts:
                    try:
                        bar = await fetch_option_daily_bar(
                            api_key=req.api_keys[key_idx],
                            option_ticker=contract.ticker,
                            date=bar_date_str,
                        )
                        results.append((contract, bar))
                    except Exception:
                        results.append((contract, None))
                return results

            tasks = [
                fetch_batch_for_key(key_idx, key_contracts)
                for key_idx, key_contracts in key_batches.items()
                if key_contracts
            ]
            batch_results = await asyncio.gather(*tasks)

            for key_results in batch_results:
                for contract, bar in key_results:
                    if bar and bar.get("close") and bar["close"] > 0:
                        cached_bars[contract.ticker] = bar
                        try:
                            enriched = enrich_contract(
                                contract=contract,
                                spot=spot,
                                market_price=bar["close"],
                                bid=None, ask=None,
                                open_interest=None,
                                volume=bar.get("volume"),
                                r=req.risk_free_rate,
                                q=req.dividend_yield,
                                today=today,
                            )
                            enriched_chain.append(enriched)
                        except Exception:
                            pass

        print(f"  [Vol] Enriched {len(enriched_chain)} / {len(contracts)} contracts")

        # ── Step 4-6: Build surface, compute metrics, generate signals ──
        surface = build_iv_surface(enriched_chain)

        atm_iv_near, atm_iv_far = compute_atm_iv(
            enriched_chain, spot, req.near_expiry_max_days, req.far_expiry_min_days)

        term_structure = "flat"
        if atm_iv_near and atm_iv_far:
            diff = atm_iv_far - atm_iv_near
            if diff > 0.01:
                term_structure = "contango"
            elif diff < -0.01:
                term_structure = "backwardation"

        skew_25d = compute_put_call_skew(enriched_chain)

        # VRP
        vrp_10 = (atm_iv_near - rv_10) if (atm_iv_near and rv_10) else None
        vrp_20 = (atm_iv_near - (rv_best_20 or 0)) if atm_iv_near else None
        vrp_30 = (atm_iv_near - rv_30) if (atm_iv_near and rv_30) else None

        vol_analysis = VolatilityAnalysis(
            underlying_ticker=req.ticker,
            spot_price=spot,
            analysis_date=today.isoformat(),
            realized_vol_10d=rv_10,
            realized_vol_20d=rv_20,
            realized_vol_30d=rv_30,
            realized_vol_60d=rv_60,
            parkinson_vol_20d=park_20,
            gmm_weighted_vol=gmm_vol if gmm_vol > 0 else None,
            gmm_weighted_kurtosis=gmm_kurt if gmm_vol > 0 else None,
            atm_iv_near=atm_iv_near,
            atm_iv_far=atm_iv_far,
            term_structure=term_structure,
            put_call_skew_25d=skew_25d,
            vrp_10d=vrp_10,
            vrp_20d=vrp_20,
            vrp_30d=vrp_30,
            surface=surface,
            chain=enriched_chain,
        )

        signals = generate_signals(vol_analysis, req.gmm_d2, spot)
        summary = generate_vol_summary(vol_analysis, signals)

        return VolatilityResponse(
            volatility_analysis=vol_analysis,
            trade_signals=signals,
            summary_text=summary,
            cached_contracts=contracts,
            cached_bars=cached_bars,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/volatility/reprocess", response_model=VolatilityResponse)
async def reprocess_volatility(req: ReprocessRequest):
    """
    Re-run greeks/IV/signals using cached data — no Polygon API calls.
    No Polygon API calls are made — instant reprocessing.
    """
    try:
        today = date.today()
        spot = req.spot_price

        if spot <= 0:
            raise HTTPException(status_code=400, detail="Invalid spot price")

        # ── Step 1: Compute realized volatility from candles ──
        cpd = _candles_per_day(req.timeframe, req.asset_class)
        w10 = max(2, int(10 * cpd))
        w20 = max(2, int(20 * cpd))
        w30 = max(2, int(30 * cpd))
        w60 = max(2, int(60 * cpd))

        rv_10 = compute_realized_vol(req.candles, w10, req.timeframe, req.asset_class)
        rv_20 = compute_realized_vol(req.candles, w20, req.timeframe, req.asset_class)
        rv_30 = compute_realized_vol(req.candles, w30, req.timeframe, req.asset_class)
        rv_60 = compute_realized_vol(req.candles, w60, req.timeframe, req.asset_class)
        park_20 = compute_parkinson_vol(req.candles, w20, req.timeframe, req.asset_class)
        rv_best_20 = park_20 if park_20 else rv_20

        gmm_vol, gmm_kurt = 0.0, 0.0
        if req.gmm_d2:
            gmm_vol, gmm_kurt = compute_gmm_weighted_vol(req.gmm_d2)

        # ── Step 2: Enrich contracts from cached bars (no API calls) ──
        enriched_chain: list[OptionContractWithGreeks] = []
        for contract in req.cached_contracts:
            bar = req.cached_bars.get(contract.ticker)
            if not bar:
                continue

            market_price = bar.get("close")
            vol = bar.get("volume", 0)

            if market_price and market_price > 0:
                try:
                    enriched = enrich_contract(
                        contract=contract,
                        spot=spot,
                        market_price=market_price,
                        bid=None, ask=None,
                        open_interest=None,
                        volume=vol,
                        r=req.risk_free_rate,
                        q=req.dividend_yield,
                        today=today,
                    )
                    enriched_chain.append(enriched)
                except Exception:
                    pass

        # ── Steps 3-5: Surface, metrics, signals ──
        surface = build_iv_surface(enriched_chain)

        atm_iv_near, atm_iv_far = compute_atm_iv(
            enriched_chain, spot, req.near_expiry_max_days, req.far_expiry_min_days)

        term_structure = "flat"
        if atm_iv_near and atm_iv_far:
            diff = atm_iv_far - atm_iv_near
            if diff > 0.01:
                term_structure = "contango"
            elif diff < -0.01:
                term_structure = "backwardation"

        skew_25d = compute_put_call_skew(enriched_chain)

        vrp_10 = (atm_iv_near - rv_10) if (atm_iv_near and rv_10) else None
        vrp_20 = (atm_iv_near - (rv_best_20 or 0)) if atm_iv_near else None
        vrp_30 = (atm_iv_near - rv_30) if (atm_iv_near and rv_30) else None

        vol_analysis = VolatilityAnalysis(
            underlying_ticker=req.ticker,
            spot_price=spot,
            analysis_date=today.isoformat(),
            realized_vol_10d=rv_10,
            realized_vol_20d=rv_20,
            realized_vol_30d=rv_30,
            realized_vol_60d=rv_60,
            parkinson_vol_20d=park_20,
            gmm_weighted_vol=gmm_vol if gmm_vol > 0 else None,
            gmm_weighted_kurtosis=gmm_kurt if gmm_vol > 0 else None,
            atm_iv_near=atm_iv_near,
            atm_iv_far=atm_iv_far,
            term_structure=term_structure,
            put_call_skew_25d=skew_25d,
            vrp_10d=vrp_10,
            vrp_20d=vrp_20,
            vrp_30d=vrp_30,
            surface=surface,
            chain=enriched_chain,
        )

        signals = generate_signals(vol_analysis, req.gmm_d2, spot)
        summary = generate_vol_summary(vol_analysis, signals)

        return VolatilityResponse(
            volatility_analysis=vol_analysis,
            trade_signals=signals,
            summary_text=summary,
            cached_contracts=req.cached_contracts,
            cached_bars=req.cached_bars,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class StrategyRunRequest(BaseModel):
    name: str
    tickers: List[str]
    benchmark: str = "SPY"
    regime_code: str
    start_date: str = "2019-01-01"
    end_date: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    regimes: Optional[List[Dict]] = None

class StrategyValidateRequest(BaseModel):
    code: str

class StrategyTemplateRequest(BaseModel):
    template_id: str
    tickers: Optional[List[str]] = None
    start_date: str = "2019-01-01"
    end_date: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

# ── Endpoints ──

@app.post("/strategy/validate")
async def validate_strategy(req: StrategyValidateRequest):
    """Validate user-uploaded strategy code without executing it."""
    is_valid, error, warnings = validate_strategy_code(req.code)
    return {
        "valid": is_valid,
        "error": error if not is_valid else None,
        "warnings": warnings,
    }

@app.post("/strategy/run")
async def run_strategy(req: StrategyRunRequest):
    """
    Execute a strategy using walk-forward methodology.
    Returns daily P&L, regime history, metrics — all with zero look-ahead bias.
    """
    # 1. Validate code
    is_valid, error, warnings = validate_strategy_code(req.regime_code)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid strategy code: {error}")

    # 2. Build definition
    from pydantic import ValidationError
    try:
        cfg = StrategyConfig(**(req.config or {}))
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"Configuration validation error: {str(e)}")

    from strategy_engine import RegimeDefinition
    regime_defs = None
    if req.regimes:
        regime_defs = [RegimeDefinition(**r) for r in req.regimes]

    defn = StrategyDefinition(
        name=req.name,
        tickers=req.tickers,
        benchmark=req.benchmark,
        config=cfg,
        regime_code=req.regime_code,
        regimes=regime_defs,
    )

    # 3. Run
    try:
        runner = StrategyRunner(defn)
        result = runner.run(
            start_date=req.start_date,
            end_date=req.end_date,
        )
        
        # Cache the fetched data so Sensitivity & WFO can use it
        data = result.pop('data', None)
        import uuid
        session_id = str(uuid.uuid4())
        if data is not None:
            _manual_data_store[session_id] = data
            
        result['session_id'] = session_id
        result['validation_warnings'] = warnings
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {str(e)}")

@app.post("/strategy/run-template")
async def run_template(req: StrategyTemplateRequest):
    """Run a built-in strategy template."""
    if req.template_id not in STRATEGY_TEMPLATES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template: {req.template_id}. "
                   f"Available: {list(STRATEGY_TEMPLATES.keys())}"
        )

    tmpl = STRATEGY_TEMPLATES[req.template_id]
    tickers = req.tickers or tmpl['default_tickers']
    merged_config = {**tmpl['default_config'], **(req.config or {})}

    defn = StrategyDefinition(
        name=tmpl['name'],
        tickers=tickers,
        benchmark="SPY",
        config=StrategyConfig(**merged_config),
        regime_code=tmpl['code'],
    )

    try:
        runner = StrategyRunner(defn)
        result = runner.run(
            start_date=req.start_date,
            end_date=req.end_date,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {str(e)}")

@app.get("/strategy/templates")
async def get_templates():
    """List all available strategy templates with their code and defaults."""
    return {
        tid: {
            'name': t['name'],
            'description': t['description'],
            'code': t['code'],
            'default_tickers': t['default_tickers'],
            'default_config': t['default_config'],
        }
        for tid, t in STRATEGY_TEMPLATES.items()
    }

@app.get("/strategy/docs")
async def get_strategy_docs():
    """Return the complete Strategy API specification."""
    return STRATEGY_API_DOCS


# ═══════════════════════════════════════════════
#  MANUAL MODE ENDPOINTS
# ═══════════════════════════════════════════════

@app.post("/strategy/manual/upload-data")
async def upload_manual_data(files: list[UploadFile] = File(...)):
    """
    Upload one or more data files (CSV, JSON, XLSX).
    Parses each into a DataFrame and merges them into one.
    Returns session_id, column names, date range, and row count.
    """
    frames = []

    for f in files:
        content = await f.read()
        name_lower = (f.filename or '').lower()

        try:
            if name_lower.endswith('.csv'):
                df = pd.read_csv(io.BytesIO(content))
            elif name_lower.endswith('.json'):
                df = pd.read_json(io.BytesIO(content))
            elif name_lower.endswith(('.xlsx', '.xls')):
                df = pd.read_excel(io.BytesIO(content), engine='openpyxl')
            else:
                # Try CSV as fallback
                try:
                    df = pd.read_csv(io.BytesIO(content))
                except Exception:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported file format: {f.filename}. Use CSV, JSON, or XLSX."
                    )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse '{f.filename}': {str(e)}"
            )

        # Try to set a date index
        date_cols = [c for c in df.columns if 'date' in c.lower() or 'time' in c.lower()]
        if date_cols:
            try:
                df[date_cols[0]] = pd.to_datetime(df[date_cols[0]])
                df = df.set_index(date_cols[0]).sort_index()
            except Exception:
                pass  # keep as-is if date parsing fails
        elif not isinstance(df.index, pd.DatetimeIndex):
            # Try parsing the index itself as dates
            try:
                df.index = pd.to_datetime(df.index)
                df = df.sort_index()
            except Exception:
                pass

        frames.append(df)

    # Merge all frames
    if len(frames) == 1:
        merged = frames[0]
    else:
        merged = pd.concat(frames, axis=1)
        merged = merged.sort_index()

    # Drop non-numeric columns
    numeric_df = merged.select_dtypes(include=['number'])
    if numeric_df.empty:
        raise HTTPException(
            status_code=400,
            detail="No numeric columns found in uploaded data. Ensure files contain price data."
        )

    session_id = str(uuid.uuid4())
    _manual_data_store[session_id] = numeric_df

    # Build response
    date_range = None
    if isinstance(numeric_df.index, pd.DatetimeIndex) and len(numeric_df) > 0:
        date_range = {
            'start': str(numeric_df.index[0].date()),
            'end': str(numeric_df.index[-1].date()),
        }

    return {
        'session_id': session_id,
        'columns': list(numeric_df.columns),
        'row_count': len(numeric_df),
        'date_range': date_range,
        'files_parsed': [f.filename for f in files],
    }


class ManualStrategyRunRequest(BaseModel):
    session_id: str
    code: str
    config: Optional[Dict[str, Any]] = None
    benchmark: Optional[str] = None

class ManualStrategyValidateRequest(BaseModel):
    code: str


@app.post("/strategy/manual/validate")
async def validate_manual_strategy(req: ManualStrategyValidateRequest):
    """Validate manual strategy code without executing it."""
    is_valid, error, warnings = validate_manual_strategy_code(req.code)
    return {
        "valid": is_valid,
        "error": error if not is_valid else None,
        "warnings": warnings,
    }


@app.post("/strategy/manual/run")
async def run_manual_strategy_endpoint(req: ManualStrategyRunRequest):
    """
    Execute a manual strategy against uploaded data.
    Returns results + captured console output.
    """
    # 1. Retrieve uploaded data
    data = _manual_data_store.get(req.session_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Please upload data first."
        )

    # 2. Validate code
    is_valid, error, warnings = validate_manual_strategy_code(req.code)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid strategy code: {error}")

    # 3. Build config
    user_config = req.config or {}
    user_config.setdefault('initial_capital', 100000)
    initial_capital = user_config['initial_capital']

    # 4. Optionally fetch benchmark data
    if req.benchmark:
        try:
            import yfinance as yf
            bench_data = yf.download(
                req.benchmark,
                start=str(data.index[0].date()) if isinstance(data.index, pd.DatetimeIndex) else None,
                end=str(data.index[-1].date()) if isinstance(data.index, pd.DatetimeIndex) else None,
                progress=False,
            )
            if not bench_data.empty:
                if isinstance(bench_data.columns, pd.MultiIndex):
                    bench_data = bench_data['Close']
                elif 'Close' in bench_data.columns:
                    bench_data = bench_data[['Close']]
                    bench_data.columns = [req.benchmark]
                data = data.copy()
                data[req.benchmark] = bench_data.reindex(data.index).values
        except Exception:
            pass  # silently skip benchmark if it fails

    # 5. Execute
    try:
        result, console_output = run_manual_strategy(
            code=req.code,
            data=data,
            config=user_config,
            initial_capital=initial_capital,
        )
        result['validation_warnings'] = warnings
        result['console_output'] = console_output
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {str(e)}")


# ═══════════════════════════════════════════════
#  TEARSHEET ENDPOINTS
# ═══════════════════════════════════════════════

@app.post("/strategy/tearsheet")
async def strategy_tearsheet(req: dict):
    """Compute comprehensive tearsheet from strategy results."""
    daily_log = req.get('daily_log', [])
    config = req.get('config', {})
    
    if not daily_log or len(daily_log) < 2:
        raise HTTPException(400, "Need at least 2 daily_log entries for tearsheet")
    
    try:
        tearsheet = compute_tearsheet(daily_log, config)
        return tearsheet
    except Exception as e:
        raise HTTPException(500, f"Tearsheet computation error: {str(e)}")


@app.post("/strategy/monte-carlo")
async def strategy_monte_carlo(req: dict):
    """Run Monte Carlo simulation on strategy results."""
    daily_log = req.get('daily_log', [])
    n_sims = req.get('n_simulations', settings.MONTE_CARLO_SIMS)
    horizon = req.get('horizon_days', 252)
    
    if not daily_log or len(daily_log) < 50:
        raise HTTPException(400, "Need at least 50 daily_log entries for Monte Carlo")
    
    try:
        result = monte_carlo_simulation(daily_log, n_sims=n_sims, horizon_days=horizon)
        return result
    except Exception as e:
        raise HTTPException(500, f"Monte Carlo error: {str(e)}")


@app.post("/strategy/report")
async def strategy_report(req: dict):
    """Generate PDF report from strategy tearsheet."""
    daily_log = req.get('daily_log', [])
    config = req.get('config', {})
    strategy_name = req.get('strategy_name', 'Strategy')
    
    if not daily_log or len(daily_log) < 2:
        raise HTTPException(400, "Need daily_log for report generation")
    
    try:
        tearsheet = compute_tearsheet(daily_log, config)
        pdf_bytes = generate_pdf_report(tearsheet, strategy_name, config)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type='application/pdf',
            headers={'Content-Disposition': f'attachment; filename="{strategy_name}_tearsheet.pdf"'}
        )
    except ImportError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(500, f"Report generation error: {str(e)}")


# ═══════════════════════════════════════════════
#  DATA QUALITY ENDPOINTS
# ═══════════════════════════════════════════════

@app.post("/strategy/data-quality")
async def data_quality_check(req: dict):
    """Run data quality checks on uploaded data."""
    session_id = req.get('session_id', '')
    if session_id not in _manual_data_store:
        raise HTTPException(404, "Session not found — upload data first")
    
    data = _manual_data_store[session_id]
    warnings = check_data_quality(data)
    return {'warnings': warnings, 'session_id': session_id}


# ═══════════════════════════════════════════════
#  STRATEGY LIBRARY ENDPOINTS
# ═══════════════════════════════════════════════

@app.get("/strategy/library")
async def list_saved_strategies():
    """List all saved strategies."""
    return {'strategies': db.list_strategies()}


@app.post("/strategy/library/save")
async def save_strategy(req: dict):
    """Save a strategy to the library."""
    name = req.get('name', 'Untitled')
    code = req.get('code', '')
    config = req.get('config', {})
    description = req.get('description', '')
    mode = req.get('mode', 'api')
    tags = req.get('tags', '')
    
    sid = db.save_strategy(name, code, config, description, mode, tags)
    return {'id': sid, 'message': f'Strategy "{name}" saved'}


@app.get("/strategy/library/{strategy_id}")
async def get_saved_strategy(strategy_id: int):
    """Get a saved strategy."""
    s = db.get_strategy(strategy_id)
    if not s:
        raise HTTPException(404, "Strategy not found")
    return s


@app.delete("/strategy/library/{strategy_id}")
async def delete_saved_strategy(strategy_id: int):
    """Delete a saved strategy."""
    db.delete_strategy(strategy_id)
    return {'message': 'Strategy deleted'}


@app.put("/strategy/library/{strategy_id}")
async def update_saved_strategy(strategy_id: int, req: dict):
    """Update a saved strategy."""
    db.update_strategy(strategy_id, **req)
    return {'message': 'Strategy updated'}


# ── Backtest Run History ──

@app.get("/strategy/runs")
async def list_backtest_runs(limit: int = 50):
    """List recent backtest runs."""
    return {'runs': db.list_runs(limit)}


@app.get("/strategy/runs/{run_id}")
async def get_backtest_run(run_id: int):
    """Get details of a backtest run."""
    r = db.get_run(run_id)
    if not r:
        raise HTTPException(404, "Run not found")
    return r


# ═══════════════════════════════════════════════
#  MULTI-STRATEGY COMPARISON
# ═══════════════════════════════════════════════

@app.post("/strategy/compare")
async def compare_strategies(req: dict):
    """Compare multiple strategy results."""
    results = req.get('results', [])
    if len(results) < 2:
        raise HTTPException(400, "Need at least 2 strategy results to compare")
    
    comparisons = []
    all_returns = []
    
    for r in results:
        daily_log = r.get('daily_log', [])
        if len(daily_log) < 2:
            continue
        tearsheet = compute_tearsheet(daily_log, r.get('config', {}))
        df = pd.DataFrame(daily_log)
        df['date'] = pd.to_datetime(df['date'])
        pv = df['portfolio_value'].astype(float)
        rets = pv.pct_change().dropna()
        all_returns.append(rets.values)
        
        comparisons.append({
            'name': r.get('name', f'Strategy {len(comparisons)+1}'),
            'returns': tearsheet['returns'],
            'risk': tearsheet['risk'],
            'equity_curve': tearsheet['equity_curve'],
        })
    
    # Correlation matrix
    corr_matrix = None
    if len(all_returns) >= 2:
        min_len = min(len(r) for r in all_returns)
        trimmed = [r[:min_len] for r in all_returns]
        corr_np = np.corrcoef(trimmed)
        corr_matrix = [[round(float(c), 3) for c in row] for row in corr_np]
    
    return {
        'comparisons': comparisons,
        'correlation_matrix': corr_matrix,
        'names': [c['name'] for c in comparisons],
    }


# ═══════════════════════════════════════════════
#  PARAMETER SENSITIVITY (GRID SEARCH)
# ═══════════════════════════════════════════════

@app.post("/strategy/sensitivity")
async def parameter_sensitivity(req: dict):
    """Run strategy across parameter grid."""
    session_id = req.get('session_id', '')
    code = req.get('code', '')
    base_config = req.get('config', {})
    param_grid = req.get('param_grid', {})
    
    if not param_grid:
        raise HTTPException(400, "param_grid is required")
    
    if session_id not in _manual_data_store:
        raise HTTPException(404, "Session not found — upload data first")
    
    data = _manual_data_store[session_id]
    
    # Generate all combinations
    import itertools
    keys = list(param_grid.keys())
    values = list(param_grid.values())
    combos = list(itertools.product(*values))
    
    if len(combos) > 200:
        raise HTTPException(400, f"Too many combinations ({len(combos)}). Max 200.")
    
    results = []
    for combo in combos:
        config = {**base_config}
        for k, v in zip(keys, combo):
            config[k] = v
        
        try:
            result, _ = run_manual_strategy(
                code=code, data=data.copy(),
                config=config,
                initial_capital=config.get('initial_capital', 100000),
            )
            metrics = result.get('metrics', {})
            results.append({
                'params': dict(zip(keys, combo)),
                'sharpe': metrics.get('sharpe', 0),
                'total_return': metrics.get('total_return', 0),
                'max_drawdown': metrics.get('max_drawdown', 0),
                'volatility': metrics.get('volatility', 0),
                'annual_return': metrics.get('annual_return', 0),
            })
        except Exception as e:
            results.append({
                'params': dict(zip(keys, combo)),
                'error': str(e),
            })
    
    # Check if best is edge case
    valid = [r for r in results if 'error' not in r]
    overfit_warning = None
    if valid:
        sorted_by_sharpe = sorted(valid, key=lambda x: x['sharpe'], reverse=True)
        best = sorted_by_sharpe[0]
        for k in keys:
            val = best['params'][k]
            param_vals = param_grid[k]
            if val == min(param_vals) or val == max(param_vals):
                overfit_warning = f"Best config uses edge value for '{k}' = {val}. Possible overfit."
                break
    
    return {
        'results': results,
        'param_keys': keys,
        'total_combinations': len(combos),
        'overfit_warning': overfit_warning,
    }


# ═══════════════════════════════════════════════
#  WALK-FORWARD OPTIMIZATION (WFO)
# ═══════════════════════════════════════════════

@app.post("/strategy/wfo")
async def walk_forward_optimization(req: dict):
    """Run Walk-Forward Optimization out-of-sample backtest."""
    session_id = req.get('session_id', '')
    code = req.get('code', '')
    base_config = req.get('config', {})
    param_grid = req.get('param_grid', {})
    n_folds = req.get('n_folds', 5)
    train_ratio = req.get('train_ratio', 0.7)
    
    if not param_grid:
        raise HTTPException(400, "param_grid is required")
        
    if session_id not in _manual_data_store:
        raise HTTPException(404, "Session not found — upload data first")
        
    data = _manual_data_store[session_id]
    
    try:
        result = run_walk_forward_optimization(
            code=code,
            data=data,
            base_config=base_config,
            param_grid=param_grid,
            n_folds=n_folds,
            train_ratio=train_ratio,
            initial_capital=base_config.get('initial_capital', 100000)
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
