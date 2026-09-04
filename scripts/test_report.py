#!/usr/bin/env python3
"""4.6.0（F6-3）：AL 统一测试报告生成器 + 覆盖率门禁（F6-1）

聚合 pytest / vitest / golden / bench / 模板校验门禁结果 → 统一 HTML/JSON 报告
（落 reports/ 目录，本地与 CI 均可生成），并执行覆盖率门禁断言：
  - 阈值：scripts/quality_thresholds.json（只许升不许降的硬下限）
  - 基线：reports/coverage_baseline.json（历史锚点，当前低于基线即失败，容忍 0.5pt 测量噪声）

模式：
  python scripts/test_report.py                  # 全量：跑 pytest/vitest + 快门禁 → 聚合 → 报告
  python scripts/test_report.py --from-artifacts # 仅聚合已有产物（reports/*.xml|*.json）+ 跑快门禁（CI 用）
  python scripts/test_report.py --smoke          # 用内置样例数据生成冒烟报告（Q-3 测试）
  python scripts/test_report.py --update-baseline# 门禁通过后把当前覆盖率写回基线（棘轮上调，只升）
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REPORTS = os.path.join(ROOT, 'reports')
THRESHOLDS_FILE = os.path.join(ROOT, 'scripts', 'quality_thresholds.json')
BASELINE_FILE = os.path.join(REPORTS, 'coverage_baseline.json')
REPORT_JSON = os.path.join(REPORTS, 'quality_report.json')
REPORT_HTML = os.path.join(REPORTS, 'quality_report.html')

# 覆盖率容差（测量噪声）：当前值低于基线超过该幅度才判为回退
BASELINE_TOLERANCE = 0.5


def _load_json(path, default=None):
    if not path or not os.path.exists(path):
        return default
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def _save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


def _pct(num, den):
    if not den:
        return 0.0
    return round(num / den * 100, 1)


def parse_junit(path):
    """解析 JUnit XML（pytest / vitest 通用）→ 汇总统计"""
    if not path or not os.path.exists(path):
        return None
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return None
    tests = failures = errors = skipped = 0
    duration = 0.0
    for suite in root.iter('testsuite'):
        tests += int(suite.get('tests', 0) or 0)
        failures += int(suite.get('failures', 0) or 0)
        errors += int(suite.get('errors', 0) or 0)
        skipped += int(suite.get('skipped', 0) or 0)
        try:
            duration += float(suite.get('time', 0) or 0)
        except (TypeError, ValueError):
            pass
    return {
        'tests': tests, 'failures': failures, 'errors': errors,
        'skipped': skipped, 'durationMs': round(duration * 1000),
    }


def _merge_junit_stats(paths):
    """合并多个 JUnit XML 统计（5.0.3-503-c：后端分片运行，聚合主套件+样本校验）"""
    if not paths:
        return None
    total = {'tests': 0, 'failures': 0, 'errors': 0, 'skipped': 0, 'durationMs': 0.0}
    for p in paths:
        st = parse_junit(p) or {}
        for k in ('tests', 'failures', 'errors', 'skipped'):
            total[k] += int(st.get(k, 0) or 0)
        total['durationMs'] += float(st.get('durationMs', 0) or 0)
    total['durationMs'] = round(total['durationMs'])
    return total


def parse_backend_coverage(path):
    """解析 pytest-cov JSON（coverage json 导出）"""
    data = _load_json(path)
    if not data or 'totals' not in data:
        return None
    t = data['totals']
    num_branches = t.get('num_branches', 0) or 0
    covered_branches = t.get('covered_branches', 0) or 0
    return {
        'lines': {
            'pct': round(t.get('percent_covered', 0.0), 1),
            'covered': t.get('covered_lines', 0),
            'total': t.get('num_statements', 0),
        },
        'branches': {
            'pct': _pct(covered_branches, num_branches),
            'covered': covered_branches,
            'total': num_branches,
        },
    }


def parse_frontend_coverage(path):
    """解析 vitest coverage-summary.json"""
    data = _load_json(path)
    if not data or 'total' not in data:
        return None
    total = data['total']
    out = {}
    for metric in ('lines', 'statements', 'functions', 'branches'):
        m = total.get(metric) or {}
        out[metric] = {
            'pct': round(m.get('pct', 0.0), 1),
            'covered': m.get('covered', 0),
            'total': m.get('total', 0),
        }
    return out


def run_cmd(cmd, cwd=None, timeout=1800):
    """运行子进程，返回 (returncode, stdout, duration_ms)"""
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd, cwd=cwd or ROOT, capture_output=True, text=True, timeout=timeout)
        out = (proc.stdout or '') + (proc.stderr or '')
        return proc.returncode, out.strip(), round((time.monotonic() - t0) * 1000)
    except (subprocess.TimeoutExpired, OSError) as e:
        return 1, f'执行失败: {e}', round((time.monotonic() - t0) * 1000)


def _run_gate(name, cmd):
    code, out, dur = run_cmd(cmd)
    return {
        'id': name,
        'name': name,
        'passed': code == 0,
        'returncode': code,
        'durationMs': dur,
        'output': out[-1200:],
    }


def run_gates():
    """运行快门禁：golden / bench / 模板校验（均为 CI 对等门禁）"""
    gates = [
        _run_gate('golden', [sys.executable, 'scripts/gen_golden.py', '--check']),
        _run_gate('bench', [sys.executable, 'scripts/bench_perf.py', '--rounds', '1']),
        _run_gate('templates', [sys.executable, 'scripts/validate_templates.py']),
    ]
    validation = {
        'passed': gates[2]['passed'],
        'detail': gates[2]['output'][-400:],
    }
    return gates, validation


def run_backend():
    """跑后端 pytest（覆盖率 + junit 产物）"""
    return run_cmd([
        sys.executable, '-m', 'pytest', 'tests/backend', '-q',
        '--cov=backend', '--cov-report=term',
        '--cov-report=json:' + os.path.join(REPORTS, 'coverage-backend.json'),
        '--junitxml=' + os.path.join(REPORTS, 'pytest.xml'),
    ])


def run_frontend():
    """跑前端 vitest（npm run test:report：junit + coverage-summary 产物）"""
    return run_cmd(['npm', 'run', 'test:report'])


def thresholds():
    return _load_json(THRESHOLDS_FILE, {}).get('coverage', {})


def baseline():
    return _load_json(BASELINE_FILE, {})


def metric_value(scope, metric, coverage):
    if not coverage or scope not in coverage:
        return None
    m = coverage[scope].get(metric)
    if not m or 'pct' not in m:
        return None
    return float(m['pct'])


def coverage_gate(coverage, thr, base, update_baseline=False):
    """覆盖率门禁：阈值硬下限 + 基线只升不降（返回 (passed, checks, new_base)）"""
    if not coverage:
        return False, [], dict(base)
    checks = []
    passed = True
    new_base = dict(base)
    for scope, metrics in thr.items():
        cur = coverage.get(scope) or {}
        for metric, threshold in metrics.items():
            value = metric_value(scope, metric, coverage)
            if value is None:
                checks.append({
                    'scope': scope, 'metric': metric, 'value': None,
                    'threshold': threshold, 'baseline': None, 'passed': True,
                    'reason': '当前运行未产出该指标（不参与门禁）',
                })
                continue
            old = (base.get(scope) or {}).get(metric)
            floor = max(float(threshold), float(old) if old is not None else float(threshold))
            ok = value >= floor - BASELINE_TOLERANCE
            if not ok:
                passed = False
            checks.append({
                'scope': scope, 'metric': metric, 'value': value,
                'threshold': threshold,
                'baseline': old if old is not None else None,
                'floor': round(floor, 2),
                'passed': ok,
                'reason': '' if ok else f'{value}% < 下限 {floor}%（阈值 {threshold} / 基线 {old}）',
            })
            # 棘轮：只记录不低于当前值的基线（升）
            if update_baseline and (old is None or value >= float(old)):
                new_base.setdefault(scope, {})[metric] = value
    return passed, checks, new_base


def build_report(mode, coverage=None, modules=None, gates=None, validation=None,
                 coverage_checks=None, coverage_passed=True, thresholds_data=None,
                 duration_ms=0):
    """构建统一报告 dict（纯函数，供 --smoke / 测试复用）"""
    total_tests = sum((m.get('tests', 0) or 0) for m in modules or [])
    total_failed = sum((m.get('failures', 0) or 0) + (m.get('errors', 0) or 0) for m in modules or [])
    pass_rate = _pct(total_tests - total_failed, total_tests)
    return {
        'schemaVersion': 1,
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'tool': 'scripts/test_report.py',
        'mode': mode,
        'durationMs': duration_ms,
        'summary': {
            'totalTests': total_tests,
            'passed': total_tests - total_failed,
            'failed': total_failed,
            'skipped': sum(m.get('skipped', 0) or 0 for m in modules or []),
            'passRate': pass_rate,
        },
        'coverage': coverage or {},
        'coverageGate': {
            'passed': coverage_passed,
            'thresholds': thresholds_data or {},
            'baselineFile': os.path.relpath(BASELINE_FILE, ROOT),
            'checks': coverage_checks or [],
        },
        'modules': modules or [],
        'gates': gates or [],
        'validation': validation or {},
    }


def render_html(report):
    """渲染自包含 HTML 报告（无外部依赖）"""
    s = report['summary']
    cov = report['coverage']
    gate = report['coverageGate']

    def coverage_card(scope, label, metrics):
        rows = ''
        for m, val in (metrics or {}).items():
            if val is None:
                continue
            pct = val['pct']
            color = 'var(--ok)' if pct >= 70 else ('var(--warn)' if pct >= 50 else 'var(--bad)')
            rows += (
                f'<div class="metric"><span class="mname">{m}</span>'
                f'<div class="bar"><div class="fill" style="width:{min(pct,100)}%;background:{color}"></div></div>'
                f'<span class="mval">{pct}%</span>'
                f'<span class="mnum">{val["covered"]}/{val["total"]}</span></div>'
            )
        if not rows:
            rows = '<div class="muted">未采集</div>'
        return (
            f'<section class="card"><h3>{label}</h3>{rows}'
            f'<div class="gstatus {("ok" if _scope_ok(gate, scope) else "bad")}">'
            f'{"达标" if _scope_ok(gate, scope) else "未达标"}</div></section>'
        )

    def _scope_ok(gate, scope):
        checks = gate.get('checks', [])
        sc = [c for c in checks if c.get('scope') == scope]
        return bool(sc) and all(c.get('passed') for c in sc)

    rows_modules = ''.join(
        f'<tr><td>{m.get("name")}</td><td>{m.get("tests", 0)}</td>'
        f'<td>{m.get("failures", 0) + m.get("errors", 0)}</td>'
        f'<td>{m.get("skipped", 0)}</td>'
        f'<td>{m.get("passRate", 0)}%</td>'
        f'<td>{(m.get("durationMs") or 0) / 1000:.1f}s</td></tr>'
        for m in report.get('modules', []))

    rows_gates = ''.join(
        f'<tr><td>{g.get("name")}</td>'
        f'<td class="{("ok" if g.get("passed") else "bad")}">{"通过" if g.get("passed") else "失败"}</td>'
        f'<td>{(g.get("durationMs") or 0) / 1000:.1f}s</td>'
        f'<td class="muted">{g.get("output", "")[:120]}</td></tr>'
        for g in report.get('gates', []))

    v = report.get('validation', {})
    cov_html = ''
    if cov:
        cov_html = '<div class="grid2">' + \
            coverage_card('backend', '后端覆盖率（pytest）', cov.get('backend')) + \
            coverage_card('frontend', '前端覆盖率（vitest）', cov.get('frontend')) + '</div>'
    else:
        cov_html = '<section class="card"><h3>覆盖率</h3><div class="muted">未采集到覆盖率数据（请先运行 pytest --cov 与 vitest --coverage）</div></section>'

    return f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AutoLink 质量测试报告</title>
<style>
:root{{--bg:#0f1420;--card:#171e2e;--fg:#e6edf7;--muted:#8b9bb4;--ok:#34d399;--warn:#fbbf24;--bad:#f87171;--line:#26324a;}}
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);padding:24px;}}
.wrap{{max-width:960px;margin:0 auto}}
h1{{font-size:20px;margin:0 0 4px}}h2{{font-size:15px;margin:0 0 12px;color:var(--muted);font-weight:500}}
h3{{font-size:13px;margin:0 0 10px}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}@media(max-width:720px){{.grid2{{grid-template-columns:1fr}}}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}}
.badges{{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 16px}}
.badge{{padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600}}
.badge.ok{{background:rgba(52,211,153,.15);color:var(--ok)}}.badge.bad{{background:rgba(248,113,113,.15);color:var(--bad)}}
.metric{{display:grid;grid-template-columns:70px 1fr 52px 70px;align-items:center;gap:8px;margin:6px 0;font-size:12px}}
.mname{{color:var(--muted)}}.bar{{background:#0b1120;border-radius:4px;height:8px;overflow:hidden}}
.fill{{height:100%;border-radius:4px}}.mval{{font-weight:600;text-align:right}}.mnum{{color:var(--muted);font-size:11px;text-align:right}}
.gstatus{{margin-top:8px;font-size:11px;font-weight:600}}.gstatus.ok{{color:var(--ok)}}.gstatus.bad{{color:var(--bad)}}
table{{width:100%;border-collapse:collapse;font-size:12px}}
th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}}
th{{color:var(--muted);font-weight:500}}td.ok{{color:var(--ok)}}td.bad{{color:var(--bad)}}
.muted{{color:var(--muted)}}.footer{{color:var(--muted);font-size:11px;margin-top:16px;line-height:1.7}}
</style></head><body><div class="wrap">
<h1>AutoLink 质量测试报告</h1>
<h2>{report.get('generatedAt', '')} · 模式 {report.get('mode', '')} · 生成 {report.get('durationMs', 0) / 1000:.1f}s</h2>
<div class="badges">
<span class="badge {("ok" if s["passed"] else "bad")}">用例 {s["passed"]}/{s["totalTests"]} 通过（{s["passRate"]}%）</span>
<span class="badge {("ok" if gate.get("passed") else "bad")}">覆盖率门禁 {"通过" if gate.get("passed") else "未通过"}</span>
<span class="badge {("ok" if all(g.get("passed") for g in report.get("gates", [])) else "bad")}">门禁 {"全绿" if all(g.get("passed") for g in report.get("gates", [])) else "有失败"}</span>
</div>
{cov_html}
<section class="card"><h3>测试模块</h3>
<table><thead><tr><th>模块</th><th>用例</th><th>失败</th><th>跳过</th><th>通过率</th><th>耗时</th></tr></thead>
<tbody>{rows_modules or '<tr><td colspan="6" class="muted">暂无数据</td></tr>'}</tbody></table></section>
<section class="card"><h3>门禁结果</h3>
<table><thead><tr><th>门禁</th><th>结果</th><th>耗时</th><th>说明</th></tr></thead>
<tbody>{rows_gates or '<tr><td colspan="4" class="muted">暂无数据</td></tr>'}</tbody></table></section>
<section class="card"><h3>模板校验</h3>
<div class="muted">{("通过" if v.get("passed") else "未通过") if v else "未采集"} {v.get("detail", "")}</div></section>
<div class="footer">
覆盖率阈值：{json.dumps(gate.get("thresholds", {}), ensure_ascii=False)}<br>
只升不降基线：{gate.get("baselineFile", "")}（低于基线即失败，容忍 0.5pt）<br>
报告由 scripts/test_report.py 生成 · AutoLink 4.6.0（F6-3）
</div>
</div></body></html>'''


def write_report(report):
    os.makedirs(REPORTS, exist_ok=True)
    _save_json(REPORT_JSON, report)
    with open(REPORT_HTML, 'w', encoding='utf-8') as f:
        f.write(render_html(report))
    return REPORT_JSON, REPORT_HTML


def mirror_report():
    """报告镜像到 docs/user_guide/，供应用内质量仪表盘经 app.readDocFile 读取
    （dev：docs/user_guide/；打包后随 extraResources 复制到 resourcesPath/docs/）。"""
    src = REPORT_JSON
    if not os.path.exists(src):
        return None
    dst_dir = os.path.join(ROOT, 'docs', 'user_guide')
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'quality_report.json')
    with open(src, encoding='utf-8') as f:
        data = f.read()
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(data)
    return dst


def _sample_report():
    """内置样例数据（--smoke 与 Q-3 测试用，不依赖任何外部产物）"""
    cov = {
        'backend': {'lines': {'pct': 61.2, 'covered': 980, 'total': 1600},
                    'branches': {'pct': 48.0, 'covered': 240, 'total': 500}},
        'frontend': {'lines': {'pct': 54.0, 'covered': 2200, 'total': 4074},
                     'statements': {'pct': 54.0, 'covered': 2200, 'total': 4074},
                     'functions': {'pct': 47.0, 'covered': 480, 'total': 1021},
                     'branches': {'pct': 43.0, 'covered': 810, 'total': 1884}},
    }
    modules = [
        {'id': 'backend', 'name': '后端 pytest', 'tests': 1213, 'failures': 0,
         'errors': 0, 'skipped': 2, 'passRate': 100.0, 'durationMs': 45000,
         'source': 'reports/pytest.xml'},
        {'id': 'frontend', 'name': '前端 vitest', 'tests': 1150, 'failures': 0,
         'errors': 0, 'skipped': 1, 'passRate': 100.0, 'durationMs': 356000,
         'source': 'reports/vitest.xml'},
    ]
    gates = [
        {'id': 'golden', 'name': 'golden 基线', 'passed': True,
         'durationMs': 5000, 'output': '26 模板与基线一致'},
        {'id': 'bench', 'name': '性能基准', 'passed': True,
         'durationMs': 12000, 'output': '2048 GPU ≤30s / 225 柜 ≤5s 达标'},
        {'id': 'templates', 'name': '模板校验', 'passed': True,
         'durationMs': 8000, 'output': '16/16 模板通过'},
    ]
    return build_report('smoke', coverage=cov, modules=modules, gates=gates,
                        validation={'passed': True, 'detail': '16/16 模板健康'},
                        thresholds_data=thresholds())


def main():
    parser = argparse.ArgumentParser(description='AutoLink 统一测试报告生成器 + 覆盖率门禁（4.6.0/F6-3,F6-1）')
    parser.add_argument('--from-artifacts', action='store_true',
                        help='仅聚合已有产物（reports/*.xml|*.json）+ 跑快门禁（CI 用）')
    parser.add_argument('--smoke', action='store_true', help='内置样例数据生成冒烟报告（Q-3 测试）')
    parser.add_argument('--update-baseline', action='store_true', help='门禁通过后把当前覆盖率写回基线（只升）')
    args = parser.parse_args()
    t_start = time.monotonic()

    if args.smoke:
        report = _sample_report()
        js, html = write_report(report)
        print(f'smoke 报告已生成: {js}\n  {html}')
        return 0

    if args.from_artifacts:
        # CI 场景：pytest/vitest 产物由前置 test job 生成，这里只聚合
        mode = 'from-artifacts'
        backend_cov = parse_backend_coverage(os.path.join(REPORTS, 'coverage-backend.json'))
        frontend_cov = parse_frontend_coverage(os.path.join(REPORTS, 'coverage-frontend', 'coverage-summary.json'))
        modules = []
        # 5.0.3-503-c: 后端 pytest 分片运行（pytest.xml 主套件 + pytest-sample.xml 样本校验）→ 合并统计
        backend_paths = sorted(glob.glob(os.path.join(REPORTS, 'pytest*.xml')))
        backend_src = ('reports/pytest.xml + pytest-sample.xml' if len(backend_paths) > 1
                       else 'reports/pytest.xml')
        for mid, name, jpath, src in (
            ('backend', '后端 pytest', _merge_junit_stats(backend_paths) if backend_paths else None, backend_src),
            ('frontend', '前端 vitest', os.path.join(REPORTS, 'vitest.xml'), 'reports/vitest.xml'),
        ):
            st = jpath
            if isinstance(jpath, str):
                st = parse_junit(jpath)
            if st:
                st['id'] = mid
                st['name'] = name
                st['source'] = src
                st['passRate'] = _pct(st['tests'] - st['failures'] - st['errors'], st['tests'])
                modules.append(st)
            else:
                modules.append({'id': mid, 'name': name, 'tests': 0, 'failures': 0,
                                'errors': 0, 'skipped': 0, 'passRate': 0.0,
                                'durationMs': 0, 'source': src, 'missing': True})
        coverage = {}
        if backend_cov:
            coverage['backend'] = backend_cov
        if frontend_cov:
            coverage['frontend'] = frontend_cov
        gates, validation = run_gates()
        t0 = time.monotonic()
        report = build_report(mode, coverage=coverage, modules=modules, gates=gates,
                              validation=validation, thresholds_data=thresholds())
    else:
        mode = 'run'
        # 全量：跑后端 + 前端（产物 → reports/）
        os.makedirs(REPORTS, exist_ok=True)
        print('[1/2] 运行后端 pytest（覆盖率 + junit）...')
        code_backend, out_backend, dur_backend = run_backend()
        print(f'      pytest 退出码 {code_backend}（{dur_backend / 1000:.1f}s）')
        backend_cov = parse_backend_coverage(os.path.join(REPORTS, 'coverage-backend.json'))
        backend_stat = parse_junit(os.path.join(REPORTS, 'pytest.xml')) or {}
        backend_module = {
            'id': 'backend', 'name': '后端 pytest', 'source': 'reports/pytest.xml',
            'tests': backend_stat.get('tests', 0), 'failures': backend_stat.get('failures', 0),
            'errors': backend_stat.get('errors', 0), 'skipped': backend_stat.get('skipped', 0),
            'durationMs': dur_backend,
            'passRate': _pct(backend_stat.get('tests', 0) - backend_stat.get('failures', 0)
                             - backend_stat.get('errors', 0), backend_stat.get('tests', 0)),
        }
        print('[2/2] 运行前端 vitest（junit + coverage-summary）...')
        code_front, out_front, dur_front = run_frontend()
        print(f'      vitest 退出码 {code_front}（{dur_front / 1000:.1f}s）')
        frontend_cov = parse_frontend_coverage(os.path.join(REPORTS, 'coverage-frontend', 'coverage-summary.json'))
        frontend_stat = parse_junit(os.path.join(REPORTS, 'vitest.xml')) or {}
        frontend_module = {
            'id': 'frontend', 'name': '前端 vitest', 'source': 'reports/vitest.xml',
            'tests': frontend_stat.get('tests', 0), 'failures': frontend_stat.get('failures', 0),
            'errors': frontend_stat.get('errors', 0), 'skipped': frontend_stat.get('skipped', 0),
            'durationMs': dur_front,
            'passRate': _pct(frontend_stat.get('tests', 0) - frontend_stat.get('failures', 0)
                             - frontend_stat.get('errors', 0), frontend_stat.get('tests', 0)),
        }
        gates, validation = run_gates()
        coverage = {}
        if backend_cov:
            coverage['backend'] = backend_cov
        if frontend_cov:
            coverage['frontend'] = frontend_cov
        report = build_report(mode, coverage=coverage,
                              modules=[backend_module, frontend_module],
                              gates=gates, validation=validation,
                              thresholds_data=thresholds())

    # 覆盖率门禁（阈值 + 只升不降基线）
    thr = thresholds()
    base = baseline()
    gate_passed, checks, new_base = coverage_gate(
        report.get('coverage', {}), thr, base, args.update_baseline)
    report['coverageGate']['passed'] = gate_passed
    report['coverageGate']['checks'] = checks
    report['durationMs'] = round((time.monotonic() - t_start) * 1000)
    if args.update_baseline and gate_passed:
        _save_json(BASELINE_FILE, new_base)
        print(f'已更新覆盖率基线（只升）→ {BASELINE_FILE}')

    js, html = write_report(report)
    mirror_report()
    print(f'\n报告已生成: {js}\n  HTML: {html}')
    for c in checks:
        flag = 'OK ' if c.get('passed') else 'FAIL'
        print(f'  [{flag}] {c.get("scope")}.{c.get("metric")} = {c.get("value")}%'
              f'（阈值 {c.get("threshold")} / 基线 {c.get("baseline")}）'
              f'{c.get("reason", "")}')
    if not gate_passed:
        print('覆盖率门禁失败：低于阈值或低于基线（只许升不许降）')
        return 1
    print('覆盖率门禁通过（阈值 + 基线只升不降）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
