from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, date, timedelta
import asyncio
import numpy as np

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

app = FastAPI(title="Price Distribution & Volatility Analysis API", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
            window_size=max(30, len(req.candles) // 5),
            step_size=max(5, len(req.candles) // 30),
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

        # Multi-key round-robin for option bar fetching
        # Polygon free tier: 5 req/min/key. Each key gets exactly 5 requests per batch.
        # With N keys: 5N contracts per batch, 61s delay = 5N contracts/min (at limit).
        n_keys = len(req.api_keys)
        batch_size = 5  # requests per key per batch (= Polygon free tier limit)
        total_rate = batch_size * n_keys

        enriched_chain: list[OptionContractWithGreeks] = []
        cached_bars: dict = {}

        for batch_start in range(0, len(contracts), total_rate):
            batch = contracts[batch_start:batch_start + total_rate]

            if batch_start > 0:
                print(f"  [Vol] Rate limit pause (61s) before batch {batch_start}–{batch_start+len(batch)} ({len(contracts)} total)...")
                await asyncio.sleep(61)  # 60s + 1s buffer to respect 5 req/min/key

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
