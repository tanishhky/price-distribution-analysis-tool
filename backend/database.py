"""
Database Layer — SQLite storage for strategies, runs, and sessions.
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any


DB_PATH = os.environ.get('DATABASE_URL', 'voledge.db').replace('sqlite:///', '')


def get_db():
    """Get database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Initialize database tables."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            created_at TEXT DEFAULT (datetime('now')),
            data_info TEXT
        );
        
        CREATE TABLE IF NOT EXISTS strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            code TEXT,
            config_json TEXT,
            mode TEXT DEFAULT 'api',
            tags TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        CREATE TABLE IF NOT EXISTS backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER,
            strategy_name TEXT,
            mode TEXT DEFAULT 'api',
            config_json TEXT,
            metrics_json TEXT,
            result_json TEXT,
            console_output TEXT,
            duration_seconds REAL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_runs_strategy ON backtest_runs(strategy_id);
        CREATE INDEX IF NOT EXISTS idx_runs_created ON backtest_runs(created_at);
    """)
    conn.commit()
    conn.close()


# ── Strategy CRUD ──

def save_strategy(name: str, code: str, config: Dict = None, 
                  description: str = '', mode: str = 'api', tags: str = '') -> int:
    """Save a strategy and return its ID."""
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO strategies (name, description, code, config_json, mode, tags) VALUES (?,?,?,?,?,?)",
        (name, description, code, json.dumps(config or {}), mode, tags)
    )
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return sid


def list_strategies() -> List[Dict]:
    """List all saved strategies."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, description, mode, tags, created_at, updated_at FROM strategies ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_strategy(strategy_id: int) -> Optional[Dict]:
    """Get a single strategy by ID."""
    conn = get_db()
    row = conn.execute("SELECT * FROM strategies WHERE id = ?", (strategy_id,)).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['config'] = json.loads(d.get('config_json') or '{}')
        return d
    return None


def delete_strategy(strategy_id: int) -> bool:
    """Delete a strategy."""
    conn = get_db()
    conn.execute("DELETE FROM strategies WHERE id = ?", (strategy_id,))
    conn.commit()
    conn.close()
    return True


def update_strategy(strategy_id: int, **kwargs) -> bool:
    """Update strategy fields."""
    conn = get_db()
    fields = []
    values = []
    for key in ['name', 'description', 'code', 'tags']:
        if key in kwargs:
            fields.append(f"{key} = ?")
            values.append(kwargs[key])
    if 'config' in kwargs:
        fields.append("config_json = ?")
        values.append(json.dumps(kwargs['config']))
    if fields:
        fields.append("updated_at = datetime('now')")
        values.append(strategy_id)
        conn.execute(f"UPDATE strategies SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    conn.close()
    return True


# ── Backtest Run Tracking ──

def save_run(strategy_name: str, mode: str, config: Dict, 
             metrics: Dict, result: Dict = None, console_output: str = '',
             duration: float = 0, strategy_id: int = None) -> int:
    """Save a backtest run result."""
    conn = get_db()
    # Store result without daily_log to save space (keep metrics)
    result_slim = {k: v for k, v in (result or {}).items() if k != 'daily_log'} if result else {}
    cur = conn.execute(
        """INSERT INTO backtest_runs 
           (strategy_id, strategy_name, mode, config_json, metrics_json, result_json, console_output, duration_seconds) 
           VALUES (?,?,?,?,?,?,?,?)""",
        (strategy_id, strategy_name, mode, json.dumps(config),
         json.dumps(metrics), json.dumps(result_slim), console_output, duration)
    )
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return rid


def list_runs(limit: int = 50) -> List[Dict]:
    """List recent backtest runs."""
    conn = get_db()
    rows = conn.execute(
        """SELECT id, strategy_name, mode, metrics_json, duration_seconds, created_at 
           FROM backtest_runs ORDER BY created_at DESC LIMIT ?""",
        (limit,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d['metrics'] = json.loads(d.pop('metrics_json') or '{}')
        result.append(d)
    return result


def get_run(run_id: int) -> Optional[Dict]:
    """Get full details of a backtest run."""
    conn = get_db()
    row = conn.execute("SELECT * FROM backtest_runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['config'] = json.loads(d.pop('config_json') or '{}')
        d['metrics'] = json.loads(d.pop('metrics_json') or '{}')
        d['result'] = json.loads(d.pop('result_json') or '{}')
        return d
    return None


# Initialize on import
init_db()
