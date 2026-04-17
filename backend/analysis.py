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

def _density_to_samples(bin_centers: np.ndarray, density: np.ndarray, total_samples: int = 5000) -> np.ndarray:
    """Convert density histogram to weighted samples for GMM fitting."""
    bin_width = bin_centers[1] - bin_centers[0] if len(bin_centers) > 1 else 1.0
    counts = np.round(density * bin_width * total_samples).astype(int)
    counts = np.maximum(counts, 0)
    samples = np.repeat(bin_centers, counts).reshape(-1, 1)
    return samples


def fit_gmm(
    bin_centers: np.ndarray,
    density: np.ndarray,
    n_components_override: Optional[int] = None,
    max_components: int = 10,
) -> GMMResult:
    """
    Fit a Gaussian Mixture Model to a density distribution.

    FIX: Always compute BIC scores across 1..max_components regardless of override.
    This ensures the DATA tab always shows the full BIC landscape even when user
    manually sets N, allowing them to see how their choice compares to the optimal.
    """
    total_samples = 5000
    samples = _density_to_samples(bin_centers, density, total_samples)

    if len(samples) < 2:
        raise ValueError("Insufficient data to fit GMM.")

    max_n = min(max_components, len(np.unique(samples.ravel())))

    # ALWAYS compute BIC scores for all N values (transparency)
    bic_scores = {}
    best_bic_n = 1
    best_bic_val = np.inf

    for n in range(1, max_n + 1):
        try:
            gm = GaussianMixture(
                n_components=n, covariance_type='full',
                max_iter=500, n_init=5, random_state=42,
            )
            gm.fit(samples)
            bic = gm.bic(samples)
            bic_scores[str(n)] = round(float(bic), 2)
            if bic < best_bic_val:
                best_bic_val = bic
                best_bic_n = n
        except Exception:
            continue

    # Determine final N: user override takes precedence, else BIC-optimal
    if n_components_override is not None and n_components_override >= 1:
        best_n = min(n_components_override, max_n)
    else:
        best_n = best_bic_n

    # Fit final model with chosen N
    gmm = GaussianMixture(
        n_components=best_n, covariance_type='full',
        max_iter=500, n_init=5, random_state=42,
    )
    gmm.fit(samples)

    # Build output
    means = gmm.means_.ravel()
    covs = gmm.covariances_.ravel() if gmm.covariances_.ndim == 1 else gmm.covariances_.reshape(-1)
    weights = gmm.weights_

    # Handle covariance shape: 'full' gives (n, 1, 1) → flatten properly
    variances = []
    for i in range(best_n):
        cov = gmm.covariances_[i]
        if cov.ndim == 2:
            variances.append(float(cov[0, 0]))
        elif cov.ndim == 1:
            variances.append(float(cov[0]))
        else:
            variances.append(float(cov))

    # Sort by mean (ascending price order)
    order = np.argsort(means)

    x_eval = np.linspace(bin_centers.min(), bin_centers.max(), 500)
    fitted_total = np.zeros_like(x_eval)
    components = []
    component_curves = []

    for rank, idx in enumerate(order):
        mean = float(means[idx])
        var = variances[idx]
        std_dev = float(np.sqrt(var)) if var > 0 else 1e-8
        weight = float(weights[idx])

        # Component PDF (weighted)
        comp_y = weight * stats.norm.pdf(x_eval, loc=mean, scale=std_dev)
        fitted_total += comp_y

        # Gaussian components have 0 skewness and 0 excess kurtosis by definition
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


