"""4.5 校验门禁（AL 4.5.0，F5-5 可选门禁）：命令行一键校验 AIDC 项目数据准确性

用法：
  python scripts/validate_project.py <项目目录或 project_config.json> [--batch <输出批次目录>] [--json <报告路径>]

行为：
  - 读取 plan.json / project_config.json（aidc_macro）作为规划
  - 以 NetworkDesignerV2 实例化当前设计作为设计状态
  - 运行 T1 一致性 + T2 导出核对（--batch 时）+ T3 IP 规划 + T4 AI 优化建议准确性
  - 汇总打印问题（按严重度分组），存在 error 级问题 → 退出码 1（门禁阻止后续操作）

依赖 backend 包：需在仓库根目录运行（backend 目录已在 sys.path）。
"""
import argparse
import json
import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from validation_engine import (  # noqa: E402
    run_all_validation, build_design_dict, export_report_json,
)

_SEVERITY_LABEL = {'error': '❌ error', 'warning': '⚠️  warning', 'info': 'ℹ️  info'}


def load_plan(project_dir: str):
    """读取 plan.json；缺失时由 project_config.json 的 aidc_macro 重建。"""
    plan_path = os.path.join(project_dir, 'plan.json')
    if os.path.exists(plan_path):
        try:
            with open(plan_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError) as e:
            print(f'[validate] plan.json 解析失败: {e}', file=sys.stderr)
    # 由 aidc_macro 重建
    from aidc_planner import plan_aidc
    cfg_path = os.path.join(project_dir, 'project_config.json')
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            macro = cfg.get('aidc_macro') or {}
            if macro:
                return plan_aidc(macro)
        except (OSError, ValueError) as e:
            print(f'[validate] aidc_macro 读取失败: {e}', file=sys.stderr)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description='AL 4.5 数据准确性校验门禁')
    parser.add_argument('target', help='项目目录或 project_config.json 路径')
    parser.add_argument('--batch', default='', help='输出批次目录（可选，核对导出数据）')
    parser.add_argument('--json', default='', help='校验报告 JSON 落盘路径（可选）')
    args = parser.parse_args()

    target = args.target
    if target.endswith('.json'):
        project_dir = os.path.dirname(os.path.abspath(target))
    else:
        project_dir = os.path.abspath(target)

    plan = load_plan(project_dir)
    if plan is None:
        print('[validate] 未找到规划数据（plan.json / aidc_macro），仅校验设计内部一致性', file=sys.stderr)

    config_path = os.path.join(project_dir, 'project_config.json')
    designer = None
    config = None
    if os.path.exists(config_path):
        from designer import NetworkDesignerV2
        from project_config import load_project_config
        try:
            designer = NetworkDesignerV2(config_path)
            config, _err = load_project_config(config_path)
        except Exception as e:  # noqa: BLE001
            print(f'[validate] 设计实例化失败: {e}', file=sys.stderr)

    # T4 AI 优化建议准确性（只读计算）
    suggestions = []
    if config_path and os.path.exists(config_path):
        try:
            from optimization import suggest
            res = suggest({'configFile': config_path})
            if res.get('success'):
                suggestions = res['suggestions']
        except Exception:  # noqa: BLE001
            suggestions = []

    report = run_all_validation(
        plan=plan,
        designer=designer,
        config=config,
        batch_dir=args.batch or None,
        suggestions=suggestions if designer else None,
        scope={'projectDir': project_dir, 'batch': args.batch or None},
    )

    summary = report.summary()
    print(f"\n===== 校验报告（AL 4.5）: {project_dir} =====")
    print(f"通过: {'✅ 是' if summary['valid'] else '❌ 否'} | 问题总数: {summary['total']}"
          f" | error: {summary['bySeverity']['error']}"
          f" | warning: {summary['bySeverity']['warning']}"
          f" | info: {summary['bySeverity']['info']}")
    if summary['byCategory']:
        print('按类别: ' + ', '.join(f'{k}={v}' for k, v in summary['byCategory'].items()))

    for p in sorted(report.problems,
                    key=lambda x: ({'error': 0, 'warning': 1, 'info': 2}.get(x.severity, 3), x.rule_id)):
        print(f"  [{_SEVERITY_LABEL.get(p.severity, p.severity)}] {p.rule_id} {p.category} | {p.location}")
        print(f"      {p.message}")
        print(f"      建议: {p.suggestion}")

    if args.json:
        export_report_json(report, args.json)
        print(f"\n校验报告已导出: {args.json}")

    return 1 if not summary['valid'] else 0


if __name__ == '__main__':
    sys.exit(main())
