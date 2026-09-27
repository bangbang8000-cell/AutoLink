#!/usr/bin/env python3
"""AL CLI 契约守卫（check_cli_contract.py）—— 双端对齐版

背景与目的
----------
AL 的 CLI（`backend/cli.py`）注册表驱动、action 数持续增长，但**文档与代码长期漂移**：
`docs/cli.md` 曾声称「18 域 37 action」，实测 **24 域 67 action**，漏 40+ 条；
且**无守卫**，结构上必然再次漂移（真值在注册表，文档手工维护）。

本脚本把 AL 侧三件事钉成 CI 可执行的门禁（与 MC `check_cli_contract.py` 双端同构）：

  C1  退出码常量存在且取值符合契约（EXIT_OK/INTERNAL/USAGE/EXEC = 0/1/2/3）
  C2  无裸 `sys.exit(<数字>)`（必须用语义化常量；130 = SIGINT 惯例白名单）
  C3  `docs/cli.md` 域速查表的 action 数 ↔ 注册表对账（真值源 = 注册表）
  C4  三级子命令（`a:b:c`）在文档中可见（多级树契约，批次 B）

真值源
------
`backend/autolink_hub/agent/capabilities.py` 的 action 注册表（`list_registered_actions()`）。
文档不参与真值判定，只被校验 —— 「代码为唯一真值源」。

用法
----
    python scripts/check_cli_contract.py            # 校验（CI 用）
    python scripts/check_cli_contract.py --verbose  # 打印全部项

退出码：0 = 通过，1 = 有违例。
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
BACKEND = os.path.join(ROOT, 'backend')
CLI_PY = os.path.join(BACKEND, 'cli.py')
CLI_DOC = os.path.join(ROOT, 'docs', 'cli.md')

# C2 白名单：允许的裸数字退出码（键=数字，值=理由）
ALLOWED_RAW_EXITS = {
    130: 'SIGINT 惯例（128+2），Ctrl-C 中断',
}


class Violation:
    def __init__(self, check: str, line: int, message: str):
        self.check = check
        self.line = line
        self.message = message

    def __str__(self) -> str:
        loc = f'L{self.line}' if self.line else '-'
        return f'[{self.check}] {loc}: {self.message}'


def _read(path: str) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _registered_actions() -> list[str]:
    """从注册表读全部 action（子进程调用，隔离 import 副作用）。

    真值源 = `backend/engine.py` 的 `list_registered_actions()`
    （由 `@register_action("a:b")` 装饰器累积）。
    """
    code = (
        'import json;'
        'from engine import list_registered_actions;'
        'print(json.dumps(sorted(list_registered_actions())))'
    )
    r = subprocess.run([sys.executable, '-c', code], cwd=BACKEND,
                       capture_output=True, text=True)
    if r.returncode != 0:
        # 回退：正则抽取 @register_action("...") 调用
        src = _read(os.path.join(BACKEND, 'engine.py')) if os.path.exists(os.path.join(BACKEND, 'engine.py')) else ''
        return sorted(set(re.findall(r"register_action\(\s*['\"]([a-z_:]+)['\"]", src)))
    try:
        import json
        return json.loads(r.stdout.strip())
    except Exception:
        return []


# ---------------------------------------------------------------- C1
def check_exit_constants(src: str) -> list[Violation]:
    expected = {'EXIT_OK': 0, 'EXIT_INTERNAL': 1, 'EXIT_USAGE': 2, 'EXIT_EXEC': 3}
    out: list[Violation] = []
    for name, want in expected.items():
        m = re.search(rf'^{name}\s*=\s*(\d+)', src, re.MULTILINE)
        if not m:
            out.append(Violation('C1', 0, f'缺少退出码常量 {name}（契约要求 {want}）'))
            continue
        if int(m.group(1)) != want:
            line = src[:m.start()].count('\n') + 1
            out.append(Violation('C1', line, f'{name} = {m.group(1)}，契约要求 {want}'))
    return out


# ---------------------------------------------------------------- C2
def check_raw_exits(src: str) -> list[Violation]:
    out: list[Violation] = []
    for m in re.finditer(r'sys\.exit\(\s*(\d+)\s*\)', src):
        num = int(m.group(1))
        if num in ALLOWED_RAW_EXITS:
            continue
        line_start = src.rfind('\n', 0, m.start()) + 1
        raw_line = src[line_start:src.find('\n', m.start())]
        if raw_line.lstrip().startswith('#'):
            continue
        line = src[:m.start()].count('\n') + 1
        out.append(Violation('C2', line,
                             f'裸 sys.exit({num}) —— 请改用语义化常量（EXIT_OK/INTERNAL/USAGE/EXEC）'))
    return out


# ---------------------------------------------------------------- C3
def check_doc_action_table(doc_path: str, actions: list[str]) -> list[Violation]:
    """docs/cli.md 声明的域/action 数 ↔ 注册表对账。

    文档侧真值声明形如：「## 3. 域速查表（24 域 67 action，…）」。
    注册表实测 = len(actions) / 域数。任一不符即告警。
    """
    out: list[Violation] = []
    if not os.path.exists(doc_path):
        return out
    doc = _read(doc_path)
    real_domains = {a.split(':')[0] for a in actions}
    real_n, real_d = len(actions), len(real_domains)

    m = re.search(r'域速查表（\s*(\d+)\s*域\s*(\d+)\s*action', doc)
    if m:
        dn, da = int(m.group(1)), int(m.group(2))
        if dn != real_d or da != real_n:
            out.append(Violation('C3', 0,
                                 f'docs/cli.md 声称 {dn} 域 {da} action，注册表实测 {real_d} 域 {real_n} action'))
    else:
        out.append(Violation('C3', 0, 'docs/cli.md 缺少「域速查表（N 域 M action…）」声明行'))

    # 表中列出的每个 action 必须在注册表（防文档写不存在的命令）
    # 容忍：展示短名（output:*）、JSON 示例键（success:false 等 Python/JSON 布尔）
    skip = {'success', 'error', 'valid', 'ok', 'reused', 'true', 'false', 'a', 'x'}
    for a in set(re.findall(r'`([a-z_]+:[a-z_-]+(?::[a-z_-]+)?)`', doc)):
        head = a.split(':')[0]
        if head in skip:
            continue
        if a in actions or a.replace('_', ':') in actions:
            continue
        if any(x == head or x.startswith(head + ':') for x in actions):
            continue  # 域内展示短名（如 output:*）
        out.append(Violation('C3', 0, f'docs/cli.md 列出未注册 action: {a}'))
    return out


# ---------------------------------------------------------------- C4
def check_multi_level_visible(actions: list[str], doc_path: str) -> list[Violation]:
    """三级 action（`a:b:c`）必须在文档中体现为多级命令形态。"""
    out: list[Violation] = []
    if not os.path.exists(doc_path):
        return out
    doc = _read(doc_path)
    tri = [a for a in actions if a.count(':') == 2]
    for a in tri:
        parts = [p.replace('_', '-') for p in a.split(':')]
        # 文档须出现 `a b c` 或 `a b` 组（如 `aidc project create` / `aidc project`）
        if f'{parts[0]} {parts[1]}' not in doc:
            out.append(Violation('C4', 0,
                                 f'三级 action {a} 未在 docs/cli.md 中体现多级命令（{parts[0]} {parts[1]} …）'))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description='AL CLI 契约守卫')
    ap.add_argument('--verbose', '-V', action='store_true', help='打印全部检查项')
    args = ap.parse_args()

    if not os.path.exists(CLI_PY):
        print(f'错误: 未找到 {CLI_PY}', file=sys.stderr)
        return 1

    src = _read(CLI_PY)
    actions = _registered_actions()
    violations: list[Violation] = []
    checks = [
        ('C1 退出码常量', lambda: check_exit_constants(src)),
        ('C2 无裸 sys.exit(数字)', lambda: check_raw_exits(src)),
        ('C3 文档 action 表对账', lambda: check_doc_action_table(CLI_DOC, actions)),
        ('C4 三级命令文档可见', lambda: check_multi_level_visible(actions, CLI_DOC)),
    ]
    for name, fn in checks:
        found = fn()
        violations.extend(found)
        if args.verbose:
            print(f'  {"FAIL" if found else "ok":4s}  {name}')

    if violations:
        print(f'\nAL CLI 契约守卫：发现 {len(violations)} 项违例\n')
        for v in violations:
            print(f'  {v}')
        print()
        return 1

    print(f'AL CLI 契约守卫：✅ 通过（C1-C4 全部符合；注册表 {len(set(a.split(":")[0] for a in actions))} 域 '
          f'{len(actions)} action）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
