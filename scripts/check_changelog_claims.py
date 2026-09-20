#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""V5.3.0-530-g10（AL-G10）· CHANGELOG 里程碑宣称 ↔ 代码存在性门禁

背景（教训来自 5.2.2）：
  AL 5.2.2 的 CHANGELOG `522-M3` 宣称交付了 `doctor` / 重依赖下沉 /
  `pod_sizing` / `param_counts`，**实际全仓 0 命中**；开发计划点名的缺陷行
  `engine.py:44`、`exporter.py:9-12`（模块级 pandas/openpyxl）**一字未改**。
  对照组 MC 已实现 `backend/_deps.py`（含 `check_dependencies`）。
  ⇒ 「CHANGELOG 说做了」不等于「代码里真有」。本脚本把该判据**自动化**。

做法：
  CHANGELOG 中以反引号包裹的**代码标识符**（如 `_build_port_conservation`、
  `scripts/check_changelog_claims.py`、`biz_agg_chassis_spec`）即「宣称」。
  对这些标识符做**全仓文本搜索**（排除 CHANGELOG 自身与文档目录），
  若**零命中** ⇒ 宣称无代码支撑 ⇒ 失败。

白名单：
  有些宣称是「移除/删除/废弃」性质（如 `` 移除 `legacy_xxx` ``），标识符本就
  应当不存在。这类行通过 `--allow-absent` 或脚本内置 RETIRED_MARKERS 识别
  （行内含 移除/删除/废弃/下线/deprecated/removed 等词）后跳过。

用法：
    python scripts/check_changelog_claims.py              # 校验**最新版本段**（CI 默认）
    python scripts/check_changelog_claims.py --all        # 校验全部历史段（含既有漂移，会红）
    python scripts/check_changelog_claims.py --print      # 只列宣称与命中数
    python scripts/check_changelog_claims.py --version 5.2.5   # 只查某版本段

为何 CI 只查最新段：
  历史段（2.x 时代）存在大量命名迁移（文件改名/目录重组），全量校验必然红灯，
  且**修不回**。门禁的价值在「本次发布不许虚报」—— 故默认只钉最新版本段。

退出码：0 通过 / 1 发现无支撑宣称 / 2 脚本自身错误（CHANGELOG 缺失等）
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANGELOG = os.path.join(ROOT, 'CHANGELOG.md')

# 搜索范围：代码与脚本本体（**不含**文档，否则文档自证）
SEARCH_DIRS = ['backend', 'scripts', 'src', 'tests', 'electron']
SEARCH_FILES = ['package.json', 'vite.config.ts']

# 可搜索的文件类型（含 .css —— 如 prefers-reduced-motion 只存在于样式表）
EXT_ALLOW = ('.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
             '.json', '.yml', '.yaml', '.css', '.scss')

# 「移除类」措辞 —— 命中则跳过该行的标识符宣称
RETIRED_MARKERS = ('移除', '删除', '废弃', '下线', '去掉', '不再',
                   'deprecated', 'removed', 'drop ', 'revert')

# 已知误报豁免（纯表述、非可搜索标识符）
IGNORE_IDENTS = {
    'P0', 'P1', 'P2', 'R0', 'R1', 'R2', 'L1', 'L2', 'L3', 'T1', 'T2',
    'ERROR', 'WARNING', 'INFO', 'True', 'False', 'None', 'GET', 'POST',
    'main', 'dev', 'true', 'false', 'null',
    'schema_version', 'reportData', 'legacy_data',
}

# 标准库 / 第三方限定名豁免（如 zipfile._read1）—— 不在本仓，搜不到属正常
STDLIB_MODULES = {
    'zipfile', 'os', 'sys', 're', 'io', 'json', 'math', 'time', 'shutil',
    'tempfile', 'subprocess', 'hashlib', 'argparse', 'pathlib', 'typing',
    'collections', 'itertools', 'functools', 'datetime', 'logging', 'threading',
    'openpyxl', 'pandas', 'numpy', 'yaml', 'pytest', 'asyncio', 'sqlite3',
}

# 行内联豁免标记：<!-- claims-ignore -->
IGNORE_MARK = 'claims-ignore'

# 反引号内的标识符：字母/下划线开头，允许 . / - 与数字，长度 ≥ 4
IDENT_RE = re.compile(r'`([A-Za-z_][A-Za-z0-9_.\-/]{3,60})`')
# 版本段落标题：## [x.y.z] - date
VERSION_RE = re.compile(r'^##\s*\[([0-9]+\.[0-9]+\.[0-9]+)\]')


def _iter_source_files():
    for d in SEARCH_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames
                           if x not in ('node_modules', '__pycache__', '.git', 'dist', 'dist-electron')]
            for fn in filenames:
                if fn.endswith(EXT_ALLOW):
                    yield os.path.join(dirpath, fn)
    # docs/ 与 .github/workflows/：仅用于**文件名存在性**（内容不参与标识符匹配，
    # 否则文档自证）。此处把文件名登记进 names 即可，由 load_corpus 收集。
    for d in ('docs', '.github/workflows'):
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            for fn in filenames:
                yield os.path.join(dirpath, fn)
    for fn in SEARCH_FILES:
        p = os.path.join(ROOT, fn)
        if os.path.isfile(p):
            yield p


