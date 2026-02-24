from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, date, timedelta
import numpy as np

from models import (
    FetchRequest, FetchResponse, AnalyzeRequest, AnalyzeResponse,
    VolatilityRequest, VolatilityResponse, VolatilityAnalysis,
    OptionsChainRequest, OptionContractWithGreeks, ReprocessRequest,
)
from polygon_client import fetch_candles, detect_asset_class, normalize_ticker, SUPPORTED_INTERVALS
from options_client import (
    fetch_options_contracts, fetch_option_daily_bar,
    fetch_previous_close, fetch_option_last_trade, fetch_option_last_quote,
)
from analysis import build_distributions, fit_gmm, generate_results_text
from volatility_engine import (
    compute_realized_vol, compute_parkinson_vol, compute_gmm_weighted_vol,
    enrich_contract, build_iv_surface, compute_atm_iv, compute_put_call_skew,
    generate_signals, generate_vol_summary, _candles_per_day,
)

app = FastAPI(title="Price Distribution & Volatility Analysis API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "price-distribution-vol-tool", "version": "2.0.0"}


@app.get("/supported-intervals")
async def supported_intervals():
    return SUPPORTED_INTERVALS


# ── Existing endpoints ──

@app.post("/fetch", response_model=FetchResponse)
async def fetch(req: FetchRequest):
    try:
        asset_class = req.asset_class
        if asset_class == "auto":
            asset_class = detect_asset_class(req.ticker)

        candles = await fetch_candles(
            api_key=req.api_key,
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
    try:
        if len(req.candles) < 5:
            raise HTTPException(status_code=400, detail="Need at least 5 candles.")

        d1, d2, d1_raw, d2_raw, bin_centers, bin_width = build_distributions(
            candles=req.candles, num_bins=req.num_bins,
        )

        gmm_d1 = fit_gmm(bin_centers=np.array(bin_centers), density=d1_raw,
                          n_components_override=req.n_components_override)
        gmm_d2 = fit_gmm(bin_centers=np.array(bin_centers), density=d2_raw,
                          n_components_override=req.n_components_override)

        results_text = generate_results_text(
            ticker=req.ticker, asset_class=req.asset_class, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            total_candles=len(req.candles), num_bins=req.num_bins,
            gmm_d1=gmm_d1, gmm_d2=gmm_d2,
        )

        return AnalyzeResponse(
            ticker=req.ticker, asset_class=req.asset_class, timeframe=req.timeframe,
            start_date=req.start_date, end_date=req.end_date,
            total_candles=len(req.candles), num_bins=req.num_bins,
            d1=d1, d2=d2, gmm_d1=gmm_d1, gmm_d2=gmm_d2, results_text=results_text,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── NEW: Volatility Analysis endpoint ──

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
    """
    try:
        today = date.today()
        spot = req.spot_price

        if spot <= 0:
            raise HTTPException(status_code=400, detail="Invalid spot price")

        # ── Step 1: Compute realized volatility from candles ──
        # Convert day-based windows to candle counts based on timeframe
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

        # Use Parkinson as primary if available (more efficient estimator)
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
            api_key=req.api_key,
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
        # Use daily bars (previous close) as price — free tier compatible.
        # Walk backwards from today to find the last trading day
        # (skip weekends; holidays may still return empty, but this
        # handles the most common case).
        enriched_chain: list[OptionContractWithGreeks] = []
        lookup_date = today - timedelta(days=1)
        for _ in range(7):  # look back up to 7 calendar days
            if lookup_date.weekday() < 5:  # Mon-Fri
                break
            lookup_date -= timedelta(days=1)
        lookup_date_str = lookup_date.strftime("%Y-%m-%d")

        # Batch process — rate limit awareness (free tier: 5/min)
        bars_cache: dict = {}  # option_ticker -> bar dict (for reprocessing)
        for contract in contracts:
            try:
                bar = await fetch_option_daily_bar(req.api_key, contract.ticker, lookup_date_str)
                if bar:
                    bars_cache[contract.ticker] = bar
                market_price = bar["close"] if bar else None

                bid, ask, oi, vol = None, None, None, None
                if bar:
                    vol = bar.get("volume", 0)

                if market_price and market_price > 0:
                    enriched = enrich_contract(
                        contract=contract,
                        spot=spot,
                        market_price=market_price,
                        bid=bid,
                        ask=ask,
                        open_interest=oi,
                        volume=vol,
                        r=req.risk_free_rate,
                        q=req.dividend_yield,
                        today=today,
                    )
                    if enriched.implied_volatility and enriched.implied_volatility > 0:
                        enriched_chain.append(enriched)
            except Exception:
                continue  # Skip contracts that fail

        # ── Step 4: Build IV surface and metrics ──
        surface_points = build_iv_surface(enriched_chain)
        atm_iv_near = compute_atm_iv(enriched_chain, req.near_expiry_min_days, req.near_expiry_max_days)
        atm_iv_far = compute_atm_iv(enriched_chain, req.far_expiry_min_days, req.far_expiry_max_days)
        skew_25d = compute_put_call_skew(enriched_chain, req.near_expiry_min_days, req.near_expiry_max_days)

        # Term structure
        term_structure = None
        if atm_iv_near and atm_iv_far:
            diff = atm_iv_near - atm_iv_far
            if diff > 0.01:
                term_structure = "backwardation"
            elif diff < -0.01:
                term_structure = "contango"
            else:
                term_structure = "flat"

        # VRP
        vrp_10 = (atm_iv_near - rv_10) if atm_iv_near and rv_10 else None
        vrp_20 = (atm_iv_near - rv_best_20) if atm_iv_near and rv_best_20 else None
        vrp_30 = (atm_iv_near - rv_30) if atm_iv_near and rv_30 else None

        vol_anal = VolatilityAnalysis(
            underlying_ticker=req.ticker,
            spot_price=spot,
            analysis_date=today.strftime("%Y-%m-%d"),
            realized_vol_10d=round(rv_10, 4) if rv_10 else None,
            realized_vol_20d=round(rv_best_20, 4) if rv_best_20 else None,
            realized_vol_30d=round(rv_30, 4) if rv_30 else None,
            realized_vol_60d=round(rv_60, 4) if rv_60 else None,
            gmm_weighted_vol=round(gmm_vol, 4) if gmm_vol else None,
            gmm_weighted_kurtosis=round(gmm_kurt, 4) if gmm_kurt else None,
            atm_iv_near=round(atm_iv_near, 4) if atm_iv_near else None,
            atm_iv_far=round(atm_iv_far, 4) if atm_iv_far else None,
            iv_term_structure=term_structure,
            put_call_skew_25d=round(skew_25d, 4) if skew_25d else None,
            vrp_10d=round(vrp_10, 4) if vrp_10 else None,
            vrp_20d=round(vrp_20, 4) if vrp_20 else None,
            vrp_30d=round(vrp_30, 4) if vrp_30 else None,
            surface_points=surface_points,
            chain=enriched_chain,
        )

        # ── Step 5: Generate trade signals ──
        signals = generate_signals(vol_anal, enriched_chain, req.gmm_d2, spot, req.risk_free_rate)

        # ── Step 6: Summary ──
        summary = generate_vol_summary(vol_anal, signals)

        return VolatilityResponse(
            volatility_analysis=vol_anal,
            trade_signals=signals,
            summary_text=summary,
            cached_contracts=contracts,
            cached_bars=bars_cache,
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Reprocess endpoint — uses cached data, no API calls ──

@app.post("/volatility/reprocess", response_model=VolatilityResponse)
async def volatility_reprocess(req: ReprocessRequest):
    """
    Re-run greeks/IV/signals using cached contracts + bars.
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
                        bid=None,
                        ask=None,
                        open_interest=None,
                        volume=vol,
                        r=req.risk_free_rate,
                        q=req.dividend_yield,
                        today=today,
                    )
                    if enriched.implied_volatility and enriched.implied_volatility > 0:
                        enriched_chain.append(enriched)
                except Exception:
                    continue

        # ── Step 3: Build IV surface and metrics ──
        surface_points = build_iv_surface(enriched_chain)
        atm_iv_near = compute_atm_iv(enriched_chain, req.near_expiry_min_days, req.near_expiry_max_days)
        atm_iv_far = compute_atm_iv(enriched_chain, req.far_expiry_min_days, req.far_expiry_max_days)
        skew_25d = compute_put_call_skew(enriched_chain, req.near_expiry_min_days, req.near_expiry_max_days)

        term_structure = None
        if atm_iv_near and atm_iv_far:
            diff = atm_iv_near - atm_iv_far
            if diff > 0.01:
                term_structure = "backwardation"
            elif diff < -0.01:
                term_structure = "contango"
            else:
                term_structure = "flat"

        vrp_10 = (atm_iv_near - rv_10) if atm_iv_near and rv_10 else None
        vrp_20 = (atm_iv_near - rv_best_20) if atm_iv_near and rv_best_20 else None
        vrp_30 = (atm_iv_near - rv_30) if atm_iv_near and rv_30 else None

        vol_anal = VolatilityAnalysis(
            underlying_ticker=req.ticker,
            spot_price=spot,
            analysis_date=today.strftime("%Y-%m-%d"),
            realized_vol_10d=round(rv_10, 4) if rv_10 else None,
            realized_vol_20d=round(rv_best_20, 4) if rv_best_20 else None,
            realized_vol_30d=round(rv_30, 4) if rv_30 else None,
            realized_vol_60d=round(rv_60, 4) if rv_60 else None,
            gmm_weighted_vol=round(gmm_vol, 4) if gmm_vol else None,
            gmm_weighted_kurtosis=round(gmm_kurt, 4) if gmm_kurt else None,
            atm_iv_near=round(atm_iv_near, 4) if atm_iv_near else None,
            atm_iv_far=round(atm_iv_far, 4) if atm_iv_far else None,
            iv_term_structure=term_structure,
            put_call_skew_25d=round(skew_25d, 4) if skew_25d else None,
            vrp_10d=round(vrp_10, 4) if vrp_10 else None,
            vrp_20d=round(vrp_20, 4) if vrp_20 else None,
            vrp_30d=round(vrp_30, 4) if vrp_30 else None,
            surface_points=surface_points,
            chain=enriched_chain,
        )

        signals = generate_signals(vol_anal, enriched_chain, req.gmm_d2, spot, req.risk_free_rate)
        summary = generate_vol_summary(vol_anal, signals)

        return VolatilityResponse(
            volatility_analysis=vol_anal,
            trade_signals=signals,
            summary_text=summary,
            cached_contracts=req.cached_contracts,
            cached_bars=req.cached_bars,
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
