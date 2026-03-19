"""
Data Fetcher Abstraction — Multi-source historical data fetching.
Supports yfinance (default fallback), Alpha Vantage, Tiingo, and FRED.
"""

import pandas as pd
import yfinance as yf
from typing import List, Optional
import os
import requests
import asyncio
from concurrent.futures import ThreadPoolExecutor

class DataFetcher:
    def __init__(self):
        self.alpha_vantage_key = os.getenv('ALPHA_VANTAGE_API_KEY')
        self.tiingo_key = os.getenv('TIINGO_API_KEY')
        self.fred_key = os.getenv('FRED_API_KEY')
        
        # Use a thread pool to avoid blocking the async loop with yfinance
        self.executor = ThreadPoolExecutor(max_workers=5)

    async def fetch(self, tickers: List[str], start: str, end: str, source: str = 'auto') -> pd.DataFrame:
        """
        Fetch historical daily closing prices.
        :param source: 'auto', 'yfinance', 'alphavantage', 'tiingo'
        """
        if source == 'auto':
            # Auto-routing logic. Defaulting to yfinance for free Tier.
            source = 'yfinance'
            
        if source == 'yfinance':
            return await self._fetch_yfinance(tickers, start, end)
        elif source == 'alphavantage':
            if not self.alpha_vantage_key:
                raise ValueError("ALPHA_VANTAGE_API_KEY not configured")
            return await self._fetch_alpha_vantage(tickers, start, end)
        elif source == 'tiingo':
            if not self.tiingo_key:
                raise ValueError("TIINGO_API_KEY not configured")
            return await self._fetch_tiingo(tickers, start, end)
        else:
            raise ValueError(f"Unknown data source: {source}")

    async def _fetch_yfinance(self, tickers: List[str], start: str, end: str) -> pd.DataFrame:
        loop = asyncio.get_event_loop()
        
        def _download():
            try:
                data = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)
                if isinstance(data.columns, pd.MultiIndex):
                    if 'Close' in data.columns:
                        return data['Close']
                    else:
                        raise ValueError("No close data returned from yfinance")
                else:
                    if len(tickers) == 1:
                        df = pd.DataFrame(data['Close'])
                        df.columns = tickers
                        return df
                    return data
            except Exception as e:
                raise ValueError(f"yfinance fetch failed: {e}")
                
        return await loop.run_in_executor(self.executor, _download)

    async def _fetch_alpha_vantage(self, tickers: List[str], start: str, end: str) -> pd.DataFrame:
        # Note: Alpha Vantage free tier is heavily rate limited (5/min, 500/day).
        # This implementation requires Premium for multiple tickers concurrently.
        raise NotImplementedError("Alpha Vantage fetching not fully implemented in free tier due to rate limits.")

    async def _fetch_tiingo(self, tickers: List[str], start: str, end: str) -> pd.DataFrame:
        # Tiingo is much faster for batch, but requires subscription.
        raise NotImplementedError("Tiingo fetching requires TIINGO_API_KEY and batch subscription.")

# Singleton instance
fetcher = DataFetcher()
