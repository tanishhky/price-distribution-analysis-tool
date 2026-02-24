import httpx
from typing import List, Optional
from models import OptionContract, Candle

POLYGON_BASE = "https://api.polygon.io"


async def fetch_options_contracts(
    api_key: str,
    underlying_ticker: str,
    expiration_date_gte: Optional[str] = None,
    expiration_date_lte: Optional[str] = None,
    strike_price_gte: Optional[float] = None,
    strike_price_lte: Optional[float] = None,
    contract_type: Optional[str] = None,
    limit: int = 250,
) -> List[OptionContract]:
    """
    Fetch active option contracts from Polygon reference endpoint (free tier).
    GET /v3/reference/options/contracts
    """
    url = f"{POLYGON_BASE}/v3/reference/options/contracts"
    params = {
        "underlying_ticker": underlying_ticker.upper(),
        "limit": min(limit, 1000),
        "apiKey": api_key,
        "order": "asc",
        "sort": "expiration_date",
    }
    if expiration_date_gte:
        params["expiration_date.gte"] = expiration_date_gte
    if expiration_date_lte:
        params["expiration_date.lte"] = expiration_date_lte
    if strike_price_gte is not None:
        params["strike_price.gte"] = strike_price_gte
    if strike_price_lte is not None:
        params["strike_price.lte"] = strike_price_lte
    if contract_type:
        params["contract_type"] = contract_type

    contracts: List[OptionContract] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        pages = 0
        while url and pages < 10:
            response = await client.get(url, params=params)
            if response.status_code != 200:
                raise RuntimeError(f"Polygon options contracts API error {response.status_code}: {response.text}")

            data = response.json()
            results = data.get("results", [])
            for r in results:
                contracts.append(OptionContract(
                    ticker=r.get("ticker", ""),
                    underlying_ticker=r.get("underlying_ticker", underlying_ticker.upper()),
                    contract_type=r.get("contract_type", ""),
                    strike_price=float(r.get("strike_price", 0)),
                    expiration_date=r.get("expiration_date", ""),
                    shares_per_contract=int(r.get("shares_per_contract", 100)),
                ))

            next_url = data.get("next_url")
            if next_url and len(contracts) < limit:
                # next_url already contains all query params including apiKey;
                # clear params to avoid sending duplicate query parameters.
                url = next_url
                params = {}
                pages += 1
            else:
                url = None

    return contracts[:limit]


async def fetch_option_daily_bar(
    api_key: str,
    option_ticker: str,
    date: str,
) -> Optional[dict]:
    """
    Fetch daily OHLCV for a specific option contract on a date.
    GET /v1/open-close/{ticker}/{date}  (free tier: previous day close)
    Falls back to aggregate bars if open-close unavailable.
    """
    # Try aggregates endpoint (more reliable on free tier)
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{option_ticker}/range"
        f"/1/day/{date}/{date}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 1,
        "apiKey": api_key,
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return None

        data = response.json()
        results = data.get("results", [])
        if not results:
            return None

        r = results[0]
        return {
            "open": r.get("o", 0),
            "high": r.get("h", 0),
            "low": r.get("l", 0),
            "close": r.get("c", 0),
            "volume": r.get("v", 0),
            "vwap": r.get("vw"),
        }


async def fetch_option_bars_range(
    api_key: str,
    option_ticker: str,
    start_date: str,
    end_date: str,
) -> List[Candle]:
    """
    Fetch daily OHLCV bars for an option contract over a date range.
    """
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{option_ticker}/range"
        f"/1/day/{start_date}/{end_date}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": 50000,
        "apiKey": api_key,
    }

    candles: List[Candle] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return candles

        data = response.json()
        for r in data.get("results", []):
            candles.append(Candle(
                timestamp=r["t"],
                open=r.get("o", 0),
                high=r.get("h", 0),
                low=r.get("l", 0),
                close=r.get("c", 0),
                volume=r.get("v", 0),
                vwap=r.get("vw"),
            ))

    return candles


async def fetch_previous_close(
    api_key: str,
    ticker: str,
) -> Optional[float]:
    """
    Get previous day close for underlying.
    GET /v2/aggs/ticker/{ticker}/prev
    """
    url = f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/prev"
    params = {"adjusted": "true", "apiKey": api_key}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return None

        data = response.json()
        results = data.get("results", [])
        if results:
            return float(results[0].get("c", 0))
    return None


async def fetch_option_last_trade(
    api_key: str,
    option_ticker: str,
) -> Optional[dict]:
    """
    Get last trade for an option contract.
    GET /v2/last/trade/{ticker}  (free tier supported)
    """
    url = f"{POLYGON_BASE}/v2/last/trade/{option_ticker}"
    params = {"apiKey": api_key}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return None

        data = response.json()
        result = data.get("results", {})
        if result:
            return {
                "price": result.get("p", 0),
                "size": result.get("s", 0),
                "timestamp": result.get("t", 0),
            }
    return None


async def fetch_option_last_quote(
    api_key: str,
    option_ticker: str,
) -> Optional[dict]:
    """
    Get last quote (bid/ask) for an option contract.
    GET /v2/last/nbbo/{ticker}
    """
    url = f"{POLYGON_BASE}/v2/last/nbbo/{option_ticker}"
    params = {"apiKey": api_key}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return None

        data = response.json()
        result = data.get("results", {})
        if result:
            return {
                "bid": result.get("P", 0),   # NBBO bid price
                "bid_size": result.get("S", 0),
                "ask": result.get("p", 0),   # NBBO ask price
                "ask_size": result.get("s", 0),
            }
    return None
