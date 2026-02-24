"""
Volatility Engine — self-computed Black-Scholes greeks, IV surface, VRP, trade signals.
No paid Polygon tier required. All computation done locally.
"""
import numpy as np
from scipy.stats import norm
from scipy.optimize import brentq
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, date
from models import (
    Candle, OptionContract, OptionContractWithGreeks,
    VolSurfacePoint, VolatilityAnalysis, TradeSignal,
    GMMResult,
)


# ═══════════════════════════════════════════════
#  BLACK-SCHOLES CORE
# ═══════════════════════════════════════════════

def bs_d1(S: float, K: float, T: float, r: float, q: float, sigma: float) -> float:
    if T <= 0 or sigma <= 0:
        return 0.0
    return (np.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))


def bs_d2(S: float, K: float, T: float, r: float, q: float, sigma: float) -> float:
    return bs_d1(S, K, T, r, q, sigma) - sigma * np.sqrt(T)


def bs_price(S: float, K: float, T: float, r: float, q: float, sigma: float, cp: str) -> float:
    """European Black-Scholes price. cp = 'call' or 'put'."""
    if T <= 0:
        if cp == "call":
            return max(S - K, 0.0)
        return max(K - S, 0.0)
    if sigma <= 0:
        sigma = 1e-8

    d1 = bs_d1(S, K, T, r, q, sigma)
    d2 = d1 - sigma * np.sqrt(T)
    if cp == "call":
        return S * np.exp(-q * T) * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    else:
        return K * np.exp(-r * T) * norm.cdf(-d2) - S * np.exp(-q * T) * norm.cdf(-d1)


def bs_delta(S, K, T, r, q, sigma, cp):
    if T <= 0 or sigma <= 0:
        if cp == "call":
            return 1.0 if S > K else 0.0
        return -1.0 if S < K else 0.0
    d1 = bs_d1(S, K, T, r, q, sigma)
    if cp == "call":
        return np.exp(-q * T) * norm.cdf(d1)
    return np.exp(-q * T) * (norm.cdf(d1) - 1)


def bs_gamma(S, K, T, r, q, sigma):
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = bs_d1(S, K, T, r, q, sigma)
    return np.exp(-q * T) * norm.pdf(d1) / (S * sigma * np.sqrt(T))


def bs_theta(S, K, T, r, q, sigma, cp):
    """Black-Scholes theta (per calendar day).
    Standard formulas:
      Call: -[S·e^(-qT)·N'(d1)·σ / (2√T)] + q·S·e^(-qT)·N(d1) - r·K·e^(-rT)·N(d2)
      Put:  -[S·e^(-qT)·N'(d1)·σ / (2√T)] - q·S·e^(-qT)·N(-d1) + r·K·e^(-rT)·N(-d2)
    """
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = bs_d1(S, K, T, r, q, sigma)
    d2 = d1 - sigma * np.sqrt(T)
    # Common term: -(S e^{-qT} N'(d1) σ) / (2√T)
    shared = -(S * np.exp(-q * T) * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))
    if cp == "call":
        theta_annual = shared + q * S * np.exp(-q * T) * norm.cdf(d1) - r * K * np.exp(-r * T) * norm.cdf(d2)
    else:
        theta_annual = shared - q * S * np.exp(-q * T) * norm.cdf(-d1) + r * K * np.exp(-r * T) * norm.cdf(-d2)
    return theta_annual / 365.0  # per calendar day


def bs_vega(S, K, T, r, q, sigma):
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = bs_d1(S, K, T, r, q, sigma)
    return S * np.exp(-q * T) * norm.pdf(d1) * np.sqrt(T) / 100.0  # per 1% vol


def bs_rho(S, K, T, r, q, sigma, cp):
    if T <= 0 or sigma <= 0:
        return 0.0
    d2 = bs_d2(S, K, T, r, q, sigma)
    if cp == "call":
        return K * T * np.exp(-r * T) * norm.cdf(d2) / 100.0
    return -K * T * np.exp(-r * T) * norm.cdf(-d2) / 100.0


# ═══════════════════════════════════════════════
#  IMPLIED VOLATILITY — BRENT ROOT FINDING
# ═══════════════════════════════════════════════

