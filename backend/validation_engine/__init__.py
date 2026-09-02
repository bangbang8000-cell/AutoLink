"""4.5 数据准确性与校验体系（AL 4.5.0，F5-1~F5-5）

统一校验引擎：
  - core          结构化校验问题/报告模型（severity/category/location/suggestion）
  - consistency   一致性校验（规划↔设计 / 设计内部 / 设计→渲染）
  - export_check  导出数据核对（渲染批次产物 vs 设计/规划）
  - ip_check      IP 规划校验（子网重叠/网关冲突/越界/重复/掩码）

典型用法：
    from validation_engine import check_plan_design_consistency, check_export_batch, check_ip_plan
"""
from validation_engine.core import (
    ValidationProblem, ValidationReport, SEVERITY_ERROR, SEVERITY_WARNING, SEVERITY_INFO,
)
from validation_engine.consistency import (
    check_plan_design_consistency, check_design_internal_consistency,
    check_render_consistency, run_consistency_checks,
    plan_gpu_count, plan_role_counts,
)
from validation_engine.export_check import collect_batch_stats, check_export_batch
from validation_engine.ip_check import (
    check_ip_plan, validate_subnet, check_subnet_overlap,
    check_gateway_conflicts, check_allocations,
)

__all__ = [
    'ValidationProblem', 'ValidationReport',
    'SEVERITY_ERROR', 'SEVERITY_WARNING', 'SEVERITY_INFO',
    'check_plan_design_consistency', 'check_design_internal_consistency',
    'check_render_consistency', 'run_consistency_checks',
    'plan_gpu_count', 'plan_role_counts',
    'collect_batch_stats', 'check_export_batch',
    'check_ip_plan', 'validate_subnet', 'check_subnet_overlap',
    'check_gateway_conflicts', 'check_allocations',
]
