"""4.5 数据准确性与校验体系（AL 4.5.0，F5-1~F5-5）

统一校验引擎：
  - core          结构化校验问题/报告模型（severity/category/location/suggestion）
  - consistency   一致性校验（规划↔设计 / 设计内部 / 设计→渲染）
  - export_check  导出数据核对（渲染批次产物 vs 设计/规划）
  - ip_check      IP 规划校验（子网重叠/网关冲突/越界/重复/掩码）
  - ai_accuracy   AI 规划器准确性校验（建议声称值 vs 后端真实计算）
  - runner        一键执行 + 校验报告导出（JSON）

典型用法：
    from validation_engine import run_all_validation, build_design_dict, export_report_json
    report = run_all_validation(plan=plan, designer=designer, batch_dir='output/v1_xxx')
    export_report_json(report, 'validation_report.json')
"""
from validation_engine.core import (
    ValidationProblem, ValidationReport, SEVERITY_ERROR, SEVERITY_WARNING, SEVERITY_INFO,
)
from validation_engine.consistency import (
    check_plan_design_consistency, check_design_internal_consistency,
    check_render_consistency, run_consistency_checks,
    plan_gpu_count, plan_role_counts,
)
from validation_engine.export_check import (
    collect_batch_stats, check_export_batch, check_export_content,
)
from validation_engine.ip_check import (
    check_ip_plan, validate_subnet, check_subnet_overlap,
    check_gateway_conflicts, check_allocations,
)
from validation_engine.ai_accuracy import (
    check_suggestion_accuracy, check_optimization_suggestions, check_ai_plan_claims,
    designer_convergence,
)
from validation_engine.runner import (
    build_design_dict, run_all_validation, export_report_json, build_render_dict,
)

__all__ = [
    'ValidationProblem', 'ValidationReport',
    'SEVERITY_ERROR', 'SEVERITY_WARNING', 'SEVERITY_INFO',
    'check_plan_design_consistency', 'check_design_internal_consistency',
    'check_render_consistency', 'run_consistency_checks',
    'plan_gpu_count', 'plan_role_counts',
    'collect_batch_stats', 'check_export_batch', 'check_export_content',
    'check_ip_plan', 'validate_subnet', 'check_subnet_overlap',
    'check_gateway_conflicts', 'check_allocations',
    'check_suggestion_accuracy', 'check_optimization_suggestions', 'check_ai_plan_claims',
    'designer_convergence',
    'build_design_dict', 'run_all_validation', 'export_report_json', 'build_render_dict',
]
