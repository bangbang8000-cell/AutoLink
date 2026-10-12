"""5.4.14-F54-14-1/F54-14-2：运维保障 —— 支持包导出 + 本地遥测 契约测试。"""
import json
import os
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend"))

from ops.support_bundle import SupportBundleSources, export_support_bundle  # noqa: E402
from ops.telemetry import Telemetry, sanitize_event, timed_telemetry  # noqa: E402


# ============================================================
# 支持包
# ============================================================

class TestSupportBundle:
    def test_export_zip_contains_manifest_and_files(self, tmp_path):
        log = tmp_path / "app.log"
        log.write_text("line0\nline1\nline2\nline3\nline4\n", encoding="utf-8")
        audit = tmp_path / "audit.jsonl"
        audit.write_text('{"a":1}\n', encoding="utf-8")
        dst = str(tmp_path / "bundle.zip")
        manifest = export_support_bundle(
            dst,
            SupportBundleSources(
                version_info={"version": "5.4.14"},
                config_snapshot={"theme": "dark"},
                log_files=[str(log)],
                audit_files=[str(audit)],
                tail_n=3,
            ),
        )
        assert os.path.exists(dst)
        with zipfile.ZipFile(dst) as zf:
            names = set(zf.namelist())
            assert {"manifest.json", "config_snapshot.json", "log/app.log.tail", "audit/audit.jsonl.tail"} <= names
            assert zf.read("log/app.log.tail").decode() == "line2\nline3\nline4\n"
        assert manifest["files"]["log/app.log.tail"] == "ok"

    def test_missing_files_marked_and_skipped(self, tmp_path):
        dst = str(tmp_path / "b.zip")
        manifest = export_support_bundle(
            dst,
            SupportBundleSources(
                version_info={"version": "x"},
                log_files=[str(tmp_path / "nope.log")],
            ),
        )
        with zipfile.ZipFile(dst) as zf:
            assert "log/nope.log.tail" not in zf.namelist()
        assert manifest["files"]["log/nope.log.tail"] == "missing"

    def test_inner_manifest_self_describing(self, tmp_path):
        dst = str(tmp_path / "s.zip")
        export_support_bundle(dst, SupportBundleSources(version_info={"version": "5.4.14"}))
        with zipfile.ZipFile(dst) as zf:
            inner = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert inner["schema"] == "autolink.ops.support-bundle/1"
        assert inner["app"]["version"] == "5.4.14"


# ============================================================
# 遥测
# ============================================================

class TestTelemetry:
    def _tel(self, tmp_path):
        return Telemetry(
            config_path=str(tmp_path / "ops_config.json"),
            log_path=str(tmp_path / "telemetry.jsonl"),
        )

    def test_disabled_by_default(self, tmp_path):
        assert self._tel(tmp_path).is_enabled() is False

    def test_record_when_disabled_returns_none(self, tmp_path):
        tel = self._tel(tmp_path)
        assert tel.record({"op": "open_project"}) is None
        assert tel.count() == 0

    def test_enable_and_record(self, tmp_path):
        tel = self._tel(tmp_path)
        tel.set_enabled(True)
        assert tel.is_enabled() is True
        assert tel.record({"op": "open_project", "project": "demo"}) == 1
        assert tel.record({"op": "render"}) == 2
        assert tel.count() == 2

    def test_sanitize_on_write(self, tmp_path):
        tel = self._tel(tmp_path)
        tel.set_enabled(True)
        tel.record({"op": "auth", "credentials": {"password": "hunter2", "token": "abc123"}, "device": "leaf-01"})
        lines = open(tel.log_path, encoding="utf-8").readlines()
        assert "hunter2" not in lines[0]
        assert "abc123" not in lines[0]
        assert '"***"' in lines[0]

    def test_export_returns_recent_and_wrapped(self, tmp_path):
        tel = self._tel(tmp_path)
        tel.set_enabled(True)
        for i in range(3):
            tel.record({"op": f"op{i}"})
        exported = tel.export(limit=2)
        assert len(exported) == 2
        assert exported[-1]["event"]["op"] == "op2"

    def test_clear(self, tmp_path):
        tel = self._tel(tmp_path)
        tel.set_enabled(True)
        tel.record({"op": "x"})
        assert tel.count() == 1
        tel.clear()
        assert tel.count() == 0


class TestSanitize:
    def test_nested_dict_sanitized(self):
        out = sanitize_event({"a": {"password": "p", "keep": "v"}})
        assert out["a"]["password"] == "***"
        assert out["a"]["keep"] == "v"

    def test_key_variants(self):
        out = sanitize_event({"api_key": "k", "authorization": "z", "normal": 1})
        assert out["api_key"] == "***"
        assert out["authorization"] == "***"
        assert out["normal"] == 1

    def test_original_not_mutated(self):
        ev = {"a": {"password": "p"}}
        sanitize_event(ev)
        assert ev["a"]["password"] == "p"


# ============================================================
# 耗时埋点（F54-14-4）
# ============================================================

class TestTimedTelemetry:
    def test_records_cost_when_enabled(self, tmp_path):
        tel = Telemetry(
            config_path=str(tmp_path / "ops_config.json"),
            log_path=str(tmp_path / "telemetry.jsonl"),
        )
        tel.set_enabled(True)
        with timed_telemetry(tel, "matrix_layout", {"racks": 225}):
            pass  # 成本近 0ms
        entries = tel.export()
        assert len(entries) == 1
        ev = entries[0]["event"]
        assert ev["op"] == "timing"
        assert ev["stage"] == "matrix_layout"
        assert ev["racks"] == 225
        assert ev["cost_ms"] >= 0

    def test_no_record_when_disabled(self, tmp_path):
        tel = Telemetry(
            config_path=str(tmp_path / "ops_config.json"),
            log_path=str(tmp_path / "telemetry.jsonl"),
        )
        with timed_telemetry(tel, "design_generate"):
            pass
        assert tel.count() == 0
