"""5.4.13-F54-13-4：质量趋势/历史（test_report.py 扩展）契约测试。

覆盖：
- summarize_for_history：把一次报告压成趋势条目
- append_history / load_history：追加 + 裁剪到 MAX_HISTORY
- format_trend：趋势表渲染
"""
import importlib.util
import os
import sys

import pytest

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SCRIPT = os.path.join(_REPO, 'scripts', 'test_report.py')
_spec = importlib.util.spec_from_file_location('test_report_5413', _SCRIPT)
test_report = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(test_report)

MAX_HISTORY = test_report.MAX_HISTORY
append_history = test_report.append_history
format_trend = test_report.format_trend
load_history = test_report.load_history
summarize_for_history = test_report.summarize_for_history


def _fake_report(total=100, failed=3, gate=True, back=61.2, front=54.0, at='2026-10-12T08:00:00+0800'):
    return {
        'generatedAt': at,
        'mode': 'from-artifacts',
        'summary': {
            'totalTests': total,
            'passed': total - failed,
            'failed': failed,
            'skipped': 0,
            'passRate': round((total - failed) / total * 100, 1) if total else 0,
        },
        'coverage': {
            'backend': {'lines': {'pct': back, 'covered': 980, 'total': 1600}},
            'frontend': {'lines': {'pct': front, 'covered': 2200, 'total': 4074}},
        },
        'coverageGate': {'passed': gate, 'thresholds': {}, 'baselineFile': 'reports/coverage_baseline.json', 'checks': []},
        'modules': [],
        'gates': [],
        'durationMs': 12345,
    }


class TestQualityHistory:
    def test_summarize_extracts_fields(self):
        item = summarize_for_history(_fake_report())
        assert item['totalTests'] == 100
        assert item['passed'] == 97
        assert item['failed'] == 3
        assert item['passRate'] == 97.0
        assert item['coverageGatePassed'] is True
        assert item['coverageBackendLines'] == 61.2
        assert item['coverageFrontendLines'] == 54.0

    def test_append_and_load(self, tmp_path):
        path = str(tmp_path / 'quality_history.json')
        append_history(_fake_report(), path=path)
        append_history(_fake_report(total=120, failed=0), path=path)
        hist = load_history(path)
        assert len(hist) == 2
        assert hist[-1]['totalTests'] == 120

    def test_append_trims_to_max(self, tmp_path):
        path = str(tmp_path / 'quality_history.json')
        for i in range(MAX_HISTORY + 10):
            append_history(_fake_report(total=100 + i), path=path)
        hist = load_history(path)
        assert len(hist) == MAX_HISTORY

    def test_load_missing_returns_empty(self, tmp_path):
        assert load_history(str(tmp_path / 'nope.json')) == []

    def test_format_trend_renders_header_and_rows(self, tmp_path):
        path = str(tmp_path / 'q.json')
        append_history(_fake_report(gate=True), path=path)
        append_history(_fake_report(gate=False, failed=9), path=path)
        text = format_trend(load_history(path))
        assert '通过/总数' in text
        assert '97/100' in text
        # 第二次门禁 FAIL 可见
        assert 'FAIL' in text
        assert 'PASS' in text

    def test_duration_and_mode_preserved(self, tmp_path):
        path = str(tmp_path / 'q.json')
        append_history(_fake_report(), path=path)
        item = load_history(path)[0]
        assert item['durationMs'] == 12345
        assert item['mode'] == 'from-artifacts'
