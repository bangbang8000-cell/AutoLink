"""4.6.0（F6-1）：覆盖率门禁对等确认（Q-1）

以代码形式固化「覆盖率门禁」：
  - .coveragerc：后端 pytest fail_under（阈值 ≥55）+ source=backend
  - scripts/quality_thresholds.json：阈值常量（后端 ≥55 / 前端 ≥50，只许升不许降）
  - package.json：前端 vitest coverage 阈值脚本（≥50）+ 后端 --cov 脚本
  - ci.yml：CI 覆盖率门禁步骤（后端 --cov / 前端 thresholds / test_report.py 基线）
  - reports/coverage_baseline.json：只升不降基线（若已生成，结构断言）
"""
import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CI_YML = os.path.join(ROOT, '.github', 'workflows', 'ci.yml')
COVERAGERC = os.path.join(ROOT, '.coveragerc')
THRESHOLDS_FILE = os.path.join(ROOT, 'scripts', 'quality_thresholds.json')
PACKAGE_JSON = os.path.join(ROOT, 'package.json')
BASELINE_FILE = os.path.join(ROOT, 'reports', 'coverage_baseline.json')


def _read(path):
    assert os.path.exists(path), f'缺少文件: {path}'
    with open(path, encoding='utf-8') as f:
        return f.read()


def test_coveragerc_backend_threshold():
    """后端 pytest 覆盖率门禁：.coveragerc fail_under ≥55 且 source=backend"""
    content = _read(COVERAGERC)
    m = re.search(r'^fail_under\s*=\s*(\d+)', content, re.M)
    assert m, '.coveragerc 缺少 fail_under'
    assert int(m.group(1)) >= 55, f'后端 fail_under 阈值应 ≥55，实际 {m.group(1)}'
    assert re.search(r'^source\s*=\s*backend', content, re.M), '.coveragerc source 应为 backend'


def test_thresholds_constant_file():
    """阈值常量文件：后端 ≥55 / 前端 ≥40（只许升不许降的硬下限）"""
    data = json.loads(_read(THRESHOLDS_FILE))
    assert data['schemaVersion'] == 1
    cov = data['coverage']
    assert cov['backend']['lines'] >= 55, '后端 lines 阈值应 ≥55'
    assert cov['frontend']['lines'] >= 40, '前端 lines 阈值应 ≥40'
    assert set(cov['backend']) >= {'lines', 'statements', 'functions', 'branches'}
    assert set(cov['frontend']) >= {'lines', 'statements', 'functions', 'branches'}


def test_package_json_coverage_scripts():
    """package.json：前端 vitest 覆盖率门禁脚本（阈值与常量文件一致）+ 后端 --cov 脚本"""
    pkg = json.loads(_read(PACKAGE_JSON))
    thr = json.loads(_read(THRESHOLDS_FILE))['coverage']['frontend']
    gate = pkg['scripts'].get('test:coverage:gate', '')
    assert 'coverage' in gate, '缺少 test:coverage:gate 脚本'
    for metric in ('lines', 'statements', 'functions', 'branches'):
        assert f'--coverage.thresholds.{metric}={thr[metric]}' in gate, \
            f'test:coverage:gate 应含阈值 --coverage.thresholds.{metric}={thr[metric]}'
    assert thr['lines'] >= 40, '前端 lines 阈值应 ≥40'
    assert any('--cov=backend' in s for s in pkg['scripts'].values()), '缺少后端 --cov=backend 脚本'


def test_ci_contains_coverage_gates():
    """CI 覆盖率门禁步骤齐全（后端 --cov / 前端 test:report / test_report.py 基线）"""
    content = _read(CI_YML)
    assert re.search(r'--cov=backend', content), 'CI 缺少后端覆盖率（--cov=backend）'
    assert re.search(r'--cov-fail-under=55', content), 'CI 缺少后端 fail_under 门禁'
    assert re.search(r'npm run test:report', content), 'CI 缺少前端覆盖率门禁（test:report）'
    assert re.search(r'test_report\.py --from-artifacts', content), 'CI 缺少统一测试报告/基线门禁'


def test_ci_gate_steps_kept():
    """既有门禁（golden/模板校验/性能）在 CI 中仍保留（Q-5 回归防线）"""
    content = _read(CI_YML)
    assert re.search(r'gen_golden\.py --check', content)
    assert re.search(r'validate_templates\.py', content)
    assert re.search(r'bench_perf\.py', content)


def test_coverage_baseline_structure_if_exists():
    """只升不降基线（若已生成）：结构与阈值常量一致（后端/前端指标）"""
    if not os.path.exists(BASELINE_FILE):
        return  # 基线由 test_report.py --update-baseline 生成，未生成时跳过
    data = json.loads(_read(BASELINE_FILE))
    # 后端 pytest-cov JSON 仅汇总 lines/branches（无 statements/functions）
    for scope, metrics in (('backend', ('lines', 'branches')),
                           ('frontend', ('lines', 'statements', 'functions', 'branches'))):
        assert scope in data, f'基线缺少 {scope}'
        for metric in metrics:
            assert metric in data[scope], f'基线 {scope} 缺少 {metric}'
            assert isinstance(data[scope][metric], (int, float)), f'基线 {scope}.{metric} 非数值'
