"""
Strategy API Routes — Add these to your backend/main.py

PASTE these endpoints AFTER your existing /volatility/reprocess endpoint.
Also add this import at the top of main.py:

    from strategy_engine import (
        StrategyDefinition, StrategyRunner, StrategyConfig,
        validate_strategy_code, STRATEGY_TEMPLATES, STRATEGY_API_DOCS,
    )
"""

from fastapi import HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any


# ── Models ──

class StrategyRunRequest(BaseModel):
    name: str
    tickers: List[str]
    benchmark: str = "SPY"
    regime_code: str
    start_date: str = "2019-01-01"
    end_date: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    regimes: Optional[List[Dict]] = None

class StrategyValidateRequest(BaseModel):
    code: str

class StrategyTemplateRequest(BaseModel):
    template_id: str
    tickers: Optional[List[str]] = None
    start_date: str = "2019-01-01"
    end_date: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


# ── Endpoints ──

@app.post("/strategy/validate")
async def validate_strategy(req: StrategyValidateRequest):
    """Validate user-uploaded strategy code without executing it."""
    is_valid, error, warnings = validate_strategy_code(req.code)
    return {
        "valid": is_valid,
        "error": error if not is_valid else None,
        "warnings": warnings,
    }


@app.post("/strategy/run")
async def run_strategy(req: StrategyRunRequest):
    """
    Execute a strategy using walk-forward methodology.
    Returns daily P&L, regime history, metrics — all with zero look-ahead bias.
    """
    # 1. Validate code
    is_valid, error, warnings = validate_strategy_code(req.regime_code)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid strategy code: {error}")

    # 2. Build definition
    cfg = StrategyConfig(**(req.config or {}))

    from strategy_engine import RegimeDefinition
    regime_defs = None
    if req.regimes:
        regime_defs = [RegimeDefinition(**r) for r in req.regimes]

    defn = StrategyDefinition(
        name=req.name,
        tickers=req.tickers,
        benchmark=req.benchmark,
        config=cfg,
        regime_code=req.regime_code,
        regimes=regime_defs,
    )

    # 3. Run
    try:
        runner = StrategyRunner(defn)
        result = runner.run(
            start_date=req.start_date,
            end_date=req.end_date,
        )
        result['validation_warnings'] = warnings
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {str(e)}")


@app.post("/strategy/run-template")
async def run_template(req: StrategyTemplateRequest):
    """Run a built-in strategy template."""
    if req.template_id not in STRATEGY_TEMPLATES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template: {req.template_id}. "
                   f"Available: {list(STRATEGY_TEMPLATES.keys())}"
        )

    tmpl = STRATEGY_TEMPLATES[req.template_id]
    tickers = req.tickers or tmpl['default_tickers']
    merged_config = {**tmpl['default_config'], **(req.config or {})}

    defn = StrategyDefinition(
        name=tmpl['name'],
        tickers=tickers,
        benchmark="SPY",
        config=StrategyConfig(**merged_config),
        regime_code=tmpl['code'],
    )

    try:
        runner = StrategyRunner(defn)
        result = runner.run(
            start_date=req.start_date,
            end_date=req.end_date,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy execution error: {str(e)}")


@app.get("/strategy/templates")
async def get_templates():
    """List all available strategy templates with their code and defaults."""
    return {
        tid: {
            'name': t['name'],
            'description': t['description'],
            'code': t['code'],
            'default_tickers': t['default_tickers'],
            'default_config': t['default_config'],
        }
        for tid, t in STRATEGY_TEMPLATES.items()
    }


@app.get("/strategy/docs")
async def get_strategy_docs():
    """Return the complete Strategy API specification."""
    return STRATEGY_API_DOCS
