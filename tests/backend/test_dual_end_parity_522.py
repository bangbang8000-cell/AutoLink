"""5.2.2 · 双端同构结构一致性（MC T5.1 / AL T4.4）

背景：MC 的 ``ai_hub`` 与 AL 的 ``autolink_hub`` 是**同构双胞胎**——
目录结构、模块划分、公有 API 名基本一致。此前多次出现「一端修了另一端没修」
（如参数校验失败的外层 ``success`` 一端 true 一端 false），根因就是**缺少结构级护栏**。

本用例用 AST 静态比对两端同构文件的**公有契约面**：
  1. 核心契约名必须两端都存在（缺一即 FAIL）
  2. 共有公有函数的**形参名序列**必须一致（改签名即 FAIL，防无声漂移）
  3. 非核心的公有名差异仅**告警**（各端有自己的领域工具，差异本身合法）

只做静态解析，**不 import 对端模块**（避免跨端依赖污染与导入副作用）。
AL 仓库缺失时整体 skip（便于各端独立发布）。
"""
from __future__ import annotations

import ast
import warnings
from pathlib import Path

import pytest

# tests/ → ai_hub/ → MagicCommander-Client/ → MC-AL/
_REPO_ROOT = Path(__file__).resolve().parents[3]
MC_HUB = _REPO_ROOT / 'MagicCommander-Client' / 'ai_hub'
AL_HUB = _REPO_ROOT / 'AIDC AutoLink-Client' / 'backend' / 'autolink_hub'

# 同构文件（相对 hub 根目录）
ISOMORPHIC_FILES = (
    'mcp_server/capabilities.py',
    'mcp_server/manager.py',
    'agent/tools.py',
)

# 核心契约面：这些名字两端都必须存在，缺一即视为「一端漏修」
CORE_SURFACE: dict[str, list[str]] = {
    'mcp_server/capabilities.py': [
        'CAPABILITY_DOMAINS', 'SOURCE_ONLY_TOOLS', 'COMPILED_BLOCKED_TOOLS',
        'is_destructive_tool', 'is_source_only_tool', 'is_blocked_in_compiled',
        'audit_block_rules', 'assert_compiled_selection_safe', 'domain_for_tool',
        'mcp_permission_meta', 'is_readonly_tool', 'tool_annotations',
        'filter_tools_for_mode', 'tool_name_to_mcp', 'normalize_mcp_schema',
        'CONFIRM_APPROVAL_FIELD',
    ],
    'mcp_server/manager.py': [
        'AgentConnectManager', 'get_agent_connect_manager', 'reset_manager',
    ],
    'agent/tools.py': [
        'execute_tool', 'set_execution_guard', 'get_execution_guard',
        'register_tool', 'unregister_tool', 'get_tool_definitions', 'init_tools',
    ],
}

# AgentConnectManager 的核心方法（含 @property）
CORE_MANAGER_METHODS = [
    'status', 'agent_mode', 'mcp', 'enable', 'disable', 'set_agent_mode',
    'set_gate_mode', 'gate_mode', 'gate_hits', 'block_audit', 'selfcheck',
    'status_report', 'set_audit_path', 'record_audit', 'query_audit',
]

pytestmark = pytest.mark.skipif(
    not AL_HUB.is_dir(),
    reason=f'未找到 AL 同构目录 {AL_HUB}（跨端比对跳过）',
)


def _parse(hub: Path, rel: str) -> ast.Module:
    return ast.parse((hub / rel).read_text(encoding='utf-8'), filename=str(hub / rel))


def _top_level_defs(tree: ast.Module) -> dict[str, list[str]]:
    """公有顶层函数/异步函数/类 → 形参名序列；公有常量名 → []"""
    out: dict[str, list[str]] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith('_'):
                continue
            out[node.name] = [a.arg for a in node.args.args]
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith('_'):
                out.setdefault(node.name, [])
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if not node.target.id.startswith('_'):
                out.setdefault(node.target.id, [])
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and not t.id.startswith('_'):
                    out.setdefault(t.id, [])
    return out


def _class_methods(tree: ast.Module, cls_name: str) -> dict[str, list[str]]:
    """类方法 → 形参名序列。

    归一化：剔除 ``self`` / ``cls``。``@staticmethod`` 与 ``@classmethod`` 的
    选择属实现细节（双端当前确有差异），不作为不一致判定依据。
    """
    out: dict[str, list[str]] = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == cls_name:
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out[item.name] = [a.arg for a in item.args.args
                                      if a.arg not in ('self', 'cls')]
    return out


