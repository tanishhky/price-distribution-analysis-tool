from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


# ─────────────────────────────────────────────
# Existing price distribution models
# ─────────────────────────────────────────────

class FetchRequest(BaseModel):
    api_keys: List[str]  # one or more Polygon.io API keys
    ticker: str
    asset_class: str
    timeframe: str
    start_date: str
    end_date: str


class Candle(BaseModel):
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    vwap: Optional[float] = None


class FetchResponse(BaseModel):
    ticker: str
    asset_class: str
    timeframe: str
    start_date: str
    end_date: str
    candles: List[Candle]
    total_candles: int


class AnalyzeRequest(BaseModel):
    ticker: str
    asset_class: str
    timeframe: str
    start_date: str
    end_date: str
    candles: List[Candle]
    num_bins: int = Field(default=200, ge=50, le=500)
    n_components_override: Optional[int] = Field(default=None, ge=1, le=10)
    sync_gmm: bool = False  # If True, find best N across both D1 and D2
    moment_window_ratio: int = 5   # window = max(30, candles / ratio)
    moment_step_ratio: int = 30    # step = max(5, candles / ratio)


class GMMComponent(BaseModel):
    component_index: int
    weight: float
    mean: float
    std_dev: float
    variance: float
    skewness: float
    kurtosis: float
    range_1sigma: List[float]
    range_2sigma: List[float]
    label: str


class GMMResult(BaseModel):
    n_components: int
    bic_scores: Dict[str, float]
    components: List[GMMComponent]
    fitted_curve_x: List[float]
    fitted_curve_y: List[float]
    component_curves: List[Dict[str, Any]]


class DistributionData(BaseModel):
    price_bins: List[float]
    density: List[float]
    kde_x: List[float]
    kde_y: List[float]


class AnalyzeResponse(BaseModel):
    ticker: str
    asset_class: str
    timeframe: str
    start_date: str
    end_date: str
    total_candles: int
    num_bins: int
    d1: DistributionData
    d2: DistributionData
    gmm_d1: GMMResult
    gmm_d2: GMMResult
    results_text: str
    moment_evolution: Optional[Dict[str, Any]] = None  # sliding window moment data


# ─────────────────────────────────────────────
# Options & Volatility models
# ─────────────────────────────────────────────

class OptionsChainRequest(BaseModel):
    api_key: str
    ticker: str                          # underlying e.g. AAPL
    expiration_date_gte: Optional[str] = None   # YYYY-MM-DD
    expiration_date_lte: Optional[str] = None
    strike_price_gte: Optional[float] = None
    strike_price_lte: Optional[float] = None
    contract_type: Optional[str] = None  # "call" or "put" or None for both
    limit: int = 250


class OptionContract(BaseModel):
    ticker: str                    # e.g. O:AAPL250321C00170000
    underlying_ticker: str
    contract_type: str             # "call" | "put"
    strike_price: float
    expiration_date: str           # YYYY-MM-DD
    shares_per_contract: int = 100


class OptionContractWithGreeks(BaseModel):
    contract: OptionContract
    # Market data
    last_price: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    mid_price: Optional[float] = None
    open_interest: Optional[float] = None
    volume: Optional[float] = None
    # Computed greeks (Black-Scholes)
    implied_volatility: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    rho: Optional[float] = None
    # Derived
    moneyness: Optional[float] = None           # S/K
    days_to_expiry: Optional[int] = None
    intrinsic_value: Optional[float] = None
    extrinsic_value: Optional[float] = None


class VolSurfacePoint(BaseModel):
    strike: float
    expiry_days: int
    expiry_date: str
    moneyness: float
    iv: float
    contract_type: str