def implied_volatility(
    market_price: float, S: float, K: float, T: float,
    r: float, q: float, cp: str,
    tol: float = 1e-8, max_iter: int = 100,
) -> Optional[float]:
    """Solve for implied volatility using Brent's method."""
    if T <= 0 or market_price <= 0:
        return None

    # Check bounds
    intrinsic = max(S * np.exp(-q * T) - K * np.exp(-r * T), 0) if cp == "call" else max(K * np.exp(-r * T) - S * np.exp(-q * T), 0)
    if market_price < intrinsic - 0.01:
        return None

    def objective(sigma):
        return bs_price(S, K, T, r, q, sigma, cp) - market_price

    try:
        # Wide bracket: 0.1% to 500% vol
        iv = brentq(objective, 0.001, 5.0, xtol=tol, maxiter=max_iter)
        return float(iv)
    except (ValueError, RuntimeError):
        try:
            iv = brentq(objective, 0.0001, 10.0, xtol=tol, maxiter=max_iter)
            return float(iv)
        except Exception:
            return None


# ═══════════════════════════════════════════════
#  REALIZED VOLATILITY
# ═══════════════════════════════════════════════

# Annualization factors: number of periods in a trading year.
# Varies by asset class:
#   Stocks: 252 trading days, 6.5 hours/day
#   Crypto: 365 days, 24 hours/day (trades continuously)
#   Forex:  252 trading days, 24 hours/day
ANNUALIZATION_MAPS: Dict[str, Dict[str, float]] = {
    "stocks": {
        "1min":  252 * 6.5 * 60,   # ~98_280
        "5min":  252 * 6.5 * 12,   # ~19_656
        "15min": 252 * 6.5 * 4,    # ~6_552
        "30min": 252 * 6.5 * 2,    # ~3_276
        "1hour": 252 * 6.5,        # ~1_638
        "4hour": 252 * 1.625,      # ~409.5
        "1day":  252,
        "1week": 52,
    },
    "crypto": {
        "1min":  365 * 24 * 60,    # ~525_600
        "5min":  365 * 24 * 12,    # ~105_120
        "15min": 365 * 24 * 4,     # ~35_040
        "30min": 365 * 24 * 2,     # ~17_520
        "1hour": 365 * 24,         # ~8_760
        "4hour": 365 * 6,          # ~2_190
        "1day":  365,
        "1week": 52,
    },
    "forex": {
        "1min":  252 * 24 * 60,    # ~362_880
        "5min":  252 * 24 * 12,    # ~72_576
        "15min": 252 * 24 * 4,     # ~24_192
        "30min": 252 * 24 * 2,     # ~12_096
        "1hour": 252 * 24,         # ~6_048
        "4hour": 252 * 6,          # ~1_512
        "1day":  252,
        "1week": 52,
    },
}


def _periods_per_year(timeframe: str, asset_class: str = "stocks") -> float:
    """Return the correct annualization factor for a given timeframe and asset class."""
    ac = asset_class if asset_class in ANNUALIZATION_MAPS else "stocks"
    return ANNUALIZATION_MAPS[ac].get(timeframe, ANNUALIZATION_MAPS[ac].get("1day", 252))


def _candles_per_day(timeframe: str, asset_class: str = "stocks") -> float:
    """How many candles make up one trading day for a given timeframe and asset class."""
    hours_per_day = {"stocks": 6.5, "crypto": 24, "forex": 24}.get(asset_class, 6.5)
    cpd_map = {
        "1min": hours_per_day * 60,
        "5min": hours_per_day * 12,
        "15min": hours_per_day * 4,
        "30min": hours_per_day * 2,
        "1hour": hours_per_day,
        "4hour": hours_per_day / 4,
        "1day": 1,
        "1week": 0.2,
    }
    return cpd_map.get(timeframe, 1)


def compute_realized_vol(
    candles: List[Candle], window: int,
    timeframe: str = "1day", asset_class: str = "stocks",
) -> Optional[float]:
    """
    Close-to-close realized volatility (annualized).
    `window` is in *candles* (not days). The annualization factor is
    chosen based on the candle timeframe and asset class.
    """
    if len(candles) < window + 1:
        return None

    closes = np.array([c.close for c in candles])
    log_returns = np.diff(np.log(closes))

    if len(log_returns) < window:
        return None

    recent = log_returns[-window:]
    ann = _periods_per_year(timeframe, asset_class)
    return float(np.std(recent, ddof=1) * np.sqrt(ann))


def compute_parkinson_vol(
    candles: List[Candle], window: int,
    timeframe: str = "1day", asset_class: str = "stocks",
) -> Optional[float]:
    """
    Parkinson (high-low) volatility estimator — more efficient than close-to-close.
    `window` is in *candles*. Annualization factor derived from `timeframe` and `asset_class`.
    """
    if len(candles) < window:
        return None

    recent = candles[-window:]
    hl_ratio = np.array([np.log(c.high / c.low) for c in recent if c.low > 0 and c.high > 0])

    if len(hl_ratio) < 2:
        return None

    ann = _periods_per_year(timeframe, asset_class)
    variance = np.mean(hl_ratio**2) / (4 * np.log(2))
    return float(np.sqrt(variance * ann))


