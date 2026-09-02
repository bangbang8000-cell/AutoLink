"""4.6.0（F6-3）：统一测试报告生成（Q-3）

测试 scripts/test_report.py：
  - 纯函数：parse_junit / build_report / render_html / coverage_gate
  - JSON 报告结构断言（总览 / 覆盖率 / 门禁 / 模块 / 校验）
  - --smoke 子进程端到端（reports/quality_report.json 结构断言）
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

import test_report as tr  # noqa: E402

SAMPLE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="demo" tests="10" failures="2" errors="1" skipped="1" time="3.5"/>
</testsuites>
'''


def test_parse_junit():
    with tempfile.NamedTemporaryFile('w', suffix='.xml', delete=False, encoding='utf-8') as f:
        f.write(SAMPLE_XML)
        p = f.name
    try:
        st = tr.parse_junit(p)
        assert st['tests'] == 10
        assert st['failures'] == 2
        assert st['errors'] == 1
        assert st['skipped'] == 1
        assert st['durationMs'] == 3500
    finally:
        os.unlink(p)


def test_parse_junit_missing_returns_none():
    assert tr.parse_junit(os.path.join(ROOT, 'nonexistent.xml')) is None


def test_build_report_structure():
    """Q-3：JSON 报告结构（总览 / 覆盖率 / 门禁 / 模块 / 校验）"""
    report = tr.build_report(
        mode='run',
        coverage={
            'backend': {'lines': {'pct': 60.0, 'covered': 100, 'total': 200}},
            'frontend': {'lines': {'pct': 55.0, 'covered': 220, 'total': 400}},
        },
        modules=[{'id': 'backend', 'name': '后端 pytest', 'tests': 10, 'failures': 1,
                  'errors': 0, 'skipped': 0, 'passRate': 90.0, 'durationMs': 1000}],
        gates=[{'id': 'golden', 'name': 'golden', 'passed': True}],
        validation={'passed': True},
        coverage_checks=[{'scope': 'backend', 'metric': 'lines', 'passed': True}],
        coverage_passed=True,
        thresholds_data={'backend': {'lines': 55}},
        duration_ms=1234,
    )
    assert report['schemaVersion'] == 1
    assert 'generatedAt' in report
    assert report['summary']['totalTests'] == 10
    assert report['summary']['failed'] == 1
    assert report['coverage']['backend']['lines']['pct'] == 60.0
    assert report['coverageGate']['passed'] is True
    assert report['coverageGate']['checks'][0]['metric'] == 'lines'
    assert report['modules'][0]['id'] == 'backend'
    assert report['gates'][0]['id'] == 'golden'
    assert report['validation']['passed'] is True


def test_render_html_contains_sections():
    report = tr.build_report(mode='smoke', coverage={}, modules=[], gates=[], validation={})
    html = tr.render_html(report)
    assert '<html' in html
    assert 'AutoLink 质量测试报告' in html
    assert '覆盖率' in html
    assert '测试模块' in html
    assert '门禁结果' in html
    assert '模板校验' in html


def test_coverage_gate_threshold_and_baseline():
    """只升不降：低于阈值或低于历史基线即失败；不低于则通过"""
    thr = {'backend': {'lines': 55}}
    cov_low = {'backend': {'lines': {'pct': 54.0, 'covered': 0, 'total': 0}}}
    passed, checks, _ = tr.coverage_gate(cov_low, thr, {})
    assert not passed, '低于阈值应失败'
    assert any(not c['passed'] for c in checks)

    cov_ok = {'backend': {'lines': {'pct': 60.0, 'covered': 0, 'total': 0}}}
    passed, _, _ = tr.coverage_gate(cov_ok, thr, {})
    assert passed, '高于阈值应通过'

    # 历史基线更高 → 当前低于基线应失败（只许升不许降）
    cov_below_base = {'backend': {'lines': {'pct': 58.0, 'covered': 0, 'total': 0}}}
    base_high = {'backend': {'lines': 59.0}}
    passed, _, _ = tr.coverage_gate(cov_below_base, thr, base_high)
    assert not passed, '低于历史基线应失败（只许升不许降）'

    # 历史基线更低 → 通过
    base_low = {'backend': {'lines': 58.0}}
    passed, _, _ = tr.coverage_gate(cov_ok, thr, base_low)
    assert passed, '不低于阈值与基线应通过'


def test_smoke_report_generated():
    """Q-3：--smoke 端到端生成统一报告（JSON 结构断言）"""
    code = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'scripts', 'test_report.py'), '--smoke'],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert code.returncode == 0, code.stdout + code.stderr
    assert os.path.exists(tr.REPORT_JSON), '未生成 quality_report.json'
    assert os.path.exists(tr.REPORT_HTML), '未生成 quality_report.html'
    with open(tr.REPORT_JSON, encoding='utf-8') as f:
        report = json.load(f)
    assert report['schemaVersion'] == 1
    assert 'generatedAt' in report
    assert 'summary' in report and 'passRate' in report['summary']
    assert 'coverage' in report and 'backend' in report['coverage']
    assert 'coverageGate' in report
    assert 'modules' in report and len(report['modules']) >= 2
    assert 'gates' in report and len(report['gates']) >= 3
    assert report['coverage']['backend']['lines']['pct'] > 0
    assert report['coverage']['frontend']['lines']['pct'] > 0