def fit_synced_gmm(
    bin_centers: np.ndarray,
    d1_density: np.ndarray,
    d2_density: np.ndarray,
    max_components: int = 10,
) -> Tuple[GMMResult, GMMResult, int]:
    """
    Find the N with the lowest combined BIC across D1 and D2,
    then fit both distributions with that shared N.
    """
    total_samples = 5000

    d1_samples = _density_to_samples(bin_centers, d1_density, total_samples)
    d2_samples = _density_to_samples(bin_centers, d2_density, total_samples)

    if len(d1_samples) < 2 or len(d2_samples) < 2:
        raise ValueError("Insufficient data for synced GMM.")

    max_n = min(max_components,
                len(np.unique(d1_samples.ravel())),
                len(np.unique(d2_samples.ravel())))

    best_n = 1
    best_combined_bic = np.inf
    for n in range(1, max_n + 1):
        try:
            g1 = GaussianMixture(n_components=n, covariance_type='full',
                                  max_iter=500, n_init=5, random_state=42)
            g2 = GaussianMixture(n_components=n, covariance_type='full',
                                  max_iter=500, n_init=5, random_state=42)
            g1.fit(d1_samples)
            g2.fit(d2_samples)
            combined = g1.bic(d1_samples) + g2.bic(d2_samples)
            if combined < best_combined_bic:
                best_combined_bic = combined
                best_n = n
        except Exception:
            continue

    gmm_d1 = fit_gmm(bin_centers, d1_density, n_components_override=best_n, max_components=max_components)
    gmm_d2 = fit_gmm(bin_centers, d2_density, n_components_override=best_n, max_components=max_components)
    return gmm_d1, gmm_d2, best_n


def _mahalanobis_match(
    prev_comps: List[Tuple[float, float]],
    new_comps: List[Tuple[float, float]],
    threshold: float = 3.0,
) -> List[int]:
    """
    Match new GMM components to previous ones using Mahalanobis distance
    in (mean, sigma) space.

    Returns mapping[j] = slot index for new_comps[j].
    If best match > threshold, assigns a fresh slot (new component series).
    """
    n_prev = len(prev_comps)
    n_new = len(new_comps)

    if n_prev == 0:
        return list(range(n_new))

    prev_arr = np.array(prev_comps)
    new_arr = np.array(new_comps)

    # Build distance matrix
    dist = np.full((n_new, n_prev), np.inf)
    for j in range(n_new):
        for i in range(n_prev):
            pm, ps = prev_arr[i]
            nm, ns = new_arr[j]
            scale_mean = max(ps, 1e-8)
            scale_sigma = max(ps * 0.5, 1e-8)
            d = np.sqrt(((nm - pm) / scale_mean) ** 2 + ((ns - ps) / scale_sigma) ** 2)
            dist[j, i] = d

    # Greedy matching by ascending distance
    mapping = [-1] * n_new
    used_prev = set()
    pairs = sorted(
        [(dist[j, i], j, i) for j in range(n_new) for i in range(n_prev)]
    )
    for d, j, i in pairs:
        if mapping[j] >= 0 or i in used_prev:
            continue
        if d <= threshold:
            mapping[j] = i
            used_prev.add(i)

    # Assign unmatched to new slots
    next_idx = n_prev
    for j in range(n_new):
        if mapping[j] < 0:
            mapping[j] = next_idx
            next_idx += 1

    return mapping


