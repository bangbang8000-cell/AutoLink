#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""5.2.2 · 文档数字自动校验（AL T4.2）

背景：README / docs 中长期存在**同一事实多个数字**的漂移
（设备库 120/126/128/129 并存、模板 23/25/26 并存、校验规则 22 条但 V021 缺号）。
人工维护必然再次漂移 → 改为**以代码为唯一真值源**，CI 反向校验文档。

真值来源（全部读自仓库本身，不硬编码期望值）：
  - 设备库：`template/device_library/library_index.json` 的 `categories[*].device_ids`
  - 场景模板：`template/` 下的目录数（排除 `device_library`）
  - 校验规则：`backend/validation*.py` 中出现的 `V0xx` 规则编号集合
  - 退出码契约：`backend/cli.py` 的 `EXIT_*` 常量

校验对象：README.md / CHANGELOG.md / docs/cli.md 中的对应表述。

用法：
    python scripts/check_doc_numbers.py            # 校验，失败则 exit 1
    python scripts/check_doc_numbers.py --print    # 只打印真值，不校验

退出码：0 通过 / 1 发现漂移 / 2 真值源缺失（脚本自身错误）
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(ROOT, 'template')
LIB_INDEX = os.path.join(TEMPLATE_DIR, 'device_library', 'library_index.json')
BACKEND = os.path.join(ROOT, 'backend')
DOCS = [
    os.path.join(ROOT, 'README.md'),
    os.path.join(ROOT, 'CHANGELOG.md'),
    os.path.join(ROOT, 'docs', 'cli.md'),
]


def real_device_counts():
    """(total, hardware, optical)"""
    with io.open(LIB_INDEX, encoding='utf-8') as f:
        data = json.load(f)
    cats = data.get('categories') or []
    total = sum(len(c.get('device_ids') or []) for c in cats)
    optical = sum(len(c.get('device_ids') or [])
                  for c in cats if c.get('id') == 'optical_modules' or c.get('name') == '光模块')
    return total, total - optical, optical


def real_template_count():
    if not os.path.isdir(TEMPLATE_DIR):
        return None
    return len([d for d in os.listdir(TEMPLATE_DIR)
                if os.path.isdir(os.path.join(TEMPLATE_DIR, d)) and d != 'device_library'])


def real_rule_ids():
    ids = set()
    if not os.path.isdir(BACKEND):
        return ids
    for name in os.listdir(BACKEND):
        if name.startswith('validation') and name.endswith('.py'):
            with io.open(os.path.join(BACKEND, name), encoding='utf-8', errors='ignore') as f:
                ids.update(re.findall(r'\bV(\d{3})\b', f.read()))
    return {'V%s' % i for i in ids}


def real_exit_codes():
    """返回 cli.py 中定义的退出码常量 {name: value}"""
    path = os.path.join(BACKEND, 'cli.py')
    out = {}
    if not os.path.exists(path):
        return out
    with io.open(path, encoding='utf-8', errors='ignore') as f:
        for m in re.finditer(r'^(EXIT_\w+)\s*=\s*(\d+)', f.read(), re.M):
            out[m.group(1)] = int(m.group(2))
    return out


def _read(path):
    """读取待校验文本。

    CHANGELOG 只校验**最新版本章节**：历史版本里的数字是当时的真值，
    拿今天的真值去比对历史条目会产生大量误报。
    """
    if not os.path.exists(path):
        return ''
    with io.open(path, encoding='utf-8', errors='ignore') as f:
        text = f.read()
    if os.path.basename(path).lower() == 'changelog.md':
        marks = list(re.finditer(r'(?m)^## \[', text))
        if len(marks) >= 2:
            text = text[:marks[1].start()]
    return text


def check():
    total, hw, optical = real_device_counts()
    templates = real_template_count()
    rule_ids = real_rule_ids()
    rule_n = len(rule_ids)
    missing = sorted('V%03d' % i for i in range(1, max(int(r[1:]) for r in rule_ids) + 1)
                     if 'V%03d' % i not in rule_ids) if rule_ids else []

    problems = []

    # 1) 设备库总数：文档不得出现 != total 的“设备库 N 款”表述
    for doc in DOCS:
        text = _read(doc)
        if not text:
            continue
        rel = os.path.relpath(doc, ROOT)
        for m in re.finditer(r'(\d{2,4})\s*款(?:主流)?设备库', text):
            if int(m.group(1)) != total:
                problems.append(f'{rel}: 设备库数量写 {m.group(1)}，真值 {total}（{hw} 硬件 + {optical} 光模块）')
        # 2) 模板套数
        if templates is not None:
            for m in re.finditer(r'(\d{2,3})\s*套(?:场景)?模板', text):
                if int(m.group(1)) != templates:
                    problems.append(f'{rel}: 模板数量写 {m.group(1)}，真值 {templates} 套')
        # 3) 校验规则条数
        for m in re.finditer(r'(\d{2,3})\s*条校验规则', text):
            if int(m.group(1)) != rule_n:
                problems.append(f'{rel}: 校验规则写 {m.group(1)} 条，真值 {rule_n} 条'
                                + (f'（缺号 {",".join(missing)}）' if missing else ''))

    # 4) 退出码契约：docs/cli.md 必须给出 0/1/2/3
    codes = real_exit_codes()
    if codes:
        cli_doc = os.path.join(ROOT, 'docs', 'cli.md')
        text = _read(cli_doc)
        for name, val in sorted(codes.items(), key=lambda kv: kv[1]):
            if str(val) not in text:
                problems.append(f'docs/cli.md: 缺少退出码 {val}（{name}）的说明')

    return {
        'devices': {'total': total, 'hardware': hw, 'optical': optical},
        'templates': templates,
        'rules': {'count': rule_n, 'ids': sorted(rule_ids), 'missing': missing},
        'exit_codes': codes,
    }, problems


def main():
    ap = argparse.ArgumentParser(description='校验文档中的设备/模板/规则数量是否与代码一致')
    ap.add_argument('--print', dest='do_print', action='store_true',
                    help='只打印真值，不做校验')
    args = ap.parse_args()

    try:
        truth, problems = check()
    except FileNotFoundError as e:
        print(f'[check-doc-numbers] 真值源缺失: {e}', file=sys.stderr)
        return 2

    if args.do_print:
        print(json.dumps(truth, ensure_ascii=False, indent=2))
        return 0

    print('[check-doc-numbers] 真值: 设备库 %d（%d 硬件 + %d 光模块）| 模板 %s 套 | 规则 %d 条%s'
          % (truth['devices']['total'], truth['devices']['hardware'], truth['devices']['optical'],
             truth['templates'], truth['rules']['count'],
             '（缺号 %s）' % ','.join(truth['rules']['missing']) if truth['rules']['missing'] else ''))
    if problems:
        print('\n[check-doc-numbers] 发现 %d 处文档漂移:' % len(problems), file=sys.stderr)
        for p in problems:
            print('  - ' + p, file=sys.stderr)
        return 1
    print('[check-doc-numbers] OK：文档数字与代码一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
