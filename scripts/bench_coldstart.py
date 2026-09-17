#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""5.2.2 · 冷启动计时基线（AL T2.9 / `DP-AL-05`）

决策 `DP-AL-05` 定稿为「**仅显著改善**」（未承诺 ≥50%），因此本脚本的产出
是**可复现的量化基线**，供人工在 3 个工作日内固化为数值目标（PF-04 才能判定）。

测量项（每项均为**独立子进程**，避免互相污染）：
  1. `import engine`                    —— 引擎模块导入（重依赖下沉效果）
  2. `import autolink_hub.agent.tools`  —— Agent 工具模块导入（惰性依赖效果）
  3. 首个轻量 action 端到端             —— `config list-schema`（经 cli.execute）

用法：
    python scripts/bench_coldstart.py                 # 3 轮，打印中位数
    python scripts/bench_coldstart.py --rounds 5
    python scripts/bench_coldstart.py --json reports/coldstart.json

退出码：0 成功；环境缺依赖时该项记为 error 但不失败（基线仍可记录）。
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, 'backend')

PROBES = [
    ('import_engine', 'import time.perf_counter as t0; import engine', None),
    ('import_agent_tools',
     'import time; from autolink_hub.agent import tools; tools.init_tools()', None),
    ('first_action_config_list_schema', None, ['config:list-schema']),
]


def _time_import(stmt: str, rounds: int):
    """在独立子进程里测量 import 耗时（秒）"""
    samples = []
    code = f"import time;_s=time.perf_counter();{stmt};print(time.perf_counter()-_s)"
    for _ in range(rounds):
        t0 = time.perf_counter()
        p = subprocess.run([sys.executable, '-c', code], cwd=BACKEND,
                           capture_output=True, text=True, encoding='utf-8', errors='ignore')
        if p.returncode != 0:
            return None, (p.stderr or '').strip().splitlines()[-1:] or ['unknown error']
        try:
            samples.append(float(p.stdout.strip().splitlines()[-1]))
        except (ValueError, IndexError):
            return None, ['parse error']
        samples[-1] = time.perf_counter() - t0  # 含进程启动开销（真实冷启动体感）
    return statistics.median(samples), None


def _time_action(action: str, rounds: int):
    """在独立子进程里测量首个 action 端到端耗时（秒）"""
    samples = []
    code = (
        "import time,sys,json;sys.path.insert(0,'.');"
        "from cli import execute;"
        "_s=time.perf_counter();execute(%r,{},[]);print(time.perf_counter()-_s)" % action
    )
    for _ in range(rounds):
        t0 = time.perf_counter()
        p = subprocess.run([sys.executable, '-c', code], cwd=BACKEND,
                           capture_output=True, text=True, encoding='utf-8', errors='ignore')
        if p.returncode != 0:
            return None, (p.stderr or '').strip().splitlines()[-1:] or ['unknown error']
        try:
            float(p.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return None, ['parse error']
        samples.append(time.perf_counter() - t0)
    return statistics.median(samples), None


def main():
    ap = argparse.ArgumentParser(description='测量 AutoLink 冷启动耗时基线')
    ap.add_argument('--rounds', type=int, default=3, help='每项测量轮数（取中位数）')
    ap.add_argument('--json', dest='json_out', default=None, help='结果写入 JSON 文件')
    args = ap.parse_args()

    result: dict = {'rounds': args.rounds, 'items': {}}
    for name, stmt, action in PROBES:
        if stmt:
            sec, err = _time_import(stmt, args.rounds)
        else:
            sec, err = _time_action(action[0], args.rounds)
        result['items'][name] = {'seconds': None if sec is None else round(sec, 4),
                                 'error': err}
        if sec is None:
            print(f'{name:36s} ERROR  {err}')
        else:
            print(f'{name:36s} {sec:7.3f}s')

    total = sum(v['seconds'] for v in result['items'].values() if v['seconds'])
    result['total_seconds'] = round(total, 4)
    print(f"{'TOTAL':36s} {total:7.3f}s")

    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
        with open(args.json_out, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'\nwritten -> {args.json_out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