def compute_gmm_weighted_vol(gmm: GMMResult) -> Tuple[float, float]:
    """
    Compute mixture-weighted standard deviation (price-space) and excess
    kurtosis from GMM components.

    NOTE: The returned "vol" is a price-space std dev, NOT an annualized
    return volatility. It quantifies dispersion of the price distribution
    and should be compared only to other price-space measures, not to IV
    or close-to-close realized vol (which live in log-return space).
    """
    if not gmm or not gmm.components:
        return 0.0, 0.0

    total_var = 0.0
    total_mean = 0.0
    for c in gmm.components:
        total_mean += c.weight * c.mean
    for c in gmm.components:
        total_var += c.weight * (c.variance + (c.mean - total_mean)**2)

    # Mixture kurtosis (excess)
    total_fourth = 0.0
    for c in gmm.components:
        mu_diff = c.mean - total_mean
        # E[(X-mu)^4] for each component
        comp_fourth = c.weight * (3 * c.variance**2 + 6 * c.variance * mu_diff**2 + mu_diff**4)
        total_fourth += comp_fourth

    kurt = (total_fourth / total_var**2) - 3.0 if total_var > 0 else 0.0
    price_std_dev = np.sqrt(total_var) if total_var > 0 else 0.0

    return float(price_std_dev), float(kurt)


# ═══════════════════════════════════════════════
#  CHAIN ENRICHMENT — COMPUTE GREEKS FOR ALL CONTRACTS
# ═══════════════════════════════════════════════

def enrich_contract(
    contract: OptionContract,
    spot: float,
    market_price: float,
    bid: Optional[float],
    ask: Optional[float],
    open_interest: Optional[float],
    volume: Optional[float],
    r: float,
    q: float,
    today: date,
) -> OptionContractWithGreeks:
    """
    Given a contract + market price, compute all greeks from scratch.
    """
    expiry = datetime.strptime(contract.expiration_date, "%Y-%m-%d").date()
    dte = (expiry - today).days
    T = max(dte, 1) / 365.0
    K = contract.strike_price
    cp = contract.contract_type

    mid = None
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        mid = (bid + ask) / 2.0
    elif market_price and market_price > 0:
        mid = market_price

    price_for_iv = mid if mid and mid > 0 else market_price

    iv = None
    delta = gamma = theta = vega = rho_val = None

    if price_for_iv and price_for_iv > 0 and spot > 0 and K > 0:
        iv = implied_volatility(price_for_iv, spot, K, T, r, q, cp)
        if iv and iv > 0:
            delta = bs_delta(spot, K, T, r, q, iv, cp)
            gamma = bs_gamma(spot, K, T, r, q, iv)
            theta = bs_theta(spot, K, T, r, q, iv, cp)
            vega = bs_vega(spot, K, T, r, q, iv)
            rho_val = bs_rho(spot, K, T, r, q, iv, cp)

    moneyness = spot / K if K > 0 else None

    intrinsic = 0.0
    if cp == "call":
        intrinsic = max(spot - K, 0)
    else:
        intrinsic = max(K - spot, 0)

    extrinsic = (price_for_iv - intrinsic) if price_for_iv else None

    return OptionContractWithGreeks(
        contract=contract,
        last_price=market_price,
        bid=bid,
        ask=ask,
        mid_price=mid,
        open_interest=open_interest,
        volume=volume,
        implied_volatility=round(iv, 6) if iv else None,
        delta=round(delta, 6) if delta else None,
        gamma=round(gamma, 6) if gamma else None,
        theta=round(theta, 6) if theta else None,
        vega=round(vega, 6) if vega else None,
        rho=round(rho_val, 6) if rho_val else None,
        moneyness=round(moneyness, 4) if moneyness else None,
        days_to_expiry=dte,
        intrinsic_value=round(intrinsic, 4),
        extrinsic_value=round(extrinsic, 4) if extrinsic is not None else None,
    )


# ═══════════════════════════════════════════════
#  IV SURFACE CONSTRUCTION
# ═══════════════════════════════════════════════

def build_iv_surface(chain: List[OptionContractWithGreeks]) -> List[VolSurfacePoint]:
    """Build IV surface from enriched chain."""
    points = []
    for c in chain:
        if c.implied_volatility and c.implied_volatility > 0.001 and c.implied_volatility < 5.0:
            if c.days_to_expiry and c.days_to_expiry > 0 and c.moneyness:
                points.append(VolSurfacePoint(
                    strike=c.contract.strike_price,
                    expiry_days=c.days_to_expiry,
                    expiry_date=c.contract.expiration_date,
                    moneyness=c.moneyness,
                    iv=c.implied_volatility,
                    contract_type=c.contract.contract_type,
                ))
    return points