class VolatilityAnalysis(BaseModel):
    # Underlying info
    underlying_ticker: str
    spot_price: float
    analysis_date: str
    # Realized volatility from candles
    realized_vol_10d: Optional[float] = None
    realized_vol_20d: Optional[float] = None
    realized_vol_30d: Optional[float] = None
    realized_vol_60d: Optional[float] = None
    parkinson_vol_20d: Optional[float] = None
    # GMM-enhanced realized vol
    gmm_weighted_vol: Optional[float] = None
    gmm_weighted_kurtosis: Optional[float] = None
    # IV summary
    atm_iv_near: Optional[float] = None         # near-term ATM IV
    atm_iv_far: Optional[float] = None          # far-term ATM IV
    iv_term_structure: Optional[str] = None      # "contango" | "backwardation" | "flat"
    put_call_skew_25d: Optional[float] = None    # 25-delta skew
    # VRP
    vrp_10d: Optional[float] = None
    vrp_20d: Optional[float] = None
    vrp_30d: Optional[float] = None
    # Surface data
    surface_points: List[VolSurfacePoint] = []
    # Full chain with greeks
    chain: List[OptionContractWithGreeks] = []
    # BKM risk-neutral moments (model-free, from OTM option prices)
    rn_bkm_30d: Optional[Dict[str, Any]] = None
    rn_bkm_60d: Optional[Dict[str, Any]] = None


class TradeSignal(BaseModel):
    signal_type: str          # "vol_crush", "skew_trade", "mean_reversion", "calendar", "gamma_scalp"
    direction: str            # "sell_premium", "buy_premium", "spread"
    conviction: str           # "high", "medium", "low"
    strategy: str             # e.g. "Iron Condor", "Put Credit Spread", "Straddle"
    description: str
    rationale: str
    # Specific contracts
    legs: List[Dict[str, Any]] = []
    # Risk metrics
    max_profit: Optional[float] = None
    max_loss: Optional[float] = None
    breakeven_low: Optional[float] = None
    breakeven_high: Optional[float] = None
    probability_of_profit: Optional[float] = None
    risk_reward_ratio: Optional[float] = None
    # Greeks of position
    net_delta: Optional[float] = None
    net_gamma: Optional[float] = None
    net_theta: Optional[float] = None
    net_vega: Optional[float] = None
    # Transaction costs
    estimated_execution_cost: Optional[float] = None  # total spread cost per contract


class VolatilityResponse(BaseModel):
    volatility_analysis: VolatilityAnalysis
    trade_signals: List[TradeSignal]
    summary_text: str
    # Cached raw data — returned so the frontend can reprocess without re-fetching
    cached_contracts: List[OptionContract] = []
    cached_bars: Dict[str, Any] = {}      # option_ticker -> {close, volume, ...}


class VolatilityRequest(BaseModel):
    api_keys: List[str]  # one or more Polygon.io API keys
    ticker: str
    candles: List[Candle]              # underlying candles already fetched
    spot_price: float
    timeframe: str = "1day"            # e.g. "1min","5min","1hour","1day","1week"
    asset_class: str = "stocks"        # "stocks", "crypto", or "forex"
    gmm_d2: Optional[GMMResult] = None  # pass GMM results for enhanced analysis
    risk_free_rate: float = 0.05
    dividend_yield: float = 0.0
    near_expiry_min_days: int = 1
    near_expiry_max_days: int = 14
    far_expiry_min_days: int = 15
    far_expiry_max_days: int = 40
    strike_range_pct: float = 0.05     # +/- 5% from spot
    batch_size: int = 5                # requests per key per batch
    batch_delay: int = 61              # seconds between batches


class ReprocessRequest(BaseModel):
    """Re-run greeks/IV/signals using cached data — no Polygon API calls."""
    ticker: str
    candles: List[Candle]
    spot_price: float
    timeframe: str = "1day"
    asset_class: str = "stocks"
    gmm_d2: Optional[GMMResult] = None
    risk_free_rate: float = 0.05
    dividend_yield: float = 0.0
    near_expiry_min_days: int = 1
    near_expiry_max_days: int = 14
    far_expiry_min_days: int = 15
    far_expiry_max_days: int = 40
    strike_range_pct: float = 0.05
    # Cached data from a previous /volatility call
    cached_contracts: List[OptionContract]
    cached_bars: Dict[str, Any]        # option_ticker -> {close, volume, ...}

