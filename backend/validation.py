"""
AutoLink V2.4 — 规则校验引擎
对网络设计方案进行多维度规则校验，输出问题列表和修复建议。

校验维度：
  1. 拓扑规则：收敛比、端口利用率、Rail 一致性
  2. 物理规则：机柜功率密度、U位冲突
  3. 网络规则：冗余路径、管理网可达性
  4. 散热规则：PUE 达标、散热方式匹配
  5. 兼容性规则：光模块速率匹配、端口类型匹配
"""
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, field
from enum import Enum


class Severity(Enum):
    ERROR = "error"        # 严重错误，必须修复
    WARNING = "warning"    # 警告，建议修复
    INFO = "info"          # 提示信息


@dataclass
class ValidationIssue:
    """校验问题"""
    rule_id: str                # 规则 ID
    severity: Severity          # 严重程度
    category: str               # 分类
    message: str                # 问题描述
    affected_items: List[str]   # 受影响的项目
    recommendation: str         # 修复建议


@dataclass
class ValidationContext:
    """校验上下文"""
    servers: List[Dict] = field(default_factory=list)
    switches: List[Dict] = field(default_factory=list)
    connections: List[Dict] = field(default_factory=list)
    cabinets: List[Dict] = field(default_factory=list)
    config: Dict = field(default_factory=dict)
    pue_result: Optional[Dict] = None
    convergence_results: Dict = field(default_factory=dict)


# 规则函数类型
RuleFunc = Callable[[ValidationContext], List[ValidationIssue]]


class ValidationEngine:
    """规则校验引擎"""

    def __init__(self):
        self._rules: List[tuple[str, str, RuleFunc]] = []

    def register_rule(self, rule_id: str, category: str, func: RuleFunc):
        """注册校验规则"""
        self._rules.append((rule_id, category, func))

    def validate(self, ctx: ValidationContext) -> List[ValidationIssue]:
        """执行所有校验规则"""
        issues: List[ValidationIssue] = []
        for rule_id, category, func in self._rules:
            try:
                results = func(ctx)
                for r in results:
                    if not r.rule_id:
                        r.rule_id = rule_id
                    if not r.category:
                        r.category = category
                    issues.append(r)
            except Exception as e:
                issues.append(ValidationIssue(
                    rule_id=rule_id,
                    severity=Severity.ERROR,
                    category=category,
                    message=f"规则执行异常: {e}",
                    affected_items=[],
                    recommendation="请联系开发人员检查规则实现",
                ))
        return issues

    def get_rule_count(self) -> int:
        return len(self._rules)


# ====== 内置校验规则 ======

def _rule_convergence_ratio(ctx: ValidationContext) -> List[ValidationIssue]:
    """V001: 收敛比校验"""
    issues = []
    for net_type, result in ctx.convergence_results.items():
        if not result.get("meets_target", True):
            ratio = result.get("convergence_ratio", 0)
            target = result.get("target_ratio", 1)
            issues.append(ValidationIssue(
                rule_id="V001",
                severity=Severity.WARNING,
                category="拓扑规则",
                message=f"{net_type}网络收敛比 {ratio}:1 超过目标 {target}:1",
                affected_items=[net_type],
                recommendation=f"增加{net_type}网上行端口或减少下行接入",
            ))
    return issues


def _rule_cabinet_power(ctx: ValidationContext) -> List[ValidationIssue]:
    """V002: 机柜功率密度校验"""
    issues = []
    for cab in ctx.cabinets:
        power = cab.get("power_watts", 0)
        cab_name = cab.get("name", cab.get("cabinet_name", "未知"))
        cooling = cab.get("cooling_method", "air")
        threshold = {"air": 15000, "cold_plate": 60000, "immersion": 100000}.get(cooling, 15000)
        if power > threshold:
            issues.append(ValidationIssue(
                rule_id="V002",
                severity=Severity.ERROR,
                category="物理规则",
                message=f"机柜 {cab_name} 功率 {power}W 超过 {cooling} 散热上限 {threshold}W",
                affected_items=[cab_name],
                recommendation="升级散热方式或减少机柜内设备",
            ))
    return issues


def _rule_pue_target(ctx: ValidationContext) -> List[ValidationIssue]:
    """V003: PUE 达标校验"""
    issues = []
    if ctx.pue_result:
        pue = ctx.pue_result.get("pue", 0)
        if pue > 1.25:
            issues.append(ValidationIssue(
                rule_id="V003",
                severity=Severity.WARNING,
                category="散热规则",
                message=f"PUE {pue} 超过 1.25 目标",
                affected_items=[],
                recommendation=ctx.pue_result.get("recommendation", "优化制冷系统"),
            ))
    return issues


def _rule_port_type_match(ctx: ValidationContext) -> List[ValidationIssue]:
    """V004: 端口类型匹配校验"""
    issues = []
    port_type_map = {
        "QSFP56": "QSFP56", "QSFP-DD": "QSFP-DD", "OSFP": "OSFP", "OSFP-XD": "OSFP-XD",
        "SFP28": "SFP28", "SFP56": "SFP56", "RJ45": "RJ45",
    }
    for conn in ctx.connections:
        a_port = conn.get("a_port_type", "")
        z_port = conn.get("z_port_type", "")
        if a_port and z_port and a_port != z_port:
            a_normalized = port_type_map.get(a_port, a_port)
            z_normalized = port_type_map.get(z_port, z_port)
            if a_normalized != z_normalized:
                issues.append(ValidationIssue(
                    rule_id="V004",
                    severity=Severity.ERROR,
                    category="兼容性规则",
                    message=f"连接 {conn.get('name', '')} 端口类型不匹配: {a_port} vs {z_port}",
                    affected_items=[conn.get("name", "")],
                    recommendation="使用匹配的端口类型或添加转接模块",
                ))
    return issues