# ================================================================
#  1. 核心契约面：两端都必须存在
# ================================================================

@pytest.mark.parametrize('rel', ISOMORPHIC_FILES)
def test_core_surface_exists_on_both_ends(rel):
    mc = _top_level_defs(_parse(MC_HUB, rel))
    al = _top_level_defs(_parse(AL_HUB, rel))
    for name in CORE_SURFACE.get(rel, []):
        assert name in mc, f'MC {rel} 缺少核心契约名 {name}'
        assert name in al, f'AL {rel} 缺少核心契约名 {name}（MC 有而 AL 无 = 一端漏修）'


def test_core_manager_methods_exist_on_both_ends():
    rel = 'mcp_server/manager.py'
    mc = _class_methods(_parse(MC_HUB, rel), 'AgentConnectManager')
    al = _class_methods(_parse(AL_HUB, rel), 'AgentConnectManager')
    for m in CORE_MANAGER_METHODS:
        assert m in mc, f'MC AgentConnectManager 缺少方法 {m}'
        assert m in al, f'AL AgentConnectManager 缺少方法 {m}（一端漏修）'


# ================================================================
#  2. 共有公有函数的签名必须一致
# ================================================================

@pytest.mark.parametrize('rel', ISOMORPHIC_FILES)
def test_shared_public_signatures_match(rel):
    mc = _top_level_defs(_parse(MC_HUB, rel))
    al = _top_level_defs(_parse(AL_HUB, rel))
    shared = sorted(set(mc) & set(al))
    mismatched = {
        n: (mc[n], al[n]) for n in shared
        if mc[n] and al[n] and mc[n] != al[n]
    }
    assert not mismatched, (
        f'{rel} 双端共有函数签名不一致（形参名序列不同）: '
        + '; '.join(f'{name}: MC{sig_mc} vs AL{sig_al}'
                    for name, (sig_mc, sig_al) in sorted(mismatched.items()))
    )


def test_shared_manager_method_signatures_match():
    rel = 'mcp_server/manager.py'
    mc = _class_methods(_parse(MC_HUB, rel), 'AgentConnectManager')
    al = _class_methods(_parse(AL_HUB, rel), 'AgentConnectManager')
    shared = sorted(set(mc) & set(al))
    mismatched = {n: (mc[n], al[n]) for n in shared if mc[n] != al[n]}
    assert not mismatched, f'AgentConnectManager 方法签名不一致: {mismatched}'


# ================================================================
#  3. 非核心差异：仅告警（各端领域工具差异合法）
# ================================================================

@pytest.mark.parametrize('rel', ISOMORPHIC_FILES)
def test_non_core_differences_only_warn(rel):
    mc = set(_top_level_defs(_parse(MC_HUB, rel)))
    al = set(_top_level_defs(_parse(AL_HUB, rel)))
    core = set(CORE_SURFACE.get(rel, []))
    diff = (mc ^ al) - core
    for name in sorted(diff):
        side = 'MC-only' if name in mc else 'AL-only'
        warnings.warn(f'{rel}: {name} 为 {side}（非核心，允许；若属通用能力请双端拉齐）',
                      UserWarning, stacklevel=1)


# ================================================================
#  4. 关键行为常量语义一致（不要求值相同，要求形状相同）
# ================================================================

def test_source_only_tools_parity():
    """SOURCE_ONLY_TOOLS 为源码态专属工具，双端语义必须一致"""
    mc_tree = _parse(MC_HUB, 'mcp_server/capabilities.py')
    al_tree = _parse(AL_HUB, 'mcp_server/capabilities.py')

    def _const(tree, name):
        for node in tree.body:
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) \
                    and node.target.id == name and isinstance(node.value, ast.List):
                return [e.value for e in node.value.elts if isinstance(e, ast.Constant)]
        return None

    assert _const(mc_tree, 'SOURCE_ONLY_TOOLS') == _const(al_tree, 'SOURCE_ONLY_TOOLS')


def test_confirm_approval_field_parity():
    """门禁 token 字段名必须两端一致，否则跨端调用方无法复用"""
    def _const(hub):
        tree = _parse(hub, 'mcp_server/capabilities.py')
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == 'CONFIRM_APPROVAL_FIELD':
                        if isinstance(node.value, ast.Constant):
                            return node.value.value
        return None

    assert _const(MC_HUB) == _const(AL_HUB) is not None
