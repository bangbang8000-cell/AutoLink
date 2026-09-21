#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""V5.3.3-T7.0（AL-G14）· 双路径初始化对称性 AST 探针

背景（血训三连，详见 5.3.0 开发计划附录 B/C 与 CHANGELOG）：
  - 5.3.0：三项「数值口径」开关只在 JSON 路径（_init_from_project_config）赋值，
    INI 路径（_load_common_ini_config / _load_common_config）下这些属性**根本不存在**；
    当时因「只赋值、无人读」未暴露。
  - 5.3.1：修了前三项，却漏掉第 4 项 _biz_frames_map_explicit —— CI 的
    validate_templates.py（跑 INI 模板）当场全红，本地「门禁四连 + 单测」全绿没逮到。
  - 5.3.2：把全部口径开关收进唯一初始化入口 _init_biz_caliber_switches，并加枚举守卫
    TestCaliberSwitchCoverage531D（运行时 hasattr 检查）。

运行时守卫（hasattr）只能逮「属性缺失」那一刻；本探针用 AST 做**静态**检查，
在合入前就把「散落赋值 / 单路径接线 / 无默认值」三类漂移源揪出来：
  A. 调用点覆盖 —— JSON 路径与 INI 路径**都必须**调用唯一入口；
  B. 散落赋值 —— 口径开关键（entry 内 get 的键）的 self.<key> = 赋值只允许发生在
     entry 内；散落在任意其他方法（尤其两条初始化路径）即违规；
  C. 默认值 —— entry 内每个 get(KEY, ...) 都必须带默认值（配置缺失也给出合法值，
     否则重演 AttributeError）。

用法：
    python scripts/check_dual_path_symmetry.py                            # 默认检查 backend/designer.py
    python scripts/check_dual_path_symmetry.py --file backend/designer.py
    python scripts/check_dual_path_symmetry.py --allow biz_xxx,biz_yyy   # 豁免已知候选（须先人工判定）
    python scripts/check_dual_path_symmetry.py --print                   # 只输出报告不阻断（调试用）

退出码：0 通过 / 1 发现漂移源 / 2 脚本自身错误（文件缺失 / 解析失败）
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from typing import Dict, List, Optional, Set, Tuple


def _get_call_keys(node: ast.AST, call_names=('get',)) -> Set[str]:
    """收集 AST 子树内 `get('KEY', ...)` / `has('KEY')` 调用的键集合（首参为字符串常量）。"""
    keys: Set[str] = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            fn = sub.func
            name = None
            if isinstance(fn, ast.Name):
                name = fn.id
            elif isinstance(fn, ast.Attribute):
                name = fn.attr
            if name in call_names and sub.args and isinstance(sub.args[0], ast.Constant) \
                    and isinstance(sub.args[0].value, str):
                keys.add(sub.args[0].value)
    return keys


def _self_attr_assigns(node: ast.AST) -> List[Tuple[str, int]]:
    """收集 `self.<attr> = ...` 赋值（属性名, 行号）。"""
    out: List[Tuple[str, int]] = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Assign):
            for t in sub.targets:
                if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) \
                        and t.value.id == 'self' and isinstance(t.attr, str):
                    out.append((t.attr, sub.lineno))
    return out


def _method_of(node: ast.ClassDef, lineno: int) -> Optional[str]:
    for m in node.body:
        if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if m.lineno <= lineno <= getattr(m, 'end_lineno', m.lineno):
                return m.name
    return None


