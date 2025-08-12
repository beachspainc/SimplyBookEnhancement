import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from typing import Callable


# --- 0. Helper Functions ---
def robust_numeric_parser(series: pd.Series, dtype):
    """
    Converts a series to a numeric type, handling common string formats.
    稳健地将序列转换为数值类型，处理常见的字符串格式。
    """
    return (
        pd.to_numeric(series.astype(str).str.replace(",", ""), errors="coerce")
        .fillna(0)
        .astype(dtype)
    )


def median_absolute_deviation(arr: np.ndarray) -> float:
    """
    Calculates the Median Absolute Deviation (MAD).
    计算中位数绝对偏差 (MAD)。
    """
    # Ensure array is not all NaNs to avoid runtime warnings
    if np.all(np.isnan(arr)):
        return np.nan
    median = np.nanmedian(arr)
    return np.nanmedian(np.abs(arr - median))


# --- 1. Performance Score Calculation (My Robust Method) ---
def calculate_daily_score(df: pd.DataFrame, k_smooth: int = 7) -> pd.DataFrame:
    """
    Calculates a single, comprehensive daily performance score.
    This multi-step process creates a stable score, avoiding NaN issues from sparse data.
    计算一个全面的每日综合表现分。这个多步骤过程可以创建一个稳定的分数，避免稀疏数据导致的NaN问题。
    """
    # Step 1a: Atomic Metrics & Smoothing (to handle sparse conversions)
    df['CTR'] = df['Clicks'] / df['Impr.']
    df['CPC'] = df['Cost'] / df['Clicks']
    df['Conv_s'] = df['Conversions'].rolling(window=k_smooth, min_periods=1).mean()
    df['ConvRate_s'] = df['Conv_s'] / df['Clicks']
    df.fillna(0, inplace=True)

    # Step 1b: Normalization (Min-Max Scaling)
    norm_df = pd.DataFrame(index=df.index)

    def min_max_scaler(series):
        if series.max() == series.min(): return pd.Series(0, index=series.index)
        return (series - series.min()) / (series.max() - series.min())

    positive_metrics = ['CTR', 'Impr.', 'ConvRate_s', 'Conv_s']
    negative_metrics = ['CPC']
    for col in positive_metrics: norm_df[col + '_norm'] = min_max_scaler(df[col])
    for col in negative_metrics: norm_df[col + '_norm_inv'] = 1 - min_max_scaler(df[col])
    norm_df.fillna(0, inplace=True)

    # Step 1c: Composite Factors
    df['InterestFactor'] = 0.6 * norm_df['CTR_norm'] + 0.4 * norm_df['Impr._norm']
    df['EfficiencyFactor'] = 0.5 * norm_df['CPC_norm_inv'] + 0.5 * norm_df['ConvRate_s_norm']
    df['OutputFactor'] = 1.0 * norm_df['Conv_s_norm']  # Simplified for clarity

    # Step 1d: Final Score Aggregation
    weights = {'interest': 0.25, 'efficiency': 0.35, 'output': 0.40}
    df['DailyScore'] = (
            weights['interest'] * df['InterestFactor'] +
            weights['efficiency'] * df['EfficiencyFactor'] +
            weights['output'] * df['OutputFactor']
    )
    return df


# --- 2. Volatility Calculations (ChatGPT's Robust Method, Adapted) ---
def compute_spend_vol(
        df: pd.DataFrame,
        cost_col: str,
        date_col: str,
        plan_func: Callable[[pd.Timestamp], float],
        out_col: str = "SpendVol",
) -> pd.DataFrame:
    """
    Calculates Spend-track Volatility: The deviation from a planned budget.
    计算支出波动率：实际支出与计划预算的偏差。
    SpendVol_t = |Cost_t − Plan_t| / Plan_t
    """
    # Handle division by zero if plan is 0
    plan_values = df[date_col].apply(plan_func)
    df["__plan_tmp"] = plan_values

    # Avoid division by zero
    with np.errstate(divide='ignore', invalid='ignore'):
        df[out_col] = np.abs(df[cost_col] - df["__plan_tmp"]) / df["__plan_tmp"]

    # FIX: Replaced inplace=True with direct assignment to avoid FutureWarning
    df[out_col] = df[out_col].replace([np.inf, -np.inf], 0)  # Replace inf with 0
    df[out_col] = df[out_col].fillna(0)

    del df["__plan_tmp"]
    return df