def _rule_speed_match(ctx: ValidationContext) -> List[ValidationIssue]:
    """V005: 速率匹配校验"""
    issues = []
    for conn in ctx.connections:
        a_speed = conn.get("a_speed", "")
        z_speed = conn.get("z_speed", "")
        if a_speed and z_speed and a_speed != z_speed:
            issues.append(ValidationIssue(
                rule_id="V005",
                severity=Severity.WARNING,
                category="兼容性规则",
                message=f"连接 {conn.get('name', '')} 速率不匹配: {a_speed} vs {z_speed}",
                affected_items=[conn.get("name", "")],
                recommendation="确保两端速率一致或配置降速协商",
            ))
    return issues


def _rule_u_position_conflict(ctx: ValidationContext) -> List[ValidationIssue]:
    """V006: U位冲突校验"""
    issues = []
    cab_u_map: Dict[str, List[tuple[str, int, int]]] = {}
    for cab in ctx.cabinets:
        cab_name = cab.get("name", cab.get("cabinet_name", "未知"))
        start_u = cab.get("start_u", 0)
        end_u = cab.get("end_u", 0)
        dev_name = cab.get("device_name", "未知设备")
        if start_u and end_u:
            if cab_name not in cab_u_map:
                cab_u_map[cab_name] = []
            cab_u_map[cab_name].append((dev_name, start_u, end_u))

    for cab_name, items in cab_u_map.items():
        for i, (name1, s1, e1) in enumerate(items):
            for name2, s2, e2 in items[i+1:]:
                if s1 <= e2 and s2 <= e1:
                    issues.append(ValidationIssue(
                        rule_id="V006",
                        severity=Severity.ERROR,
                        category="物理规则",
                        message=f"机柜 {cab_name} U位冲突: {name1}(U{s1}-U{e1}) 与 {name2}(U{s2}-U{e2})",
                        affected_items=[cab_name, name1, name2],
                        recommendation="调整设备U位分配，消除重叠",
                    ))
    return issues


def _rule_rail_consistency(ctx: ValidationContext) -> List[ValidationIssue]:
    """V007: Rail-Optimized 一致性校验"""
    issues = []
    config = ctx.config
    if config.get("rail_optimized"):
        num_rails = config.get("num_rails", 8)
        ports_per_server = config.get("ports_per_server", 8)
        if ports_per_server != num_rails:
            issues.append(ValidationIssue(
                rule_id="V007",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"Rail-Optimized 模式下端口数({ports_per_server})与Rail数({num_rails})不匹配",
                affected_items=[],
                recommendation=f"确保每服务器参数网卡数 = Rail 数 = {num_rails}",
            ))
    return issues


def _rule_oob_reachability(ctx: ValidationContext) -> List[ValidationIssue]:
    """V008: 带外管理网可达性校验"""
    issues = []
    if not ctx.config.get("oob_enabled", True):
        return issues
    oob_switches = [s for s in ctx.switches if s.get("network_type") == "oob"]
    if len(oob_switches) == 0:
        issues.append(ValidationIssue(
            rule_id="V008",
            severity=Severity.WARNING,
            category="网络规则",
            message="带外管理网未配置交换机，无法实现 BMC 远程管理",
            affected_items=[],
            recommendation="添加带外管理交换机以支持远程管理",
        ))
    return issues


def _rule_storage_redundancy(ctx: ValidationContext) -> List[ValidationIssue]:
    """V009: 存储网冗余路径校验"""
    issues = []
    storage_conns = [c for c in ctx.connections if "存储" in c.get("cable_type", "")]
    storage_servers = set()
    for c in storage_conns:
        if c.get("a_end_name", "").startswith("Server"):
            storage_servers.add(c["a_end_name"])
    for server in storage_servers:
        server_conns = [c for c in storage_conns if c.get("a_end_name") == server]
        if len(server_conns) < 2:
            issues.append(ValidationIssue(
                rule_id="V009",
                severity=Severity.WARNING,
                category="网络规则",
                message=f"服务器 {server} 存储网连接数不足({len(server_conns)})，无冗余路径",
                affected_items=[server],
                recommendation="存储网应至少双链路上联以保证冗余",
            ))
    return issues


def _rule_param_oversubscription(ctx: ValidationContext) -> List[ValidationIssue]:
    """V010: 参数网过载校验"""
    issues = []
    param_result = ctx.convergence_results.get("param", {})
    if param_result:
        ratio = param_result.get("convergence_ratio", 1)
        if ratio > 1.5:
            issues.append(ValidationIssue(
                rule_id="V010",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"参数网收敛比 {ratio}:1 严重过高，影响 AI 训练性能",
                affected_items=["param"],
                recommendation="参数网应保持 1:1 无阻塞设计，增加 Spine 层交换机",
            ))
    return issues


def create_default_engine() -> ValidationEngine:
    """创建默认校验引擎（包含所有内置规则）"""
    engine = ValidationEngine()
    engine.register_rule("V001", "拓扑规则", _rule_convergence_ratio)
    engine.register_rule("V002", "物理规则", _rule_cabinet_power)
    engine.register_rule("V003", "散热规则", _rule_pue_target)
    engine.register_rule("V004", "兼容性规则", _rule_port_type_match)
    engine.register_rule("V005", "兼容性规则", _rule_speed_match)
    engine.register_rule("V006", "物理规则", _rule_u_position_conflict)
    engine.register_rule("V007", "拓扑规则", _rule_rail_consistency)
    engine.register_rule("V008", "网络规则", _rule_oob_reachability)
    engine.register_rule("V009", "网络规则", _rule_storage_redundancy)
    engine.register_rule("V010", "拓扑规则", _rule_param_oversubscription)
    return engine
