import httpx
import asyncio
from typing import List, Tuple
from models import Candle
from datetime import datetime, timedelta

POLYGON_BASE = "https://api.polygon.io"

TIMEFRAME_MAP = {
    "1min":  (1, "minute"),
    "5min":  (5, "minute"),
    "15min": (15, "minute"),
    "30min": (30, "minute"),
    "1hour": (1, "hour"),
    "4hour": (4, "hour"),
    "1day":  (1, "day"),
    "1week": (1, "week"),
}

SUPPORTED_INTERVALS = list(TIMEFRAME_MAP.keys())


def detect_asset_class(ticker: str) -> str:
    t = ticker.upper()
    if t.startswith("X:"):
        return "crypto"
    if t.startswith("C:"):
        return "forex"
    return "stocks"


def normalize_ticker(ticker: str, asset_class: str) -> str:
    t = ticker.upper().strip()
    if asset_class == "crypto":
        if not t.startswith("X:"):
            return f"X:{t}"
    elif asset_class == "forex":
        if not t.startswith("C:"):
            return f"C:{t}"
    return t


async def fetch_candles(
    api_key: str,
    ticker: str,
    asset_class: str,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> List[Candle]:
    if asset_class == "auto":
        asset_class = detect_asset_class(ticker)

    normalized_ticker = normalize_ticker(ticker, asset_class)

    if timeframe not in TIMEFRAME_MAP:
        raise ValueError(f"Unsupported timeframe: {timeframe}. Valid: {list(TIMEFRAME_MAP.keys())}")

    multiplier, timespan = TIMEFRAME_MAP[timeframe]

    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{normalized_ticker}/range"
        f"/{multiplier}/{timespan}/{start_date}/{end_date}"
    )

    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 50000,
        "apiKey": api_key,
    }

    candles: List[Candle] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        while url:
            response = await client.get(url, params=params)
            if response.status_code != 200:
                body = response.text
                raise RuntimeError(
                    f"Polygon API error {response.status_code}: {body}"
                )

            data = response.json()

            if data.get("status") in ("ERROR", "DELAYED"):
                raise RuntimeError(f"Polygon API returned status: {data.get('status')} — {data.get('error', '')}")

            results = data.get("results", [])
            for r in results:
                candles.append(
                    Candle(
                        timestamp=r["t"],
                        open=r["o"],
                        high=r["h"],
                        low=r["l"],
                        close=r["c"],
                        volume=r.get("v", 0.0),
                        vwap=r.get("vw"),
                    )
                )

            next_url = data.get("next_url")
            if next_url:
                # next_url already contains all query params including apiKey;
                # clear params to avoid sending duplicate query parameters.
                url = next_url
                params = {}
            else:
                url = None

    return candles


# ═══════════════════════════════════════════════
#  MULTI-KEY PARALLEL CANDLE FETCHING
# ═══════════════════════════════════════════════

def _split_date_range(start_date: str, end_date: str, n_chunks: int) -> List[Tuple[str, str]]:
    """
    Split a date range into n_chunks roughly equal sub-ranges.
    Returns list of (start, end) ISO date strings.
    """
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    total_days = (end - start).days

    if total_days <= 0 or n_chunks <= 1:
        return [(start_date, end_date)]

    chunk_days = max(1, total_days // n_chunks)
    ranges = []
    current = start

    for i in range(n_chunks):
        chunk_start = current
        if i == n_chunks - 1:
            # Last chunk gets the remainder
            chunk_end = end
        else:
            chunk_end = current + timedelta(days=chunk_days - 1)
            if chunk_end > end:
                chunk_end = end

        ranges.append((chunk_start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        current = chunk_end + timedelta(days=1)

        if current > end:
            break

    return ranges


async def _fetch_chunk(
    api_key: str, ticker: str, asset_class: str,
    timeframe: str, start_date: str, end_date: str,
    rate_limit_delay: float = 12.5,
) -> List[Candle]:
    """
    Fetch one date-range chunk with a single API key.
    Includes a pre-request delay to respect rate limits (5 req/min/key).
    """
    await asyncio.sleep(rate_limit_delay)
    return await fetch_candles(api_key, ticker, asset_class, timeframe, start_date, end_date)


async def fetch_candles_parallel(
    api_keys: List[str],
    ticker: str,
    asset_class: str,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> List[Candle]:
    """
    Fetch candles using multiple API keys in parallel.
    Splits the date range into chunks (one per key) and fetches concurrently.
    Deduplicates by timestamp and returns sorted candles.

    If only 1 key is provided, falls back to simple sequential fetch.
    """
    n_keys = len(api_keys)

    if n_keys <= 1:
        return await fetch_candles(api_keys[0], ticker, asset_class, timeframe, start_date, end_date)

    # Split date range across keys
    date_chunks = _split_date_range(start_date, end_date, n_keys)

    # Launch parallel fetches — each key handles one chunk
    tasks = []
    for i, (chunk_start, chunk_end) in enumerate(date_chunks):
        key = api_keys[i % n_keys]
        # Stagger start times slightly to avoid hitting the API simultaneously
        tasks.append(
            _fetch_chunk(key, ticker, asset_class, timeframe, chunk_start, chunk_end,
                         rate_limit_delay=i * 0.5)  # Small stagger, not full rate limit
        )

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Collect all candles, handling any failures gracefully
    all_candles: List[Candle] = []
    errors = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            errors.append(f"Chunk {i} failed: {result}")
        else:
            all_candles.extend(result)

    if not all_candles and errors:
        raise RuntimeError(f"All parallel fetches failed: {'; '.join(errors)}")

    # Deduplicate by timestamp and sort
    seen = {}
    for c in all_candles:
        if c.timestamp not in seen:
            seen[c.timestamp] = c

    deduped = sorted(seen.values(), key=lambda c: c.timestamp)
    return deduped
