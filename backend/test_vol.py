import requests
import json
import time

keys = [
    "C_FEcnCjRa_eYvSJ_6wNSxeq_DNcPHtD",
    "6eu_W12Gpo50WYtc1PAEQM3I1giAVSzE",
    "9z4Ha1X1KEuRnhxCF2OopYG7ToW3R4C9"
]

print("1) Fetching candles...")
c_payload = {
    "api_keys": keys,
    "ticker": "SPY",
    "asset_class": "stocks",
    "timeframe": "1day",
    "start_date": "2024-01-01",
    "end_date": "2024-04-01"
}
resp_c = requests.post("http://127.0.0.1:8000/fetch", json=c_payload)
candles = []
spot = 500.0
if resp_c.status_code == 200:
    data_c = resp_c.json()
    candles = data_c.get("candles", [])
    if candles:
        spot = candles[-1]["close"]
else:
    print("Failed to fetch candles:", resp_c.text)

print(f"Got {len(candles)} candles. Spot: {spot}")

payload = {
    "api_keys": keys,
    "ticker": "SPY",
    "candles": candles,
    "spot_price": spot,
    "timeframe": "1day",
    "asset_class": "stocks",
    "risk_free_rate": 0.05,
    "dividend_yield": 0.0,
    "near_expiry_min_days": 1,
    "near_expiry_max_days": 14,
    "far_expiry_min_days": 15,
    "far_expiry_max_days": 35,
    "strike_range_pct": 0.03,  # Very narrow, ±3%
    "batch_size": 4,
    "batch_delay": 61
}

print("2) Fetching volatility...")
resp_v = requests.post("http://127.0.0.1:8000/volatility", json=payload)
if resp_v.status_code == 200:
    with open("../test_payload_vol.json", "w") as f:
        json.dump(resp_v.json(), f)
    print("Success! Saved as test_payload_vol.json")
else:
    print("Failed to fetch vol:", resp_v.text)