def compute_perf_vol(
        df: pd.DataFrame,
        score_col: str = "DailyScore",
        window: int = 7,
        out_col: str = "PerfVol",
) -> pd.DataFrame:
    """
    Calculates Performance-track Volatility using Z-Score and MAD on the DailyScore.
    This measures how much the daily performance deviates from its recent trend.
    使用Z-Score和MAD计算表现波动率。该指标衡量每日表现与其近期趋势的偏离程度。
    """
    series = df[score_col]

    # Calculate rolling median and rolling Median Absolute Deviation (MAD)
    median = series.rolling(window, min_periods=1).median()
    mad = series.rolling(window, min_periods=1).apply(median_absolute_deviation, raw=True)

    # Calculate robust Z-score, handling division by zero
    # The 0.6745 is a scaling factor to make MAD an unbiased estimator for the standard deviation
    with np.errstate(divide='ignore', invalid='ignore'):
        z_score = (series - median) / (mad / 0.6745)

    df[out_col] = np.abs(z_score)

    # FIX: Replaced inplace=True with direct assignment to avoid FutureWarning
    df[out_col] = df[out_col].replace([np.inf, -np.inf], 0)  # Replace inf with 0
    df[out_col] = df[out_col].fillna(0)

    return df


def compute_account_vol(
        df: pd.DataFrame,
        spend_col: str = "SpendVol",
        perf_col: str = "PerfVol",
        alpha: float = 0.5,
        beta: float = 0.5,
        out_col: str = "AccountVol",
) -> pd.DataFrame:
    """
    Calculates the final Composite Account Volatility.
    计算最终的账户综合波动率。
    AccountVol_t = α · SpendVol_t + β · PerfVol_t
    """
    if not np.isclose(alpha + beta, 1.0):
        raise ValueError("Weights alpha and beta must sum to 1.")
    df[out_col] = alpha * df[spend_col] + beta * df[perf_col]
    return df


# --- Main Execution Block ---
if __name__ == "__main__":
    # ---------- 1. Load & Clean Data (Your Method) ----------
    try:
        FILE = Path("Campaign performance (5).csv")
        RAW_SKIP = 2
        df = pd.read_csv(FILE, skiprows=RAW_SKIP)
    except FileNotFoundError:
        print(f"Error: The file '{FILE}' was not found. Please check the path.")
        exit()

    # Rename columns for easier access
    df.rename(columns={'Day': 'Date'}, inplace=True)

    # Robust numeric casting for key columns
    numeric_cols = {"Impr.": int, "Clicks": int, "Cost": float, "Conversions": float}
    for col, dtype in numeric_cols.items():
        df[col] = robust_numeric_parser(df[col], dtype)

    # Ensure date column is datetime
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    # ---------- 2. Calculate Daily Performance Score ----------
    # This single function replaces the complex, NaN-prone metric calculations
    df = calculate_daily_score(df, k_smooth=7)


    # ---------- 3. Calculate Volatility Components ----------
    # a) Spend-track Volatility
    def budget_plan_curve(ts: pd.Timestamp) -> float:
        """A sample budget plan: Linear taper from 200 to 50 over August."""
        if ts.month == 8:
            return max(50, 200 - (150 / 30) * (ts.day - 1))
        return 200.0


    df = compute_spend_vol(df, cost_col="Cost", date_col="Date", plan_func=budget_plan_curve)

    # b) Performance-track Volatility (on our robust DailyScore)
    df = compute_perf_vol(df, score_col="DailyScore", window=7)

    # ---------- 4. Calculate Composite Account Volatility ----------
    df = compute_account_vol(df, alpha=0.5, beta=0.5)

    # ---------- 5. Display Results ----------
    cols_to_show = ["Date", "Cost", "DailyScore", "SpendVol", "PerfVol", "AccountVol"]
    pd.set_option("display.float_format", "{:.4f}".format)
    print("\n=== Merged Volatility Dashboard ===")
    print(df[cols_to_show].tail(15).to_string(index=False))

    # ---------- 6. Plotting ----------
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 12), sharex=True)
    fig.suptitle('Account Volatility Dashboard (Merged Method)', fontsize=16)

    # Plot 1: Daily Performance Score
    ax1.plot(df["Date"], df["DailyScore"], label="DailyScore", color="#1f77b4", linewidth=2)
    ax1.set_ylabel("Daily Performance Score")
    ax1.set_title("Performance Score Trend")
    ax1.grid(True, linestyle="--", linewidth=0.5)
    ax1.legend()

    # Plot 2: Volatility Components
    ax2.plot(df["Date"], df["SpendVol"], label="SpendVol (vs. Plan)", color="#ff7f0e", linestyle="--")
    ax2.plot(df["Date"], df["PerfVol"], label="PerfVol (vs. Trend)", color="#2ca02c", linestyle="--")
    ax2.plot(df["Date"], df["AccountVol"], label="AccountVol (Composite)", color="#d62728", linewidth=2.5)
    ax2.axhline(y=0.20, color='grey', linestyle=':', label='20% Threshold')  # Your project threshold
    ax2.set_xlabel("Date")
    ax2.set_ylabel("Volatility (Unitless)")
    ax2.set_title("Volatility Analysis")
    ax2.grid(True, linestyle="--", linewidth=0.5)
    ax2.legend()

    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.show()
