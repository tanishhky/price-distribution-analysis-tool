import httpx
from typing import List, Tuple
from models import Candle

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
                url = next_url
                params = {"apiKey": api_key}
            else:
                url = None

    return candles


SUPPORTED_INTERVALS = {
    "stocks": ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"],
    "crypto": ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"],
    "forex":  ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"],
}
