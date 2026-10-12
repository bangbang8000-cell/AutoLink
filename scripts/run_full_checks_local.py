"""5.4.13-F54-13-2：AutoLink 本地全量检查脚本（万卡样本本地重跑 = 发布硬前置）。

CI 的 env-limited 步骤（validate_templates / golden / bench，受 GitHub 运行环境
资源限制而 continue-on-error）在本地全量运行作为**硬门禁**——发布前必须本地全绿。

用法（仓库根目录）：
  python scripts/run_full_checks_local.py            # 顺序跑全部步骤，任一失败退出码 1
  python scripts/run_full_checks_local.py --dry-run  # 仅打印执行计划（供测试/人工核对）
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

Step = Tuple[str, List[str], Optional[str]]


@dataclass
class StepResult:
    name: str
    ok: bool
    duration_s: float
    output_tail: str


def steps() -> List[Step]:
    """执行计划（与 CI 一致，便于对比；顺序即门禁顺序）。"""
    py = [sys.executable]
    return [
        ("typecheck", ["npm", "run", "typecheck"], None),
        ("lint", ["npm", "run", "lint"], None),
        ("前端单测+覆盖率", ["npm", "run", "test:report"], None),
        ("build:renderer", ["npm", "run", "build:renderer"], None),
        ("build:electron", ["npm", "run", "build:electron"], None),
        ("模板校验", py + ["scripts/validate_templates.py"], None),
        ("设备库校验", py + ["scripts/validate_device_library.py"], None),
        ("文档数字一致性", py + ["scripts/check_doc_numbers.py"], None),
        ("CLI 契约守卫", py + ["scripts/check_cli_contract.py"], None),
        ("Agent skills 引用一致性", py + ["scripts/check_skill_refs.py"], None),
        ("golden 基线比对", py + ["scripts/gen_golden.py", "--check"], None),
        ("后端 pytest", py + ["-m", "pytest", "tests/backend", "-q", "--ignore=tests/backend/test_sample_assets.py", "--timeout=180"], None),
        ("示例资产 pytest", py + ["-m", "pytest", "tests/backend/test_sample_assets.py", "-q", "--no-cov", "--timeout=300"], None),
        ("性能门禁", py + ["scripts/bench_perf.py", "--rounds", "1"], None),
        ("版本一致性", py + ["scripts/check_version.py"], None),
    ]


def _run_step(step: Step) -> StepResult:
    name, cmd, cwd_rel = step
    cwd = os.path.join(REPO, cwd_rel) if cwd_rel else REPO
    start = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5400,
        )
        ok = proc.returncode == 0
        tail = (proc.stdout or "")[-1200:].strip() if not ok else ""
    except subprocess.TimeoutExpired:
        ok = False
        tail = "TIMEOUT (>5400s)"
    except FileNotFoundError as exc:
        ok = False
        tail = f"命令不存在: {exc}"
    return StepResult(name, ok, round(time.monotonic() - start, 1), tail)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="AL 本地全量检查（万卡样本本地硬门禁）")
    parser.add_argument("--dry-run", action="store_true", help="仅打印执行计划")
    parser.add_argument("--step", help="只运行指定步骤名（子串匹配）")
    args = parser.parse_args(argv)

    plan = steps()
    if args.step:
        plan = [s for s in plan if args.step in s[0]]
        if not plan:
            print(f"未找到匹配步骤: {args.step}")
            return 2

    if args.dry_run:
        for i, (name, cmd, _cwd) in enumerate(plan, 1):
            print(f"{i:2d}. {name}: {' '.join(cmd)}")
        print(f"共 {len(plan)} 步")
        return 0

    print(f"== AL 本地全量检查（{len(plan)} 步）==")
    results: List[StepResult] = []
    for name, cmd, _cwd in plan:
        print(f"[运行] {name}: {' '.join(cmd)}", flush=True)
        r = _run_step((name, cmd, _cwd))
        results.append(r)
        print(f"  -> {'PASS' if r.ok else 'FAIL'} ({r.duration_s}s)")
        if not r.ok and r.output_tail:
            for ln in r.output_tail.splitlines()[-6:]:
                print(f"       | {ln}")

    print("\n== 汇总 ==")
    failed = [r for r in results if not r.ok]
    for r in results:
        print(f"  [{'PASS' if r.ok else 'FAIL'}] {r.name} ({r.duration_s}s)")
    print(f"\n共 {len(results)} 步：PASS {len(results) - len(failed)} / FAIL {len(failed)}")
    if failed:
        print("发布被阻断：请在本地修复以下步骤后再发布。")
        return 1
    print("本地全量检查全部通过 —— 满足发布硬前置。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
