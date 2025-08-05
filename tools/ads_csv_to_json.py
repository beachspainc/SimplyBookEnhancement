#!/usr/bin/env python3
"""
ads_csv_to_nested_json.py
-------------------------
Convert a Google Ads Editor export (UTF‑16LE, TAB) into an aggregated,
nested JSON structure:

account  -> campaigns -> ad_groups -> asset_groups
each node has four buckets: settings / ads / extensions / criteria

Spec: https://chat.openai.com/ (task summary v2)
"""

import csv
import glob
import json
import os
import re
import sys
from datetime import datetime
from typing import Dict, List

# ------------------------------- config ---------------------------------
CSV_PATTERN   = "Beach Spa Advertising+*.csv"
CSV_ENCODING  = "utf-16"
CSV_DELIMITER = "\t"
# ------------------------------------------------------------------------

# ---- bucket trigger columns --------------------------------------------
ADS_KEYS = {
    "Headline 1", "Headline 2", "Headline 3", "Headline 4", "Headline 5",
    "Headline 6", "Headline 7", "Headline 8", "Headline 9", "Headline 10",
    "Headline 11", "Headline 12", "Headline 13", "Headline 14", "Headline 15",
    "Description 1", "Description 2", "Description 3", "Description 4",
    "Image name", "Video ID 1", "Video ID 2", "Video ID 3", "Video ID 4",
    "Video ID 5", "Path 1", "Path 2"
}

EXT_KEYS = {
    "Link Text", "Callout text", "Snippet Values",
    "Percent discount", "Phone Number"
}

CRI_KEYS = {
    "Keyword", "Location", "Audience name", "Audience segment",
    "Ad Schedule", "Device", "Age", "Gender", "Household income", "Radius"
}

# ---- helper -------------------------------------------------------------
def latest_csv(pattern: str = CSV_PATTERN) -> str:
    """Return newest file path matching pattern in cwd."""
    files = glob.glob(pattern)
    if not files:
        raise FileNotFoundError(f"No CSV matching '{pattern}' found.")
    return max(files, key=os.path.getmtime)

def read_csv(path: str) -> List[Dict[str, str]]:
    """Read UTF‑16LE / TAB CSV and return list of row dicts (all columns kept)."""
    with open(path, encoding=CSV_ENCODING) as fh:
        rdr     = csv.reader(fh, delimiter=CSV_DELIMITER)
        header  = next(rdr)
        col_len = len(header)
        rows: List[Dict[str, str]] = []

        for line in rdr:
            if len(line) < col_len:
                line.extend([""] * (col_len - len(line)))
            rows.append({header[i]: line[i] for i in range(col_len)})
    return rows

def bucket_of(row: Dict[str, str]) -> str:
    """Return one of: ads / extensions / criteria / settings."""
    keys = {k for k, v in row.items() if v}
    if keys & ADS_KEYS:
        return "ads"
    if keys & EXT_KEYS:
        return "extensions"
    if keys & CRI_KEYS:
        return "criteria"
    return "settings"

def merge_settings(dest: Dict[str, str], src: Dict[str, str]) -> None:
    """Merge non‑empty values from src into dest (later rows override)."""
    for k, v in src.items():
        if v:
            dest[k] = v

def extract_export_date(filename: str) -> str:
    """Extract YYYY-MM-DD from file name, else today's date."""
    m = re.search(r"\d{4}-\d{2}-\d{2}", filename)
    return m.group(0) if m else datetime.today().strftime("%Y-%m-%d")

# ---- core builder -------------------------------------------------------
def build_tree(rows: List[Dict[str, str]], export_date: str) -> Dict:
    tree = {
        "account": {
            "customer_id": "",        # Editor CSV 不包含帐号 ID，留空
            "export_date": export_date
        },
        "campaigns": {}
    }

    for r in rows:
        campaign = r.get("Campaign", "").strip()
        if not campaign:            # skip rows without Campaign
            continue
        ad_group     = r.get("Ad Group", "").strip()
        asset_group  = r.get("Asset Group", "").strip()
        bucket_name  = bucket_of(r)

        camp_node = tree["campaigns"].setdefault(
            campaign,
            {"settings": {}, "ads": [], "extensions": [], "criteria": [],
             "ad_groups": {}}
        )

        # ------------- Campaign level -------------
        if not ad_group:
            if bucket_name == "settings":
                merge_settings(camp_node["settings"], r)
            else:
                camp_node[bucket_name].append(r)
            continue

        adg_node = camp_node["ad_groups"].setdefault(
            ad_group,
            {"settings": {}, "ads": [], "extensions": [], "criteria": [],
             "asset_groups": {}}
        )

        # ------------- Ad Group level -------------
        if not asset_group:
            if bucket_name == "settings":
                merge_settings(adg_node["settings"], r)
            else:
                adg_node[bucket_name].append(r)
            continue

        asset_node = adg_node["asset_groups"].setdefault(
            asset_group,
            {"settings": {}, "ads": [], "extensions": [], "criteria": []}
        )

        # ------------- Asset Group level -------------
        if bucket_name == "settings":
            merge_settings(asset_node["settings"], r)
        else:
            asset_node[bucket_name].append(r)

    return tree

# ---- main ---------------------------------------------------------------
def main():
    try:
        csv_path = latest_csv()
        print(f"▶ Loading: {csv_path}")
        rows      = read_csv(csv_path)
        exp_date  = extract_export_date(os.path.basename(csv_path))
        nested    = build_tree(rows, exp_date)

        out_path  = os.path.splitext(csv_path)[0] + "_nested.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(nested, fh, ensure_ascii=False, indent=2)
        print(f"✔ Exported → {out_path}")

    except Exception as exc:
        print(f"✘ {exc}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