def compute_atm_iv(chain: List[OptionContractWithGreeks], min_dte: int, max_dte: int) -> Optional[float]:
    """Get ATM IV for a DTE range — average IV of contracts with moneyness closest to 1.0."""
    candidates = [
        c for c in chain
        if c.implied_volatility and c.days_to_expiry
        and min_dte <= c.days_to_expiry <= max_dte
        and c.moneyness and 0.95 <= c.moneyness <= 1.05
    ]
    if not candidates:
        return None
    return float(np.mean([c.implied_volatility for c in candidates]))


def compute_put_call_skew(chain: List[OptionContractWithGreeks], min_dte: int, max_dte: int) -> Optional[float]:
    """
    25-delta put/call skew: IV(25d put) - IV(25d call).
    Positive = puts more expensive (fear premium).
    """
    calls_25d = [
        c for c in chain
        if c.contract.contract_type == "call"
        and c.delta and 0.20 <= abs(c.delta) <= 0.30
        and c.implied_volatility
        and c.days_to_expiry and min_dte <= c.days_to_expiry <= max_dte
    ]
    puts_25d = [
        c for c in chain
        if c.contract.contract_type == "put"
        and c.delta and 0.20 <= abs(c.delta) <= 0.30
        and c.implied_volatility
        and c.days_to_expiry and min_dte <= c.days_to_expiry <= max_dte
    ]
    if not calls_25d or not puts_25d:
        return None

    avg_put_iv = np.mean([c.implied_volatility for c in puts_25d])
    avg_call_iv = np.mean([c.implied_volatility for c in calls_25d])
    return float(avg_put_iv - avg_call_iv)


# ═══════════════════════════════════════════════
#  TRADE SIGNAL GENERATION
# ═══════════════════════════════════════════════

