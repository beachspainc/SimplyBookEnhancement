"""
volatility_metrics.py
=====================
Reusable functions for:
1) Spend-track volatility        (SpendVol)
2) Performance-track volatility  (PerfVol)
3) Composite account volatility  (AccountVol)

Author : ChatGPT (OpenAI)
Date   : 2025-08-05
"""

from pathlib import Path
from typing import Dict, Callable, Sequence

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


# ------------------------------------------------------------------ #
# 0. Helpers
# ------------------------------------------------------------------ #
def mad(arr: np.ndarray) -> float:
    """Median Absolute Deviation (unscaled)."""
    median = np.median(arr)
    return np.median(np.abs(arr - median))


def parse_numeric(series: pd.Series, dtype):
    """
    Robust numeric conversion.
    - Works whether the column is already numeric or still a string
      with thousands separators.
    - Removes ',' thousands separators.
    - Converts to requested dtype.
    - NaN → 0  (adjust .fillna if you prefer to keep NaN)
    """
    return (
        pd.to_numeric(series.astype(str).str.replace(",", ""), errors="coerce")
          .fillna(0)
          .astype(dtype)
    )


# ------------------------------------------------------------------ #
# 1. Spend-track Volatility
# ------------------------------------------------------------------ #
def compute_spend_vol(
    df: pd.DataFrame,
    cost_col: str,
    date_col: str,
    plan_func: Callable[[pd.Timestamp], float],
    out_col: str = "SpendVol",
) -> pd.Series:
    """
    SpendVol_t = |Cost_t − Plan_t| / Plan_t
    """
    df["__plan_tmp"] = df[date_col].apply(plan_func)
    df[out_col] = (df[cost_col] - df["__plan_tmp"]).abs() / df["__plan_tmp"]
    return df[out_col]


# ------------------------------------------------------------------ #
# 2. Performance-track Volatility
# ------------------------------------------------------------------ #
def compute_perf_vol(
    df: pd.DataFrame,
    metrics: Dict[str, Dict],
    window: int = 7,
    out_col: str = "PerfVol",
) -> pd.Series:
    """
    metrics = {
        'CPA': {'col': 'CPA', 'direction': 'inverse', 'weight': 0.5},
        'CTR': {'col': 'CTR', 'direction': 'direct',  'weight': 0.25},
        'CPC': {'col': 'CPC', 'direction': 'inverse', 'weight': 0.25},
    }
    direction = 'direct'  → value ↑ is good
    direction = 'inverse' → value ↓ is good (multiply by −1 before z-score)
    """
    z_cols: Sequence[str] = []

    for name, cfg in metrics.items():
        col, direction = cfg["col"], cfg["direction"]
        sign = 1 if direction == "direct" else -1
        series = df[col] * sign

        med = series.rolling(window).median()
        mad_val = series.rolling(window).apply(mad, raw=True)

        z_col = f"z_{name}"
        df[z_col] = ((series - med) / (mad_val / 0.6745)).abs()
        z_cols.append(z_col)

    # RMS aggregation with weights
    weights = np.array([metrics[n]["weight"] for n in metrics])
    z_values = df[z_cols].values                     # shape (n_days, n_metrics)
    df[out_col] = np.sqrt((z_values ** 2 * weights).sum(axis=1) / weights.sum())
    return df[out_col]


# ------------------------------------------------------------------ #
# 3. Composite Volatility
# ------------------------------------------------------------------ #
def compute_account_vol(
    df: pd.DataFrame,
    spend_col: str = "SpendVol",
    perf_col: str = "PerfVol",
    alpha: float = 0.5,
    beta: float = 0.5,
    out_col: str = "AccountVol",
) -> pd.Series:
    """
    AccountVol_t = α · SpendVol_t + β · PerfVol_t
    α + β must equal 1 (default 0.5 / 0.5)
    """
    if not np.isclose(alpha + beta, 1.0):
        raise ValueError("alpha + beta must equal 1.")
    df[out_col] = alpha * df[spend_col] + beta * df[perf_col]
    return df[out_col]


# ------------------------------------------------------------------ #
# Example usage
# ------------------------------------------------------------------ #
if __name__ == "__main__":  # pragma: no cover
    # ---------- 1. Load & clean ----------
    FILE = Path("Campaign performance (5).csv")   # ← replace with your path
    RAW_SKIP = 2                                  # rows to skip before header

    df = pd.read_csv(FILE, skiprows=RAW_SKIP)

    # robust numeric casting
    numeric_cols = {
        "Impr.": int,
        "Clicks": int,
        "Cost": float,
        "Conversions": float,
    }
    for col, dtype in numeric_cols.items():
        df[col] = parse_numeric(df[col], dtype)

    # date & derived efficiency metrics
    df["Day"] = pd.to_datetime(df["Day"])
    df["CTR"] = df["Clicks"] / df["Impr."]
    df["CPA"] = df["Cost"] / df["Conversions"].replace(0, np.nan)
    df["CPC"] = df["Cost"] / df["Clicks"].replace(0, np.nan)

    # ---------- 2. Spend-track ----------
    def plan_curve(ts: pd.Timestamp) -> float:
        """Linear budget taper 200 → 50 over August."""
        if ts.month == 8:
            return 200 - (150 / 30) * (ts.day - 1)
        return 200.0

    compute_spend_vol(df, cost_col="Cost", date_col="Day", plan_func=plan_curve)

    # ---------- 3. Performance-track ----------
    metric_cfg = {
        "CPA": {"col": "CPA", "direction": "inverse", "weight": 0.5},
        "CTR": {"col": "CTR", "direction": "direct", "weight": 0.25},
        "CPC": {"col": "CPC", "direction": "inverse", "weight": 0.25},
    }
    compute_perf_vol(df, metrics=metric_cfg, window=7)

    # ---------- 4. Composite ----------
    compute_account_vol(df, alpha=0.5, beta=0.5)

    # ---------- 5. Console table ----------
    cols_to_show = ["Day", "SpendVol", "PerfVol", "AccountVol"]
    pd.set_option("display.float_format", "{:.4f}".format)  # 可视化保留 4 位小数
    print("\n=== Volatility Dashboard (table view) ===")
    print(df[cols_to_show].to_string(index=False))

    # ---------- 6. Plot ----------
    plt.figure(figsize=(12, 6))
    plt.plot(df["Day"], df["SpendVol"], label="SpendVol")
    plt.plot(df["Day"], df["PerfVol"], label="PerfVol")
    plt.plot(df["Day"], df["AccountVol"], label="AccountVol")
    plt.legend()
    plt.xlabel("Date")
    plt.ylabel("Volatility (unitless)")
    plt.title("Account Volatility Dashboard")
    plt.grid(True, linestyle="--", linewidth=0.4)
    plt.tight_layout()
    plt.show()