def analyze(source: str,
            entry: str = '_init_biz_caliber_switches',
            json_path: str = '_init_from_project_config',
            ini_paths: Tuple[str, ...] = ('_load_common_ini_config', '_load_common_config'),
            allow: Tuple[str, ...] = ()) -> Dict:
    """AST 分析双路径初始化对称性，返回结构化报告。

    返回字段：ok / errors（阻断项）/ warnings（候选，人工判定）/ report 明细
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            'ok': False,
            'errors': [f'源码解析失败: {exc}'],
            'warnings': [],
            'report': {'parse_error': str(exc)},
        }

    # 定位含 entry 方法的类
    owner: Optional[ast.ClassDef] = None
    for cls in ast.walk(tree):
        if isinstance(cls, ast.ClassDef):
            for m in cls.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name == entry:
                    owner = cls
                    break
        if owner is not None:
            break
    if owner is None:
        return {
            'ok': False,
            'errors': [f'未找到唯一初始化入口方法 {entry}（类内）'],
            'warnings': [],
            'report': {'entry_missing': entry},
        }

    # 定位 entry 方法体
    entry_fn = next(m for m in owner.body
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name == entry)

    # 类内方法名 -> 方法体映射（含 entry）
    methods: Dict[str, ast.FunctionDef] = {}
    for m in owner.body:
        if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
            methods[m.name] = m

    # ── 检查 A：调用点覆盖 ──────────────────────────────────────────────
    callers: Set[str] = set()
    for m in owner.body:
        if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name != entry:
            for sub in ast.walk(m):
                if isinstance(sub, ast.Call):
                    fn = sub.func
                    if isinstance(fn, ast.Attribute) and fn.attr == entry:
                        callers.add(m.name)
    json_hit = json_path in callers
    ini_hit = any(p in callers for p in ini_paths)
    errors: List[str] = []
    if not json_hit:
        errors.append(f'A.调用点覆盖: JSON 路径 {json_path} 未调用唯一入口 {entry}')
    if not ini_hit:
        errors.append(f'A.调用点覆盖: INI 路径 {ini_paths} 均未调用唯一入口 {entry}')
    if not callers:
        errors.append(f'A.调用点覆盖: 类内无任何方法调用 {entry}')

    # ── 口径开关属性：entry 内实际赋值的 self.<attr> 集合（散落检查基准）──
    #    用「entry 内赋值的属性」而非「get/has 的键」作基准，理由：
    #      - biz_chassis_frames_map 这类**数据**（非开关）由 JSON/INI 两路径各自赋值、
    #        entry 仅 has() 存在性检查 —— 若按 get/has 键检查会把合法对称误报为散落；
    #      - 5.3.0/5.3.1 血训漏掉的恰是「开关**属性**」（biz_agg_* / _biz_frames_map_explicit）
    #        在 entry 外被赋值 ⇒ 某路径下属性缺失。
    entry_attrs = {attr for attr, _ in _self_attr_assigns(entry_fn)}
    get_keys = _get_call_keys(entry_fn, call_names=('get',))
    has_keys = _get_call_keys(entry_fn, call_names=('has',))
    keys_in_entry = get_keys | has_keys
    # 检查 C：无默认值的 get 键（缺省即 AttributeError 血训源）
    no_default: List[str] = []
    for sub in ast.walk(entry_fn):
        if isinstance(sub, ast.Call):
            fn = sub.func
            name = fn.id if isinstance(fn, ast.Name) else (
                fn.attr if isinstance(fn, ast.Attribute) else None)
            if name == 'get' and sub.args and isinstance(sub.args[0], ast.Constant) \
                    and isinstance(sub.args[0].value, str):
                has_default = len(sub.args) >= 2 or any(
                    kw.arg in ('default', 'fallback') for kw in sub.keywords)
                if not has_default:
                    no_default.append(sub.args[0].value)
    for key in no_default:
        if key not in allow:
            errors.append(f'C.默认值: 口径开关键 {key} 的 get() 无默认值（配置缺失即 AttributeError 风险）')

    # ── 检查 B：散落赋值（基准 = entry 内赋值的口径开关属性；不对称才违规）──
    #    entry 外对口径开关属性的赋值分两类：
    #      · **不对称**（只出现在 JSON 或只出现在 INI 路径）⇒ 漂移源，阻断
    #        （5.3.0：biz_agg_* 只在 JSON；5.3.1：_biz_frames_map_explicit 只在 JSON）；
    #      · **对称**（两条路径都有的向后兼容显式覆盖，如旧字段 biz_agg_chassis_ports
    #        在 JSON L344 与 INI L573/712 成对出现）⇒ 合法覆盖，仅信息记录。
    scattered: List[Dict] = []
    scattered_symmetric: List[Dict] = []
    outside_assigns: Dict[str, List[Tuple[str, int]]] = {}
    for mname, m in methods.items():
        if mname == entry:
            continue
        for attr, lineno in _self_attr_assigns(m):
            if attr in entry_attrs:
                outside_assigns.setdefault(attr, []).append((mname, lineno))
    for attr, hits in sorted(outside_assigns.items()):
        hit_methods = {h[0] for h in hits}
        has_json = json_path in hit_methods
        has_ini = any(p in hit_methods for p in ini_paths)
        item = {'attr': attr, 'methods': sorted(hit_methods),
                'line': min(h[1] for h in hits), 'json_covered': has_json,
                'ini_covered': has_ini}
        if has_json and has_ini:
            scattered_symmetric.append(item)
        else:
            scattered.append(item)
    for item in scattered:
        if item['attr'] not in allow:
            errors.append(
                f"B.散落赋值: 口径开关属性 {item['attr']} 在 entry 外被赋值且仅覆盖 "
                f"{'JSON' if item['json_covered'] else '非JSON'}/"
                f"{'INI' if item['ini_covered'] else '非INI'} 路径（不对称）—— "
                f"必须收进 {entry}")

    # ── 报告 ────────────────────────────────────────────────────────────
    warnings: List[str] = []
    if not keys_in_entry:
        warnings.append('entry 内未读取任何口径开关键（get 键集合为空，请确认 entry 是否仍为唯一入口）')

    report = {
        'entry': entry,
        'callers': sorted(callers),
        'json_path': json_path,
        'ini_paths': list(ini_paths),
        'json_hit': json_hit,
        'ini_hit': ini_hit,
        'caliber_keys': sorted(keys_in_entry),
        'entry_attrs': sorted(entry_attrs),
        'get_keys': sorted(get_keys),
        'has_keys': sorted(has_keys),
        'no_default_keys': sorted(no_default),
        'scattered_assigns': scattered,
        'scattered_symmetric': scattered_symmetric,
    }
    return {'ok': not errors, 'errors': errors, 'warnings': warnings, 'report': report}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description='双路径初始化对称性 AST 探针（V5.3.3-T7.0 / AL-G14）')
    parser.add_argument('--file', default='backend/designer.py',
                        help='目标源码文件（默认 backend/designer.py）')
    parser.add_argument('--entry', default='_init_biz_caliber_switches',
                        help='唯一初始化入口方法名')
    parser.add_argument('--json-path', default='_init_from_project_config',
                        help='JSON 初始化方法名')
    parser.add_argument('--ini-paths', default='_load_common_ini_config,_load_common_config',
                        help='INI 初始化方法名（逗号分隔，命中其一即可）')
    parser.add_argument('--allow', default='',
                        help='豁免候选键（逗号分隔；须先人工判定为安全差异）')
    parser.add_argument('--print', action='store_true',
                        help='只输出 JSON 报告，不按退出码阻断')
    args = parser.parse_args(argv)

    ini_paths = tuple(p.strip() for p in args.ini_paths.split(',') if p.strip())
    allow = tuple(p.strip() for p in args.allow.split(',') if p.strip())

    try:
        with open(args.file, 'r', encoding='utf-8') as fh:
            source = fh.read()
    except OSError as exc:
        print(f'错误: 无法读取 {args.file}: {exc}', file=sys.stderr)
        return 2

    result = analyze(source, entry=args.entry, json_path=args.json_path,
                     ini_paths=ini_paths, allow=allow)

    if args.print:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f'双路径对称探针 {args.file}')
    print(f'  入口: {result["report"]["entry"]}')
    print(f'  JSON 路径命中: {result["report"]["json_hit"]} '
          f'(调用者: {", ".join(result["report"]["callers"]) or "无"})')
    print(f'  口径开关键 ({len(result["report"]["caliber_keys"])}): '
          f'{", ".join(result["report"]["caliber_keys"]) or "空"}')
    if result['report']['no_default_keys']:
        print(f'  无默认值键: {", ".join(result["report"]["no_default_keys"])}')
    if result['report']['scattered_assigns']:
        for item in result['report']['scattered_assigns']:
            print(f"  散落赋值(不对称): {item['attr']} @ {item['methods']}:L{item['line']}")
    if result['report']['scattered_symmetric']:
        for item in result['report']['scattered_symmetric']:
            print(f"  ℹ 对称覆盖(向后兼容): {item['attr']} @ {item['methods']}:L{item['line']}")
    for w in result['warnings']:
        print(f'  ⚠ {w}')
    if result['errors']:
        print('  ✗ 发现漂移源:')
        for e in result['errors']:
            print(f'    - {e}')
        return 1
    print('  ✓ 双路径初始化对称性通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
