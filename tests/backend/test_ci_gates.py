"""4.0.0-F0-1：AL 五门禁 CI 对等确认记录（G-1~G-6）

以代码形式固化「门禁对等确认」：断言 .github/workflows/ci.yml 中
  - E2E（Playwright）        —— G-1
  - golden 基线              —— G-2
  - 模板校验                 —— G-3
  - 性能门禁                 —— G-4
  - 渲染安全基线 grep        —— G-5
  - 版本单源 check-version   —— G-6（4.0.0-F0-2 新增）
均在 CI 中存在。任何门禁被误删，此测试即失败（回归防线）。
"""
import os
import re

CI_YML = os.path.join(os.path.dirname(__file__), '..', '..', '.github', 'workflows', 'ci.yml')

# name -> (说明, 必须出现的正则)
GATES = {
    'G-1 E2E（Playwright）': (r'playwright test', 'e2e job 调用 Playwright'),
    'G-2 golden 基线': (r'gen_golden\.py --check', '拓扑引擎结构变化即失败'),
    'G-3 模板校验': (r'validate_templates\.py', '内置模板损坏即失败'),
    'G-4 性能门禁': (r'bench_perf\.py', '2048 设计/225 落位超限即失败'),
    'G-5 渲染安全基线 grep': (r'fetch\(|XMLHttpRequest', '渲染层 0 直接网络 / 0 Node 访问'),
    'G-6 版本单源 check-version': (r'check_version\.py', '版本漂移即失败（4.0.0 新增）'),
}


def _ci_content():
    assert os.path.exists(CI_YML), f'未找到 CI 文件: {CI_YML}'
    with open(CI_YML, encoding='utf-8') as f:
        return f.read()


def test_ci_contains_all_gates():
    content = _ci_content()
    missing = [name for name, (pattern, _) in GATES.items() if not re.search(pattern, content)]
    assert not missing, f'CI 缺失门禁: {missing}'


def test_ci_has_check_version_job():
    content = _ci_content()
    assert re.search(r'^  check-version:', content, re.M), 'CI 缺少 check-version job'
    assert re.search(r'python scripts/check_version\.py', content)