def _read(path):
    try:
        with io.open(path, encoding='utf-8', errors='ignore') as f:
            return f.read()
    except OSError:
        return ''


# 仅登记文件名、不读内容的目录（避免文档自证）
NAME_ONLY_DIRS = ('docs', '.github/workflows')


def load_corpus():
    """(内容大文本, 全量文件名集合)。

    内容用于匹配标识符；文件名用于匹配「新建 xxx.tsx / yyy.json」这类**以文件名出现**的宣称
    （这些文件在别处 import，正文里不一定复现全名，但文件名本身就是证据）。
    注意：docs/ 与 .github/workflows/ 只贡献**文件名**，其正文不参与匹配 —— 否则
    CHANGELOG 宣称某文档存在时，该文档正文会「自证」，门禁失去意义。
    """
    chunks, names = [], set()
    for p in _iter_source_files():
        names.add(os.path.basename(p))
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        top = rel.split('/', 1)[0]
        if top in NAME_ONLY_DIRS or rel.startswith('.github/'):
            continue          # 只登记文件名
        chunks.append(_read(p))
    return '\n'.join(chunks), names


def parse_claims(version=None):
    """返回 [(version, lineno, ident, line_text), ...]"""
    text = _read(CHANGELOG)
    if not text:
        print('ERROR: 无法读取 CHANGELOG.md', file=sys.stderr)
        sys.exit(2)
    claims = []
    cur = None
    for i, line in enumerate(text.splitlines(), 1):
        m = VERSION_RE.match(line.strip())
        if m:
            cur = m.group(1)
            continue
        if version and cur != version:
            continue
        if any(mk in line for mk in RETIRED_MARKERS):
            continue          # 移除类措辞，标识符本就应不存在
        if IGNORE_MARK in line:
            continue          # 行内显式豁免
        for ident in IDENT_RE.findall(line):
            if ident in IGNORE_IDENTS:
                continue
            head = ident.split('.', 1)[0]
            if head in STDLIB_MODULES:
                continue      # 标准库/三方限定名，不在本仓
            if '..' in ident:
                continue      # 范围记法（如 CAT5..CAT7 / A1..A5），非符号
            claims.append((cur, i, ident, line.strip()))
    return claims


def latest_version():
    """CHANGELOG 中第一个版本段 = 最新版本。"""
    text = _read(CHANGELOG)
    for line in text.splitlines():
        m = VERSION_RE.match(line.strip())
        if m:
            return m.group(1)
    return None


def main():
    ap = argparse.ArgumentParser(description='CHANGELOG 里程碑宣称 ↔ 代码存在性门禁')
    ap.add_argument('--print', action='store_true', help='只列宣称与命中数，不判定')
    ap.add_argument('--version', default=None, help='只校验指定版本段，如 5.3.0')
    ap.add_argument('--all', action='store_true',
                    help='校验全部历史版本段（含既有漂移，通常不用于 CI）')
    args = ap.parse_args()

    target = args.version
    if target is None and not args.all:
        target = latest_version()
        if target is None:
            print('ERROR: 无法从 CHANGELOG 解析最新版本段', file=sys.stderr)
            return 2
        print(f'（门禁范围：最新版本段 {target}；如需全量用 --all）')

    corpus, filenames = load_corpus()
    claims = parse_claims(target)
    if not claims:
        print(f'OK: 未发现可校验的代码宣称（version={target or "全部"}）')
        return 0

    unbacked = []
    for ver, lineno, ident, line in claims:
        hits = corpus.count(ident)
        if hits == 0:
            # 依次尝试：路径末段 → 文件名集合 → 逐级去掉模块前缀
            tail = ident.rsplit('/', 1)[-1]
            if tail != ident:
                hits = corpus.count(tail)
            if hits == 0 and tail in filenames:
                hits = 1
            if hits == 0 and ident in filenames:
                hits = 1
            if hits == 0:
                # 限定名（如 designer._calc_biz_chassis_frames / biz_info.dropped_links）：
                # 取最后一个 `.` 之后的成员名，只要该成员在某处出现即可视为有支撑。
                member = ident.split('.')[-1]
                if len(member) >= 4:
                    hits = corpus.count(member)
        if args.print:
            flag = 'OK  ' if hits else 'MISS'
            print(f'  [{flag}] {ver or "?"} L{lineno}: `{ident}` → 命中 {hits}')
        if hits == 0:
            unbacked.append((ver, lineno, ident, line))

    if args.print:
        print(f'\n共 {len(claims)} 处宣称，{len(unbacked)} 处无代码支撑')
        return 0

    if unbacked:
        print('FAIL: 以下 CHANGELOG 宣称在全仓源码中**零命中**（AL-G10）：\n',
              file=sys.stderr)
        for ver, lineno, ident, line in unbacked:
            print(f'  {ver or "?"} L{lineno}: `{ident}`', file=sys.stderr)
            print(f'      {line[:120]}', file=sys.stderr)
        print('\n处理方式（三选一）：\n'
              '  1. 补上代码实现（若确实应交付）；\n'
              '  2. 从 CHANGELOG 删除该宣称（若本就不在本版范围）；\n'
              '  3. 若属"移除类"表述，在同行写明 移除/删除/废弃 等词即可豁免。',
              file=sys.stderr)
        return 1

    print(f'OK: {len(claims)} 处代码宣称均有源码支撑（AL-G10）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
