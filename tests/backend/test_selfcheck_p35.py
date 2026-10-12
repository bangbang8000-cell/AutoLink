"""5.4.12-F54-12-4（P3.5）：设备配置自检引擎契约测试。

覆盖：
- MiniTextFSM 最小可用：多记录解析、${VAR} 引用、Required、Record 重置
- 检查项模型：注册/去重/异常隔离/类别过滤
- 内置检查项：hostname / MTU 一致性 / 双工 / ACL 日志
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from selfcheck.core import CheckItem, CheckRegistry, CheckResult, SEV_ERROR, SEV_WARN
from selfcheck.runner import default_registry, run_self_checks
from selfcheck.textfsm_mini import MiniTextFSM, MiniTextFSMError

GOOD_CONFIG = """\
hostname leaf-01
!
interface GigabitEthernet1/0/1
 mtu 9216
 duplex auto
!
interface GigabitEthernet1/0/2
 mtu 9216
 duplex auto
!
"""

BAD_CONFIG = """\
interface GigabitEthernet1/0/1
 mtu 1500
 duplex half
!
interface GigabitEthernet1/0/2
 mtu 9216
 duplex full
!
ip access-list extended PERMIT-ALL
 permit ip any any
"""


# ============================================================
# MiniTextFSM
# ============================================================

class TestMiniTextFSM:
    TEMPLATE = """Value INTERFACE (\\S+)
Value MTU (\\d+)

Start
  ^interface\\s+${INTERFACE}
  ^\\s*mtu\\s+${MTU} -> Record
"""

    def test_parse_multiple_records(self):
        fsm = MiniTextFSM(self.TEMPLATE)
        recs = fsm.parse(GOOD_CONFIG)
        assert recs == [
            {"INTERFACE": "GigabitEthernet1/0/1", "MTU": "9216"},
            {"INTERFACE": "GigabitEthernet1/0/2", "MTU": "9216"},
        ]

    def test_missing_value_stays_empty(self):
        text = "interface GigabitEthernet1/0/1\n"
        recs = MiniTextFSM(self.TEMPLATE).parse(text)
        assert recs == []

    def test_undefined_variable_raises(self):
        with pytest.raises(MiniTextFSMError):
            MiniTextFSM("Value A (\\S+)\n\nStart\n  ^x\\s+${B} -> Record\n")

    def test_malformed_rule_raises(self):
        with pytest.raises(MiniTextFSMError):
            MiniTextFSM("Start\n  not-a-regex-line\n")

    def test_value_names(self):
        fsm = MiniTextFSM(self.TEMPLATE)
        assert fsm.value_names == ["INTERFACE", "MTU"]


# ============================================================
# 检查项模型
# ============================================================

class TestCheckModel:
    def test_register_and_get(self):
        reg = CheckRegistry()
        item = CheckItem("x", "x", "basic", SEV_ERROR, lambda t: [])
        reg.register(item)
        assert reg.get("x") is item

    def test_duplicate_register_raises(self):
        reg = CheckRegistry()
        reg.register(CheckItem("x", "x", "basic", SEV_ERROR, lambda t: []))
        with pytest.raises(ValueError):
            reg.register(CheckItem("x", "x2", "basic", SEV_ERROR, lambda t: []))

    def test_unregister(self):
        reg = CheckRegistry()
        reg.register(CheckItem("x", "x", "basic", SEV_ERROR, lambda t: []))
        reg.unregister("x")
        assert reg.get("x") is None

    def test_category_filter(self):
        reg = CheckRegistry()
        reg.register(CheckItem("a", "a", "cat1", SEV_ERROR, lambda t: [CheckResult("a", "a", SEV_ERROR, True, "ok")]))
        reg.register(CheckItem("b", "b", "cat2", SEV_ERROR, lambda t: [CheckResult("b", "b", SEV_ERROR, True, "ok")]))
        assert [r.check_id for r in reg.run("", categories=["cat1"])] == ["a"]

    def test_exception_isolation(self):
        reg = CheckRegistry()
        reg.register(CheckItem("boom", "boom", "basic", SEV_ERROR, lambda t: 1 / 0))
        reg.register(CheckItem("ok", "ok", "basic", SEV_ERROR, lambda t: [CheckResult("ok", "ok", SEV_ERROR, True, "ok")]))
        results = reg.run("x")
        assert len(results) == 2
        assert any(not r.ok and "异常" in r.message for r in results)


# ============================================================
# 内置检查项（端到端）
# ============================================================

class TestBuiltinChecks:
    def test_good_config_passes(self):
        results = run_self_checks(GOOD_CONFIG)
        by_id = {r.check_id: r for r in results}
        assert by_id["hostname-present"].ok is True
        assert by_id["interface-mtu-consistency"].ok is True
        assert by_id["duplex-mode-auto"].ok is True
        assert by_id["acl-logging"].ok is True

    def test_bad_config_flags_issues(self):
        results = run_self_checks(BAD_CONFIG)
        by_id = {r.check_id: r for r in results}
        assert by_id["hostname-present"].ok is False
        assert by_id["hostname-present"].severity == SEV_ERROR
        assert by_id["interface-mtu-consistency"].ok is False
        assert by_id["interface-mtu-consistency"].severity == SEV_WARN
        assert by_id["duplex-mode-auto"].ok is False
        assert by_id["acl-logging"].ok is False

    def test_default_registry_registers_all(self):
        reg = default_registry()
        ids = {i.id for i in reg.all()}
        assert {"hostname-present", "interface-mtu-consistency", "duplex-mode-auto", "acl-logging"} <= ids

    def test_check_result_shape(self):
        results = run_self_checks(BAD_CONFIG)
        for r in results:
            assert isinstance(r, CheckResult)
            assert r.check_id and r.name and r.severity in ("info", "warn", "error")
            assert isinstance(r.ok, bool)
            assert r.message

    def test_category_scoped_run(self):
        results = run_self_checks(GOOD_CONFIG, categories=["security"])
        assert {r.check_id for r in results} == {"acl-logging"}