def generate_signals(
    vol_analysis: VolatilityAnalysis,
    chain: List[OptionContractWithGreeks],
    gmm: Optional[GMMResult],
    spot: float,
    r: float,
) -> List[TradeSignal]:
    """Generate actionable trade signals based on volatility analysis."""
    signals: List[TradeSignal] = []

    # ── Signal 1: Volatility Risk Premium (sell premium when VRP high) ──
    if vol_analysis.vrp_20d is not None and vol_analysis.atm_iv_near is not None:
        vrp = vol_analysis.vrp_20d
        if vrp > 0.05:  # IV exceeds realized by 5%+
            conviction = "high" if vrp > 0.10 else "medium"
            # Find suitable contracts for iron condor
            near_calls = sorted(
                [c for c in chain if c.contract.contract_type == "call"
                 and c.days_to_expiry and 20 <= c.days_to_expiry <= 45
                 and c.delta and 0.15 <= abs(c.delta) <= 0.30
                 and c.implied_volatility],
                key=lambda c: abs(abs(c.delta) - 0.20)
            )
            near_puts = sorted(
                [c for c in chain if c.contract.contract_type == "put"
                 and c.days_to_expiry and 20 <= c.days_to_expiry <= 45
                 and c.delta and 0.15 <= abs(c.delta) <= 0.30
                 and c.implied_volatility],
                key=lambda c: abs(abs(c.delta) - 0.20)
            )

            legs = []
            if near_calls:
                sc = near_calls[0]
                legs.append({
                    "action": "SELL",
                    "contract": sc.contract.ticker,
                    "type": "call",
                    "strike": sc.contract.strike_price,
                    "expiry": sc.contract.expiration_date,
                    "delta": sc.delta,
                    "iv": sc.implied_volatility,
                    "mid": sc.mid_price,
                })
            if near_puts:
                sp = near_puts[0]
                legs.append({
                    "action": "SELL",
                    "contract": sp.contract.ticker,
                    "type": "put",
                    "strike": sp.contract.strike_price,
                    "expiry": sp.contract.expiration_date,
                    "delta": sp.delta,
                    "iv": sp.implied_volatility,
                    "mid": sp.mid_price,
                })

            # Estimate P&L
            total_credit = sum(l.get("mid", 0) or 0 for l in legs) * 100

            # Correct max-loss semantics:
            #   - Short Strangle (2 legs): theoretically unlimited (call side).
            #     We flag this clearly; no fake number.
            #   - Naked Short Call (1 leg): theoretically unlimited → None.
            #   - Naked Short Put  (1 leg): max loss = (strike − premium) × 100.
            max_loss_est: Optional[float] = None
            strategy_label = "Short Strangle"
            if len(legs) == 2:
                # Strangle: unlimited on the upside.  Report None.
                max_loss_est = None
                strategy_label = "Short Strangle"
            elif len(legs) == 1:
                leg = legs[0]
                if leg["type"] == "put":
                    # Naked short put: max loss = strike × 100 − credit
                    max_loss_est = leg["strike"] * 100 - total_credit
                    strategy_label = "Naked Short Put"
                else:
                    # Naked short call: theoretically unlimited
                    max_loss_est = None
                    strategy_label = "Naked Short Call"

            prob = 1.0 - (vol_analysis.realized_vol_20d or 0.20) / (vol_analysis.atm_iv_near or 0.25) if vol_analysis.atm_iv_near else None

            signals.append(TradeSignal(
                signal_type="vol_crush",
                direction="sell_premium",
                conviction=conviction,
                strategy=strategy_label,
                description=f"VRP is {vrp:.1%} — IV ({vol_analysis.atm_iv_near:.1%}) significantly exceeds 20d realized vol ({vol_analysis.realized_vol_20d:.1%}, Parkinson/close-to-close best estimate). Sell premium to capture the spread.",
                rationale=f"20-day realized vol is {vol_analysis.realized_vol_20d:.1%} while near-term ATM IV is {vol_analysis.atm_iv_near:.1%}. The market is pricing in {vrp:.1%} more volatility than has been realized. Statistically, selling premium here has a positive expected value.",
                legs=legs,
                max_profit=round(total_credit, 2) if total_credit else None,
                max_loss=round(-max_loss_est, 2) if max_loss_est and max_loss_est > 0 else None,
                probability_of_profit=round(prob, 4) if prob and 0 < prob < 1 else None,
                risk_reward_ratio=round(total_credit / max_loss_est, 4) if max_loss_est and max_loss_est > 0 and total_credit > 0 else None,
                net_delta=round(sum(l.get("delta", 0) or 0 for l in legs), 4),
                net_theta=None,
                net_vega=None,
                net_gamma=None,
            ))

    # ── Signal 2: Put Skew Trade ──
    if vol_analysis.put_call_skew_25d is not None:
        skew = vol_analysis.put_call_skew_25d
        gmm_kurt = vol_analysis.gmm_weighted_kurtosis or 0

        if skew > 0.03 and gmm_kurt < 1.0:
            # Puts are expensive relative to actual tail risk
            put_spreads = sorted(
                [c for c in chain if c.contract.contract_type == "put"
                 and c.days_to_expiry and 20 <= c.days_to_expiry <= 45
                 and c.delta and 0.15 <= abs(c.delta) <= 0.30
                 and c.mid_price and c.mid_price > 0],
                key=lambda c: abs(abs(c.delta) - 0.25)
            )
            wing_puts = sorted(
                [c for c in chain if c.contract.contract_type == "put"
                 and c.days_to_expiry and 20 <= c.days_to_expiry <= 45
                 and c.delta and 0.05 <= abs(c.delta) <= 0.15
                 and c.mid_price and c.mid_price > 0],
                key=lambda c: abs(abs(c.delta) - 0.10)
            )

            legs = []
            if put_spreads:
                short_put = put_spreads[0]
                legs.append({
                    "action": "SELL",
                    "contract": short_put.contract.ticker,
                    "type": "put",
                    "strike": short_put.contract.strike_price,
                    "expiry": short_put.contract.expiration_date,
                    "delta": short_put.delta,
                    "iv": short_put.implied_volatility,
                    "mid": short_put.mid_price,
                })
            if wing_puts:
                long_put = wing_puts[0]
                legs.append({
                    "action": "BUY",
                    "contract": long_put.contract.ticker,
                    "type": "put",
                    "strike": long_put.contract.strike_price,
                    "expiry": long_put.contract.expiration_date,
                    "delta": long_put.delta,
                    "iv": long_put.implied_volatility,
                    "mid": long_put.mid_price,
                })

            if len(legs) == 2:
                credit = ((legs[0].get("mid", 0) or 0) - (legs[1].get("mid", 0) or 0)) * 100
                width = abs(legs[0]["strike"] - legs[1]["strike"]) * 100
                max_loss = width - credit if credit > 0 else width

                signals.append(TradeSignal(
                    signal_type="skew_trade",
                    direction="sell_premium",
                    conviction="medium" if skew > 0.05 else "low",
                    strategy="Put Credit Spread",
                    description=f"25Δ put-call skew is {skew:.1%} — puts are overpriced relative to GMM-implied tail risk (kurtosis: {gmm_kurt:.2f}).",
                    rationale=f"The options market is pricing downside protection at a {skew:.1%} premium over upside. However, the GMM kurtosis of {gmm_kurt:.2f} suggests actual tail risk is lower than priced. Selling a put spread captures this mispricing.",
                    legs=legs,
                    max_profit=round(credit, 2) if credit > 0 else None,
                    max_loss=round(-max_loss, 2) if max_loss > 0 else None,
                    breakeven_low=round(legs[0]["strike"] - credit / 100, 2) if credit > 0 else None,
                    risk_reward_ratio=round(credit / max_loss, 4) if max_loss > 0 and credit > 0 else None,
                    net_delta=round(sum(l.get("delta", 0) or 0 for l in legs), 4),
                    net_gamma=None, net_theta=None, net_vega=None,
                ))

    # ── Signal 3: Term Structure Trade ──
    if vol_analysis.atm_iv_near and vol_analysis.atm_iv_far:
        spread = vol_analysis.atm_iv_near - vol_analysis.atm_iv_far
        if abs(spread) > 0.02:
            is_backwardation = spread > 0
            atm_near = [
                c for c in chain
                if c.days_to_expiry and 20 <= c.days_to_expiry <= 45
                and c.moneyness and 0.97 <= c.moneyness <= 1.03
                and c.contract.contract_type == "call"
                and c.mid_price and c.mid_price > 0
            ]
            atm_far = [
                c for c in chain
                if c.days_to_expiry and 60 <= c.days_to_expiry <= 120
                and c.moneyness and 0.97 <= c.moneyness <= 1.03
                and c.contract.contract_type == "call"
                and c.mid_price and c.mid_price > 0
            ]

            if atm_near and atm_far:
                atm_near.sort(key=lambda c: abs(c.moneyness - 1.0))
                atm_far.sort(key=lambda c: abs(c.moneyness - 1.0))
                near_c = atm_near[0]
                far_c = atm_far[0]

                if is_backwardation:
                    legs = [
                        {"action": "SELL", "contract": near_c.contract.ticker, "type": "call",
                         "strike": near_c.contract.strike_price, "expiry": near_c.contract.expiration_date,
                         "delta": near_c.delta, "iv": near_c.implied_volatility, "mid": near_c.mid_price},
                        {"action": "BUY", "contract": far_c.contract.ticker, "type": "call",
                         "strike": far_c.contract.strike_price, "expiry": far_c.contract.expiration_date,
                         "delta": far_c.delta, "iv": far_c.implied_volatility, "mid": far_c.mid_price},
                    ]
                    debit = ((far_c.mid_price or 0) - (near_c.mid_price or 0)) * 100
                    signals.append(TradeSignal(
                        signal_type="calendar",
                        direction="spread",
                        conviction="medium",
                        strategy="Calendar Spread (sell near, buy far)",
                        description=f"IV term structure is in backwardation ({spread:.1%} inversion). Near-term vol ({vol_analysis.atm_iv_near:.1%}) exceeds far-term ({vol_analysis.atm_iv_far:.1%}).",
                        rationale=f"Backwardation typically reverts to contango as near-term uncertainty resolves. The calendar spread profits from this normalization + theta decay differential.",
                        legs=legs,
                        max_loss=round(-abs(debit), 2) if debit > 0 else None,
                        net_delta=round((far_c.delta or 0) - (near_c.delta or 0), 4),
                        net_theta=None, net_gamma=None, net_vega=None,
                    ))

    # ── Signal 4: GMM Mean-Reversion at Volume Nodes ──
    if gmm and gmm.components:
        hvn_nodes = [c for c in gmm.components if c.label == "HVN"]
        lvn_nodes = [c for c in gmm.components if c.label == "LVN"]

        for hvn in hvn_nodes:
            distance = abs(spot - hvn.mean) / spot
            if 0.03 < distance < 0.12:
                direction_to_hvn = "above" if hvn.mean > spot else "below"

                if direction_to_hvn == "above":
                    target_calls = sorted(
                        [c for c in chain if c.contract.contract_type == "call"
                         and c.days_to_expiry and 30 <= c.days_to_expiry <= 60
                         and c.contract.strike_price <= hvn.mean * 1.01
                         and c.contract.strike_price >= spot
                         and c.mid_price and c.mid_price > 0],
                        key=lambda c: abs(c.contract.strike_price - hvn.mean)
                    )
                    if target_calls:
                        tc = target_calls[0]
                        signals.append(TradeSignal(
                            signal_type="mean_reversion",
                            direction="buy_premium",
                            conviction="medium" if hvn.weight > 0.25 else "low",
                            strategy="Long Call (target HVN)",
                            description=f"Price at ${spot:.2f} is {distance:.1%} below HVN at ${hvn.mean:.2f} (weight: {hvn.weight:.1%}). High probability of reversion.",
                            rationale=f"The volume-weighted distribution shows a High Volume Node (HVN) at ${hvn.mean:.2f} attracting {hvn.weight:.1%} of traded volume. Price tends to gravitate toward HVNs. Buy calls targeting this level.",
                            legs=[{"action": "BUY", "contract": tc.contract.ticker, "type": "call",
                                   "strike": tc.contract.strike_price, "expiry": tc.contract.expiration_date,
                                   "delta": tc.delta, "iv": tc.implied_volatility, "mid": tc.mid_price}],
                            max_loss=round(-(tc.mid_price or 0) * 100, 2),
                            net_delta=round(tc.delta or 0, 4),
                            net_gamma=round(tc.gamma or 0, 6) if tc.gamma else None,
                            net_theta=round(tc.theta or 0, 4) if tc.theta else None,
                            net_vega=round(tc.vega or 0, 4) if tc.vega else None,
                        ))
                else:
                    target_puts = sorted(
                        [c for c in chain if c.contract.contract_type == "put"
                         and c.days_to_expiry and 30 <= c.days_to_expiry <= 60
                         and c.contract.strike_price >= hvn.mean * 0.99
                         and c.contract.strike_price <= spot
                         and c.mid_price and c.mid_price > 0],
                        key=lambda c: abs(c.contract.strike_price - hvn.mean)
                    )
                    if target_puts:
                        tp = target_puts[0]
                        signals.append(TradeSignal(
                            signal_type="mean_reversion",
                            direction="buy_premium",
                            conviction="medium" if hvn.weight > 0.25 else "low",
                            strategy="Long Put (target HVN)",
                            description=f"Price at ${spot:.2f} is {distance:.1%} above HVN at ${hvn.mean:.2f} (weight: {hvn.weight:.1%}). High probability of reversion.",
                            rationale=f"The volume-weighted distribution shows a High Volume Node (HVN) at ${hvn.mean:.2f} attracting {hvn.weight:.1%} of traded volume. Price tends to gravitate toward HVNs. Buy puts targeting this level.",
                            legs=[{"action": "BUY", "contract": tp.contract.ticker, "type": "put",
                                   "strike": tp.contract.strike_price, "expiry": tp.contract.expiration_date,
                                   "delta": tp.delta, "iv": tp.implied_volatility, "mid": tp.mid_price}],
                            max_loss=round(-(tp.mid_price or 0) * 100, 2),
                            net_delta=round(tp.delta or 0, 4),
                            net_gamma=round(tp.gamma or 0, 6) if tp.gamma else None,
                            net_theta=round(tp.theta or 0, 4) if tp.theta else None,
                            net_vega=round(tp.vega or 0, 4) if tp.vega else None,
                        ))

    # ── Signal 5: Gamma Scalp (multi-modal GMM) ──
    if gmm and len(gmm.components) >= 3:
        modes = sorted([c.mean for c in gmm.components if c.weight > 0.10])
        if len(modes) >= 2:
            total_range = modes[-1] - modes[0]
            pct_range = total_range / spot if spot > 0 else 0
            if pct_range > 0.05:
                atm_straddle_calls = [
                    c for c in chain if c.contract.contract_type == "call"
                    and c.days_to_expiry and 14 <= c.days_to_expiry <= 30
                    and c.moneyness and 0.98 <= c.moneyness <= 1.02
                    and c.mid_price and c.mid_price > 0
                ]
                atm_straddle_puts = [
                    c for c in chain if c.contract.contract_type == "put"
                    and c.days_to_expiry and 14 <= c.days_to_expiry <= 30
                    and c.moneyness and 0.98 <= c.moneyness <= 1.02
                    and c.mid_price and c.mid_price > 0
                ]

                if atm_straddle_calls and atm_straddle_puts:
                    atm_straddle_calls.sort(key=lambda c: abs(c.moneyness - 1.0))
                    atm_straddle_puts.sort(key=lambda c: abs(c.moneyness - 1.0))
                    sc = atm_straddle_calls[0]
                    sp = atm_straddle_puts[0]
                    total_debit = ((sc.mid_price or 0) + (sp.mid_price or 0)) * 100

                    signals.append(TradeSignal(
                        signal_type="gamma_scalp",
                        direction="buy_premium",
                        conviction="medium" if pct_range > 0.08 else "low",
                        strategy="Long Straddle + Delta Hedge",
                        description=f"GMM shows {len(modes)} significant price modes spanning {pct_range:.1%}. Price likely to oscillate between ${modes[0]:.2f} and ${modes[-1]:.2f}.",
                        rationale=f"Multi-modal distribution (n={gmm.n_components}) indicates price will move between distinct regimes rather than trending. Buy gamma via straddle and scalp delta as price oscillates between nodes. Each oscillation generates realized P&L that should exceed theta decay.",
                        legs=[
                            {"action": "BUY", "contract": sc.contract.ticker, "type": "call",
                             "strike": sc.contract.strike_price, "expiry": sc.contract.expiration_date,
                             "delta": sc.delta, "iv": sc.implied_volatility, "mid": sc.mid_price},
                            {"action": "BUY", "contract": sp.contract.ticker, "type": "put",
                             "strike": sp.contract.strike_price, "expiry": sp.contract.expiration_date,
                             "delta": sp.delta, "iv": sp.implied_volatility, "mid": sp.mid_price},
                        ],
                        max_loss=round(-total_debit, 2),
                        net_delta=round((sc.delta or 0) + (sp.delta or 0), 4),
                        net_gamma=round((sc.gamma or 0) + (sp.gamma or 0), 6),
                        net_theta=round((sc.theta or 0) + (sp.theta or 0), 4),
                        net_vega=round((sc.vega or 0) + (sp.vega or 0), 4),
                    ))

    return signals


