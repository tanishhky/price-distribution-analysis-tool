"""
BKM Engine — Bakshi, Kapadia, Madan (2003) Model-Free Risk-Neutral Moments.

Reference: "Stock Return Characteristics, Skew Laws, and the Differential
Pricing of Individual Equity Options", RFS 16(1): 101-143.

Extracts variance, skewness, and kurtosis directly from OTM option prices
using Simpson's-rule integration.  No distributional assumption required.
"""
import numpy as np
from typing import List, Optional, Dict
from models import OptionContractWithGreeks


def compute_bkm_moments(
    chain: List[OptionContractWithGreeks],
    spot: float,
    r: float,
    target_dte: int,
    dte_tolerance: int = 7,
) -> Optional[Dict[str, float]]:
    """
    Compute risk-neutral variance, skewness, and kurtosis via BKM (2003).

    Steps:
      1. Filter chain to the target DTE bucket (within dte_tolerance).
      2. Separate into OTM calls (K > S) and OTM puts (K <= S).
      3. Require at least 3 OTM calls and 3 OTM puts, else return None.
      4. Compute the V, W, X integrals (BKM eq. 5, 6, 7) via Simpson's rule.
      5. Derive variance, skewness, kurtosis (eq. 2, 3, 4).
      6. Return annualized volatility = sqrt(variance * 252/target_dte).

    Returns dict with keys:
      rn_variance, rn_volatility (annualized), rn_skewness, rn_kurtosis,
      n_contracts_used, target_dte, actual_dte_avg
    Returns None if insufficient OTM strikes.
    """
    if spot <= 0 or target_dte <= 0:
        return None

    # ── Step 1: Filter to target DTE bucket ──
    bucket = [
        c for c in chain
        if c.implied_volatility and c.implied_volatility > 0
        and c.days_to_expiry is not None
        and abs(c.days_to_expiry - target_dte) <= dte_tolerance
        and c.mid_price is not None and c.mid_price > 0
        and c.contract.strike_price > 0
    ]

    if not bucket:
        return None

    T = target_dte / 365.0
    erT = np.exp(r * T)

    # ── Step 2: Separate OTM calls and puts ──
    otm_calls = sorted(
        [c for c in bucket
         if c.contract.contract_type == "call"
         and c.contract.strike_price > spot],
        key=lambda c: c.contract.strike_price,
    )
    otm_puts = sorted(
        [c for c in bucket
         if c.contract.contract_type == "put"
         and c.contract.strike_price <= spot],
        key=lambda c: c.contract.strike_price,
    )

    # ── Step 3: Minimum contract requirement ──
    if len(otm_calls) < 3 or len(otm_puts) < 3:
        return None

    # ── Step 4: Compute V, W, X integrals ──
    # BKM define option-implied integrands using OTM option prices:
    #   For OTM calls (K > S):  price = C(K)
    #   For OTM puts  (K <= S): price = P(K)
    #
    # Integral contributions per contract per BKM eq. 5-7:
    #   V_i = (2/T) * [1 - ln(K_i/S)] * (price_i / K_i^2) * dK
    #   W_i = (6*ln(K_i/S) - 3*ln(K_i/S)^2) / T * (price_i / K_i^2) * dK
    #   X_i = (12*ln(K_i/S)^2 - 4*ln(K_i/S)^3) / T * (price_i / K_i^2) * dK

    def _integrate(contracts):
        """Compute V, W, X contributions from a sorted list of OTM contracts."""
        n = len(contracts)
        if n < 3:
            return 0.0, 0.0, 0.0

        strikes = np.array([c.contract.strike_price for c in contracts])
        prices = np.array([c.mid_price for c in contracts])
        log_mk = np.log(strikes / spot)  # ln(K/S)

        # Compute integrands (multiply by erT to discount, per BKM convention)
        v_integrand = erT * (2.0 / T) * (1.0 - log_mk) * prices / (strikes ** 2)
        w_integrand = erT * (6.0 * log_mk - 3.0 * log_mk ** 2) / T * prices / (strikes ** 2)
        x_integrand = erT * (12.0 * log_mk ** 2 - 4.0 * log_mk ** 3) / T * prices / (strikes ** 2)

        # Simpson's rule integration
        v_val = _simpsons(strikes, v_integrand)
        w_val = _simpsons(strikes, w_integrand)
        x_val = _simpsons(strikes, x_integrand)

        return v_val, w_val, x_val

    v_puts, w_puts, x_puts = _integrate(otm_puts)
    v_calls, w_calls, x_calls = _integrate(otm_calls)

    V = v_puts + v_calls  # Total variance contract (eq. 5)
    W = w_puts + w_calls  # Total cubic contract  (eq. 6)
    X = x_puts + x_calls  # Total quartic contract (eq. 7)

    # ── Step 5: Derive moments (BKM eq. 2-4) ──
    # Risk-neutral mean: mu = e^{rT} - 1 - (e^{rT}/2)*V - (e^{rT}/6)*W - (e^{rT}/24)*X
    mu = erT - 1.0 - (erT / 2.0) * V - (erT / 6.0) * W - (erT / 24.0) * X

    # Variance (eq. 2)
    rn_variance = erT * V - mu ** 2
    if rn_variance <= 0:
        return None

    # Skewness (eq. 3)
    sigma_rn = np.sqrt(rn_variance)
    rn_skewness = (erT * W - 3.0 * mu * erT * V + 2.0 * mu ** 3) / (sigma_rn ** 3)

    # Kurtosis (eq. 4) — excess kurtosis
    rn_kurtosis = (
        (erT * X - 4.0 * mu * erT * W + 6.0 * (mu ** 2) * erT * V - 3.0 * mu ** 4)
        / (sigma_rn ** 4)
    ) - 3.0

    # ── Step 6: Annualize ──
    rn_volatility = np.sqrt(rn_variance * 252.0 / target_dte)

    # Compute actual average DTE of contracts used
    all_contracts = otm_puts + otm_calls
    actual_dte_avg = np.mean([c.days_to_expiry for c in all_contracts])

    return {
        "rn_variance": round(float(rn_variance), 8),
        "rn_volatility": round(float(rn_volatility), 6),
        "rn_skewness": round(float(rn_skewness), 6),
        "rn_kurtosis": round(float(rn_kurtosis), 6),
        "n_contracts_used": len(all_contracts),
        "target_dte": target_dte,
        "actual_dte_avg": round(float(actual_dte_avg), 1),
    }


