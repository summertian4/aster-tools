import csv
import sys
from pathlib import Path
from typing import Dict, List

FIELDS = ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"]
FIELD_LABELS = {
    "REALIZED_PNL": "实现盈亏",
    "COMMISSION": "手续费",
    "FUNDING_FEE": "资金费",
    "NET": "净额",
}
COMBINED_LABELS = {
    "REALIZED_PNL": "合计盈亏",
    "COMMISSION": "合计手续费",
    "FUNDING_FEE": "合计资金费",
    "NET": "总净额",
}


def parse_amount(raw: str) -> float:
    return float(raw.split()[0])


def process_file(path: Path) -> Dict[str, float]:
    totals = {field: 0.0 for field in FIELDS}
    totals["NET"] = 0.0

    with path.open(newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            amount = parse_amount(row["Amount"])
            row_type = row["Type"]
            if row_type in totals:
                totals[row_type] += amount
                totals["NET"] += amount
    return totals


def format_report(name: str, totals: Dict[str, float]) -> str:
    lines = [f"{name}"]
    for field in FIELDS:
        label = FIELD_LABELS[field]
        lines.append(f"  {label:<10}: {totals[field]:>15.8f}")
    lines.append(f"  {FIELD_LABELS['NET']:<10}: {totals['NET']:>15.8f}")
    return "\n".join(lines)


def aggregate(totals_list: List[Dict[str, float]]) -> Dict[str, float]:
    agg = {field: 0.0 for field in FIELDS}
    agg["NET"] = 0.0
    for totals in totals_list:
        for field in agg:
            agg[field] += totals[field]
    return agg


def main(paths: List[str]) -> None:
    if not paths:
        print("Usage: python analyze_transactions.py <csv1> <csv2> ...")
        sys.exit(1)

    totals_list = []
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            print(f"File not found: {path}")
            continue
        totals = process_file(path)
        totals_list.append(totals)
        print(format_report(path.name, totals))
        print()

    if totals_list:
        agg = aggregate(totals_list)
        print("合计结果")
        for field in FIELDS:
            label = COMBINED_LABELS[field]
            print(f"  {label:<10}: {agg[field]:>15.8f}")
        print(f"  {COMBINED_LABELS['NET']:<10}: {agg['NET']:>15.8f}")


if __name__ == "__main__":
    main(sys.argv[1:])