# ═══════════════════════════════════════════════
#  SUMMARY TEXT GENERATOR
# ═══════════════════════════════════════════════

def generate_vol_summary(vol: VolatilityAnalysis, signals: List[TradeSignal]) -> str:
    lines = []
    lines.append("=" * 80)
    lines.append("=== VOLATILITY ANALYSIS ===")
    lines.append(f"Underlying: {vol.underlying_ticker} | Spot: ${vol.spot_price:.2f} | Date: {vol.analysis_date}")
    lines.append("=" * 80)

    lines.append("")
    lines.append("--- Realized Volatility ---")
    for label, val in [("10d", vol.realized_vol_10d), ("20d", vol.realized_vol_20d),
                       ("30d", vol.realized_vol_30d), ("60d", vol.realized_vol_60d)]:
        lines.append(f"  RV {label}: {val:.2%}" if val else f"  RV {label}: N/A")

    if vol.gmm_weighted_vol:
        lines.append(f"  GMM-Weighted Vol (Price Dispersion): ${vol.gmm_weighted_vol:.2f}")
    if vol.gmm_weighted_kurtosis is not None:
        lines.append(f"  GMM-Weighted Kurtosis: {vol.gmm_weighted_kurtosis:.4f}")

    lines.append("")
    lines.append("--- Implied Volatility ---")
    if vol.atm_iv_near:
        lines.append(f"  ATM IV (Near-term): {vol.atm_iv_near:.2%}")
    if vol.atm_iv_far:
        lines.append(f"  ATM IV (Far-term):  {vol.atm_iv_far:.2%}")
    if vol.iv_term_structure:
        lines.append(f"  Term Structure: {vol.iv_term_structure.upper()}")
    if vol.put_call_skew_25d is not None:
        lines.append(f"  25Δ Put-Call Skew: {vol.put_call_skew_25d:.2%}")

    lines.append("")
    lines.append("--- Volatility Risk Premium ---")
    for label, val in [("10d", vol.vrp_10d), ("20d", vol.vrp_20d), ("30d", vol.vrp_30d)]:
        if val is not None:
            status = "🔥 HIGH" if val > 0.08 else ("✓ Positive" if val > 0 else "⚠ Negative")
            lines.append(f"  VRP {label}: {val:.2%} [{status}]")

    if signals:
        lines.append("")
        lines.append("=" * 80)
        lines.append(f"=== TRADE SIGNALS ({len(signals)} found) ===")
        lines.append("=" * 80)
        for i, s in enumerate(signals):
            lines.append(f"\n  [{i+1}] {s.strategy} — {s.conviction.upper()} conviction")
            lines.append(f"      Type: {s.signal_type} | Direction: {s.direction}")
            lines.append(f"      {s.description}")
            if s.legs:
                for leg in s.legs:
                    lines.append(f"        {leg['action']} {leg['contract']} @ ${leg.get('mid', '?'):.2f}" if leg.get('mid') else f"        {leg['action']} {leg['contract']}")
            if s.max_profit:
                lines.append(f"      Max Profit: ${s.max_profit:.2f}")
            if s.max_loss:
                lines.append(f"      Max Loss: ${s.max_loss:.2f}")
            if s.probability_of_profit:
                lines.append(f"      Est. P(Profit): {s.probability_of_profit:.1%}")

    lines.append("")
    return "\n".join(lines)