def compute_moment_evolution(
    candles: List[Candle],
    window_size: int = 60,
    step_size: int = 10,
    num_bins: int = 200,
    n_components: Optional[int] = None,
    sync_gmm: bool = False,
) -> Dict[str, Any]:
    """
    Slide a window across candles, fit GMM at each step.
    Track per-component (mean, sigma, weight) + mixture kurtosis over time.

    FIX v4: Uses Mahalanobis-distance matching between windows to prevent
    discontinuous jumps when component ordering shifts.  Each new window's
    components are matched to the closest previous components in (mean, sigma)
    space.  If the best match exceeds 3 sigmas, the component is treated as
    new (separate series), preventing false continuity.

    Returns:
      { timestamps: [...], d1: { components: [{mean:[], sigma:[], weight:[]}], mixture_kurtosis:[] },
        d2: { ... } }
    """
    if len(candles) < window_size:
        return {"timestamps": [], "d1": {"components": [], "mixture_kurtosis": []},
                "d2": {"components": [], "mixture_kurtosis": []}}

    timestamps = []
    d1_data: Dict[str, Any] = {"components": [], "mixture_kurtosis": []}
    d2_data: Dict[str, Any] = {"components": [], "mixture_kurtosis": []}

    # Store previous window's component params for matching
    d1_prev_comps: List[Tuple[float, float]] = []
    d2_prev_comps: List[Tuple[float, float]] = []

    # Determine fixed N from first window if not explicitly set
    if n_components is None or n_components < 1:
        first_window = candles[:window_size]
        _, _, d1_raw, d2_raw, bc, _ = build_distributions(first_window, num_bins)
        if sync_gmm:
            _, _, n_components = fit_synced_gmm(np.array(bc), d1_raw, d2_raw)
        else:
            g1 = fit_gmm(np.array(bc), d1_raw)
            n_components = g1.n_components

    for start in range(0, len(candles) - window_size + 1, step_size):
        window = candles[start:start + window_size]
        mid_ts = window[len(window) // 2].timestamp
        timestamps.append(mid_ts)

        try:
            _, _, d1_raw, d2_raw, bc, _ = build_distributions(window, num_bins)
            bc_arr = np.array(bc)

            gmm_d1 = fit_gmm(bc_arr, d1_raw, n_components_override=n_components)
            gmm_d2 = fit_gmm(bc_arr, d2_raw, n_components_override=n_components)

            for dist_data, gmm, prev_key in [
                (d1_data, gmm_d1, "d1"),
                (d2_data, gmm_d2, "d2"),
            ]:
                prev_comps = d1_prev_comps if prev_key == "d1" else d2_prev_comps

                # Extract current component params
                cur_comps = [(c.mean, c.std_dev) for c in gmm.components]

                # Match to previous window's components
                mapping = _mahalanobis_match(prev_comps, cur_comps)

                # Ensure enough component slots exist
                max_idx = max(mapping) if mapping else -1
                while len(dist_data["components"]) <= max_idx:
                    n_prev_ts = len(timestamps) - 1
                    dist_data["components"].append({
                        "mean": [None] * n_prev_ts,
                        "sigma": [None] * n_prev_ts,
                        "weight": [None] * n_prev_ts,
                    })

                # Write current values into matched slots
                written = set()
                for j, comp in enumerate(gmm.components):
                    slot = mapping[j]
                    dist_data["components"][slot]["mean"].append(comp.mean)
                    dist_data["components"][slot]["sigma"].append(comp.std_dev)
                    dist_data["components"][slot]["weight"].append(comp.weight)
                    written.add(slot)

                # Fill None for any existing slots not matched this window
                for slot in range(len(dist_data["components"])):
                    if slot not in written:
                        dist_data["components"][slot]["mean"].append(None)
                        dist_data["components"][slot]["sigma"].append(None)
                        dist_data["components"][slot]["weight"].append(None)

                # Update previous components for next iteration
                if prev_key == "d1":
                    d1_prev_comps = cur_comps
                else:
                    d2_prev_comps = cur_comps

                # Mixture kurtosis: excess kurtosis of the full mixture PDF
                weights = np.array([c.weight for c in gmm.components])
                means = np.array([c.mean for c in gmm.components])
                sigmas = np.array([c.std_dev for c in gmm.components])
                mix_mean = np.sum(weights * means)
                mix_var = np.sum(weights * (sigmas**2 + means**2)) - mix_mean**2
                if mix_var > 1e-12:
                    m4 = np.sum(weights * (
                        sigmas**4 * 3  # E[X^4] for Gaussian = 3σ^4
                        + 6 * sigmas**2 * (means - mix_mean)**2
                        + (means - mix_mean)**4
                    ))
                    kurt = m4 / (mix_var**2) - 3.0
                else:
                    kurt = 0.0
                dist_data["mixture_kurtosis"].append(round(float(kurt), 4))

        except Exception:
            # Fill with None for failed windows
            for dist_data in [d1_data, d2_data]:
                for comp in dist_data["components"]:
                    comp["mean"].append(None)
                    comp["sigma"].append(None)
                    comp["weight"].append(None)
                dist_data["mixture_kurtosis"].append(None)

    return {"timestamps": timestamps, "d1": d1_data, "d2": d2_data}


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