def _simpsons(x: np.ndarray, y: np.ndarray) -> float:
    """
    Composite Simpson's rule for irregularly spaced data.

    Falls back to trapezoidal rule for segments where Simpson's can't be
    applied (even number of remaining points or gaps).
    """
    n = len(x)
    if n < 2:
        return 0.0
    if n == 2:
        return float(np.trapz(y, x))

    # For irregularly spaced data, use composite trapezoidal as base,
    # then apply Simpson's correction where possible on groups of 3 points.
    result = 0.0
    i = 0
    while i < n - 2:
        # Apply Simpson's 1/3 rule on x[i], x[i+1], x[i+2]
        h1 = x[i + 1] - x[i]
        h2 = x[i + 2] - x[i + 1]
        if h1 <= 0 or h2 <= 0:
            # Skip degenerate segments, fall back to trapezoidal
            result += 0.5 * (y[i] + y[i + 1]) * abs(h1)
            i += 1
            continue

        # Simpson's for non-uniform spacing
        h = h1 + h2
        result += (h / 6.0) * (
            (2.0 - h2 / h1) * y[i]
            + (h ** 2 / (h1 * h2)) * y[i + 1]
            + (2.0 - h1 / h2) * y[i + 2]
        )
        i += 2

    # Handle leftover point with trapezoidal rule
    if i == n - 2:
        h = x[i + 1] - x[i]
        result += 0.5 * (y[i] + y[i + 1]) * h

    return float(result)
