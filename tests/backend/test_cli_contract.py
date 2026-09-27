"""AL-CLI 契约守卫的行为测试（C1-C4）。

守卫本体：`scripts/check_cli_contract.py` —— 真值源 = 注册表
（`engine.list_registered_actions()`），文档被校验而非参与真值判定。
本用例确保守卫**真的会因违例而失败**，并对关键契约做正向断言。

覆盖：
- C1 退出码常量存在且取值 0/1/2/3
- C2 无裸 sys.exit(数字)（130 白名单）
- C3 docs/cli.md 域表声明的「N 域 M action」↔ 注册表对账（防文档漂移）
- C4 三级 action（a:b:c）在文档中体现多级命令形态

运行：pytest tests/backend/test_cli_contract.py
"""
from __future__ import annotations

import importlib.util
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GUARD = os.path.join(REPO, 'scripts', 'check_cli_contract.py')


def _load_guard():
    spec = importlib.util.spec_from_file_location('al_check_cli_contract', GUARD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def guard():
    assert os.path.exists(GUARD), f'守卫脚本缺失: {GUARD}'
    return _load_guard()


class TestGuardPassesOnCurrentTree:
    def test_guard_exit_zero(self):
        import subprocess
        r = subprocess.run([sys.executable, GUARD], capture_output=True, text=True)
        assert r.returncode == 0, f'守卫未通过:\n{r.stdout}\n{r.stderr}'


class TestC1ExitConstants:
    def test_values_ok(self, guard):
        src = 'EXIT_OK = 0\nEXIT_INTERNAL = 1\nEXIT_USAGE = 2\nEXIT_EXEC = 3\n'
        assert guard.check_exit_constants(src) == []

    def test_wrong_detected(self, guard):
        v = guard.check_exit_constants('EXIT_OK = 7\n')
        assert any(x.check == 'C1' for x in v)


class TestC2RawExits:
    def test_raw_detected(self, guard):
        v = guard.check_raw_exits('import sys\nsys.exit(1)\n')
        assert any(x.check == 'C2' for x in v)

    def test_sigint_whitelisted(self, guard):
        assert guard.check_raw_exits('import sys\nsys.exit(130)\n') == []


class TestC3DocActionTable:
    def test_registry_readable(self, guard):
        actions = guard._registered_actions()
        assert len(actions) > 0, '注册表读取失败'
        # 三级 action 必须存在（批次 B 契约）
        assert any(a.count(':') == 2 for a in actions), '注册表无三级 action'

    def test_current_doc_consistent(self, guard):
        actions = guard._registered_actions()
        assert guard.check_doc_action_table(guard.CLI_DOC, actions) == []

    def test_stale_declaration_caught(self, guard, tmp_path):
        actions = guard._registered_actions()
        doc = tmp_path / 'cli.md'
        doc.write_text('## 3. 域速查表（18 域 37 action，注册表自动发现）\n', encoding='utf-8')
        v = guard.check_doc_action_table(str(doc), actions)
        assert any(x.check == 'C3' for x in v)

    def test_unregistered_action_in_doc_caught(self, guard, tmp_path):
        actions = guard._registered_actions()
        doc = tmp_path / 'cli.md'
        doc.write_text('## 3. 域速查表（1 域 1 action）\n\n`bogus:cmd`\n', encoding='utf-8')
        v = guard.check_doc_action_table(str(doc), actions)
        assert any('bogus:cmd' in x.message for x in v)


class TestC4MultiLevelVisible:
    def test_triple_actions_visible(self, guard):
        actions = guard._registered_actions()
        assert guard.check_multi_level_visible(actions, guard.CLI_DOC) == []

    def test_missing_multilevel_caught(self, guard, tmp_path):
        doc = tmp_path / 'cli.md'
        doc.write_text('# 空文档\n', encoding='utf-8')
        v = guard.check_multi_level_visible(['aidc:project:create'], str(doc))
        assert any(x.check == 'C4' for x in v)


class TestSchemaCoverage:
    """AL-P1-4（批次 C）：ACTION_PARAM_SCHEMA 覆盖全部注册 action。"""

    def test_all_actions_have_schema(self):
        sys.path.insert(0, os.path.join(REPO, 'backend'))
        from cli import ACTION_PARAM_SCHEMA  # noqa: E402
        from engine import list_registered_actions  # noqa: E402
        # 排除测试内部动态注册的临时 action（如 test_agent_process.py 的
        # `__t0_6_stream`）—— 它们不属于产品注册表，不应要求 schema 覆盖。
        actions = {a for a in list_registered_actions() if not a.startswith('__')}
        have = set(ACTION_PARAM_SCHEMA.keys())
        assert not (actions - have), f'缺 schema: {sorted(actions - have)}'
        assert not (have - actions), f'多余 schema（未注册）: {sorted(have - actions)}'

    def test_no_flag_collides_with_output_format(self):
        """schema 参数不得用 `--format`（与 CLI 全局输出形态 --format 撞名）。"""
        sys.path.insert(0, os.path.join(REPO, 'backend'))
        from cli import ACTION_PARAM_SCHEMA  # noqa: E402
        for action, schema in ACTION_PARAM_SCHEMA.items():
            for p in schema.get('params', []):
                assert '--format' not in p['flags'], (
                    f'{action} 的参数用了 --format，会与全局输出形态冲突'
                )
