"""5.4.13-F54-13-2：AL 本地全量检查脚本契约测试（steps() 执行计划 = 单一事实源）。"""
import importlib.util
import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRIPT = os.path.join(_REPO, 'scripts', 'run_full_checks_local.py')
_spec = importlib.util.spec_from_file_location('run_full_checks_local_5413', _SCRIPT)
mod = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = mod  # dataclass 依赖 sys.modules 注册
_spec.loader.exec_module(mod)
steps = mod.steps


class TestLocalFullCheckPlan:
    def test_plan_contains_core_gates(self):
        names = [n for n, _, _ in steps()]
        assert "typecheck" in names
        assert "模板校验" in names
        assert "golden 基线比对" in names
        assert "性能门禁" in names
        assert "后端 pytest" in names
        assert "版本一致性" in names

    def test_plan_includes_env_limited_steps_as_hard_gate(self):
        """CI 中 continue-on-error 的步骤在本地必须为硬门禁。"""
        names = [n for n, _, _ in steps()]
        for name in ("模板校验", "golden 基线比对", "性能门禁"):
            assert name in names, f"本地硬门禁缺失: {name}"

    def test_plan_unique_names(self):
        names = [n for n, _, _ in steps()]
        assert len(names) == len(set(names))

    def test_plan_commands_are_strings(self):
        for name, cmd, cwd in steps():
            assert isinstance(cmd, list) and all(isinstance(c, str) for c in cmd)
            assert cwd is None or isinstance(cwd, str)
