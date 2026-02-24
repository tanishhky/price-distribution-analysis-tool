import numpy as np
from scipy import stats
from scipy.ndimage import gaussian_filter1d
from sklearn.mixture import GaussianMixture
from typing import List, Optional, Dict, Any, Tuple
from models import Candle, DistributionData, GMMResult, GMMComponent


# ─────────────────────────────────────────────
# Step 1: Build D1 and D2 distributions
# ─────────────────────────────────────────────

def build_distributions(
    candles: List[Candle],
    num_bins: int = 200,
) -> Tuple[DistributionData, DistributionData, np.ndarray, np.ndarray, np.ndarray, float]:
    """
    Returns D1 (time-at-price) and D2 (volume-weighted time-at-price) distributions.
    Also returns the raw bin arrays for GMM fitting.
    """
    prices_low  = np.array([c.low  for c in candles])
    prices_high = np.array([c.high for c in candles])
    volumes     = np.array([c.volume for c in candles])

    global_min = prices_low.min()
    global_max = prices_high.max()

    bin_edges  = np.linspace(global_min, global_max, num_bins + 1)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    bin_width  = bin_edges[1] - bin_edges[0]

    d1_density = np.zeros(num_bins)
    d2_density = np.zeros(num_bins)

    for i, candle in enumerate(candles):
        lo, hi, vol = candle.low, candle.high, volumes[i]
        bin_lo = int(np.searchsorted(bin_edges, lo, side='left'))
        bin_hi = int(np.searchsorted(bin_edges, hi, side='right'))
        bin_lo = max(0, min(bin_lo, num_bins - 1))
        bin_hi = max(0, min(bin_hi, num_bins))
        touched = max(1, bin_hi - bin_lo)
        time_weight = 1.0 / touched
        vol_weight  = (vol / touched) if vol > 0 else 0.0
        for b in range(bin_lo, min(bin_hi, num_bins)):
            d1_density[b] += time_weight
            d2_density[b] += vol_weight

    d1_area = np.sum(d1_density) * bin_width
    d2_area = np.sum(d2_density) * bin_width
    d1_density = d1_density / d1_area if d1_area > 0 else d1_density
    d2_density = d2_density / d2_area if d2_area > 0 else d2_density

    sigma = max(1, num_bins // 50)
    d1_kde = gaussian_filter1d(d1_density, sigma=sigma)
    d2_kde = gaussian_filter1d(d2_density, sigma=sigma)

    d1 = DistributionData(
        price_bins=bin_centers.tolist(), density=d1_density.tolist(),
        kde_x=bin_centers.tolist(), kde_y=d1_kde.tolist(),
    )
    d2 = DistributionData(
        price_bins=bin_centers.tolist(), density=d2_density.tolist(),
        kde_x=bin_centers.tolist(), kde_y=d2_kde.tolist(),
    )

    return d1, d2, d1_density, d2_density, bin_centers, bin_width


# ─────────────────────────────────────────────
# Step 2: Gaussian Mixture Model fitting
# ─────────────────────────────────────────────

def fit_gmm(
    bin_centers: np.ndarray,
    density: np.ndarray,
    n_components_override: Optional[int] = None,
    max_components: int = 10,
) -> GMMResult:
    total_samples = 5000
    bin_width = bin_centers[1] - bin_centers[0] if len(bin_centers) > 1 else 1.0
    counts = np.round(density * bin_width * total_samples).astype(int)
    counts = np.maximum(counts, 0)
    samples = np.repeat(bin_centers, counts).reshape(-1, 1)

    if len(samples) < 2:
        raise ValueError("Insufficient data to fit GMM.")

    bic_scores: Dict[str, float] = {}
    best_bic = np.inf
    best_gmm = None
    best_n = 1

    n_range = range(1, min(max_components, len(np.unique(samples))) + 1)

    for n in n_range:
        try:
            gmm = GaussianMixture(
                n_components=n, covariance_type='full',
                max_iter=500, n_init=5, random_state=42,
            )
            gmm.fit(samples)
            bic = gmm.bic(samples)
            bic_scores[str(n)] = round(float(bic), 2)
            if bic < best_bic:
                best_bic = bic
                best_gmm = gmm
                best_n = n
        except Exception:
            continue

    if n_components_override is not None and n_components_override != best_n:
        try:
            override_gmm = GaussianMixture(
                n_components=n_components_override, covariance_type='full',
                max_iter=500, n_init=5, random_state=42,
            )
            override_gmm.fit(samples)
            best_gmm = override_gmm
            best_n = n_components_override
        except Exception:
            pass

    x_eval = np.linspace(bin_centers.min(), bin_centers.max(), 1000)
    fitted_total = np.zeros(len(x_eval))
    component_curves = []
    components: List[GMMComponent] = []

    order = np.argsort(best_gmm.means_.ravel())

    for rank, idx in enumerate(order):
        weight  = float(best_gmm.weights_[idx])
        mean    = float(best_gmm.means_[idx][0])
        var     = float(best_gmm.covariances_[idx][0][0])
        std_dev = float(np.sqrt(var))

        comp_y = weight * stats.norm.pdf(x_eval, loc=mean, scale=std_dev)
        fitted_total += comp_y

        # Individual Gaussian components have skewness=0 and excess kurtosis=0
        # by definition; no need to estimate via random sampling.
        skewness = 0.0
        kurtosis = 0.0

        if weight > 0.20:
            label = "HVN"
        elif weight < 0.10:
            label = "LVN"
        else:
            label = "Neutral"

        components.append(GMMComponent(
            component_index=rank + 1,
            weight=round(weight, 4), mean=round(mean, 4),
            std_dev=round(std_dev, 4), variance=round(var, 4),
            skewness=round(skewness, 4), kurtosis=round(kurtosis, 4),
            range_1sigma=[round(mean - std_dev, 4), round(mean + std_dev, 4)],
            range_2sigma=[round(mean - 2*std_dev, 4), round(mean + 2*std_dev, 4)],
            label=label,
        ))

        component_curves.append({
            "x": x_eval.tolist(), "y": comp_y.tolist(),
            "label": f"C{rank+1} ({label})",
            "mean": round(mean, 4), "weight": round(weight, 4),
        })

    return GMMResult(
        n_components=best_n, bic_scores=bic_scores, components=components,
        fitted_curve_x=x_eval.tolist(), fitted_curve_y=fitted_total.tolist(),
        component_curves=component_curves,
    )


# ─────────────────────────────────────────────
# Results text generator
# ─────────────────────────────────────────────

def generate_results_text(
    ticker: str, asset_class: str, timeframe: str,
    start_date: str, end_date: str, total_candles: int, num_bins: int,
    gmm_d1: GMMResult, gmm_d2: GMMResult,
) -> str:
    lines = []
    lines.append("=" * 80)
    lines.append("=== GMM RESULTS ===")
    lines.append(f"Symbol: {ticker} | Asset Class: {asset_class.upper()}")
    lines.append(f"Timeframe: {timeframe} | Date Range: {start_date} to {end_date}")
    lines.append(f"Total Candles: {total_candles} | Price Bins: {num_bins} | BIC-optimal (D1): {gmm_d1.n_components} | (D2): {gmm_d2.n_components}")
    lines.append("=" * 80)

    for label, gmm in [("D1: Time-at-Price Distribution", gmm_d1), ("D2: Volume-Weighted Distribution", gmm_d2)]:
        lines.append("")
        lines.append(f"--- {label} ---")
        bic_str = " | ".join([f"n={k}: {v:.1f}" for k, v in sorted(gmm.bic_scores.items(), key=lambda x: int(x[0]))])
        lines.append(f"BIC scores: [{bic_str}]")
        lines.append(f"Optimal n_components: {gmm.n_components}")
        lines.append("")

        header = (
            f"{'Comp':>4}  {'Weight':>7}  {'Mean (μ)':>12}  {'Std Dev (σ)':>11}  "
            f"{'Variance (σ²)':>14}  {'Skewness':>9}  {'Kurtosis':>9}  "
            f"{'μ±1σ Range':>22}  {'μ±2σ Range':>22}  {'Label':>8}"
        )
        lines.append(header)
        lines.append("-" * len(header))

        for c in gmm.components:
            r1 = f"[{c.range_1sigma[0]:.2f} – {c.range_1sigma[1]:.2f}]"
            r2 = f"[{c.range_2sigma[0]:.2f} – {c.range_2sigma[1]:.2f}]"
            lines.append(
                f"{c.component_index:>4}  {c.weight:>7.4f}  {c.mean:>12.4f}  {c.std_dev:>11.4f}  "
                f"{c.variance:>14.4f}  {c.skewness:>9.4f}  {c.kurtosis:>9.4f}  "
                f"{r1:>22}  {r2:>22}  {c.label:>8}"
            )

    lines.append("")
    return "\n".join(lines)
