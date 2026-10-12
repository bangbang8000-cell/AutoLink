"""5.4.16-F5416-6：硬编码中文扫描门禁（防回归）。

- 扫描 src 下非 i18n/非 test 的 .ts/.tsx：找出"疑似界面文案"的未国际化中文行
- 基线（tests/hardcoded_cn_baseline.json）记录当前允许存在的硬编码中文文件
- 门禁：新增文件出现硬编码中文（不在基线）→ 退出码 1（防 UI 文案绕过 t()）
- --update-baseline：把当前硬编码中文文件集写入基线（迁移域数据目录时主动授权）

用法（仓库根目录）：
  python scripts/scan_hardcoded_cn.py                # 门禁校验（CI 用）
  python scripts/scan_hardcoded_cn.py --list         # 列出当前硬编码中文文件
  python scripts/scan_hardcoded_cn.py --update-baseline  # 更新基线
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(REPO, "tests", "hardcoded_cn_baseline.json")
EXCLUDE_DIRS = {"i18n", "test", "tests", "__pycache__", "node_modules", "dist", "dist-electron", ".git", "assets"}
EXCLUDE_EXT = (".json", ".css", ".md")
CJK = re.compile(r"[\u4e00-\u9fff]")
# 行内出现这些即视为已国际化（t() / useTranslation / i18n）
OK_TOKENS = ("useTranslation", "t(", "i18n", "t`", "useTrans", "Trans")


def scan_files(repo: str) -> dict[str, int]:
    """返回 {相对路径: 疑似硬编码中文行数}。"""
    hits: dict[str, int] = {}
    for root, dirs, files in os.walk(os.path.join(repo, "src")):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fn in files:
            if not fn.endswith((".tsx", ".ts")) or fn.endswith(EXCLUDE_EXT):
                continue
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, repo)
            try:
                text = open(p, encoding="utf-8").read()
            except Exception:
                continue
            count = 0
            for ln in text.splitlines():
                if not CJK.search(ln):
                    continue
                s = ln.strip()
                if s.startswith(("//", "*", "/*")):
                    continue
                if any(tok in ln for tok in OK_TOKENS):
                    continue
                if '"' in ln or "'" in ln or "`" in ln or ">" in ln:
                    count += 1
            if count:
                hits[rel] = count
    return hits


def load_baseline() -> set[str]:
    try:
        with open(BASELINE, encoding="utf-8") as f:
            return set(json.load(f).get("files", []))
    except (OSError, ValueError):
        return set()


def save_baseline(files: set[str]) -> None:
    os.makedirs(os.path.dirname(BASELINE), exist_ok=True)
    with open(BASELINE, "w", encoding="utf-8") as f:
        json.dump({"schema": "autolink.quality.hardcoded-cn/1", "files": sorted(files)}, f, ensure_ascii=False, indent=2)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="MC 硬编码中文扫描门禁")
    parser.add_argument("--list", action="store_true", help="列出当前硬编码中文文件")
    parser.add_argument("--update-baseline", action="store_true", help="把当前文件集写入基线")
    args = parser.parse_args(argv)

    current = scan_files(REPO)
    if args.list:
        for rel, c in sorted(current.items()):
            print(f"  {c:4d}  {rel}")
        print(f"共 {len(current)} 个文件")
        return 0

    if args.update_baseline:
        save_baseline(set(current))
        print(f"基线已更新：{len(current)} 个文件")
        return 0

    baseline = load_baseline()
    new_files = sorted(set(current) - baseline)
    if new_files:
        print("FAIL：以下新增文件出现未国际化中文（应使用 t() 或更新基线）：")
        for rel in new_files:
            print(f"  - {rel}")
        return 1
    print(f"PASS：硬编码中文未扩散（基线 {len(baseline)} 个文件，当前 {len(current)} 个文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
