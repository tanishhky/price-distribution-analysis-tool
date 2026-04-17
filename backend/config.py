"""
Application Configuration — Environment-based settings via pydantic.
"""

import os
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""
    POLYGON_API_KEY: str = os.getenv('POLYGON_API_KEY', '')
    POLYGON_API_KEYS: List[str] = [k.strip() for k in os.getenv('POLYGON_API_KEYS', os.getenv('POLYGON_API_KEY', '')).split(',') if k.strip()]
    DATABASE_URL: str = os.getenv('DATABASE_URL', 'sqlite:///voledge.db')
    CORS_ORIGINS: List[str] = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000').split(',')
    MAX_UPLOAD_SIZE_MB: int = int(os.getenv('MAX_UPLOAD_SIZE_MB', '100'))
    SANDBOX_TIMEOUT_SECONDS: int = int(os.getenv('SANDBOX_TIMEOUT_SECONDS', '300'))
    LOG_LEVEL: str = os.getenv('LOG_LEVEL', 'INFO')
    DATA_DIR: str = os.getenv('DATA_DIR', './data')
    
    # Strategy execution
    MAX_STRATEGY_DAYS: int = int(os.getenv('MAX_STRATEGY_DAYS', '10000'))
    MAX_TICKERS: int = int(os.getenv('MAX_TICKERS', '100'))
    
    # Monte Carlo
    MONTE_CARLO_SIMS: int = int(os.getenv('MONTE_CARLO_SIMS', '10000'))
    

settings = Settings()
