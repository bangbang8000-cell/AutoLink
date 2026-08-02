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
    """V002: 机柜功率密度校验

    V2.9.0: 阈值取 min(散热方式上限, power_limit_per_rack)，
    使机柜功率上限与 rack_config 配置一致（默认 6000W 机柜不再等 15000W 才报警）。
    """
    issues = []
    for cab in ctx.cabinets:
        power = cab.get("power_watts", 0)
        cab_name = cab.get("name", cab.get("cabinet_name", "未知"))
        cooling = cab.get("cooling_method", "air")
        cooling_threshold = {"air": 15000, "cold_plate": 60000, "immersion": 100000}.get(cooling, 15000)
        rack_limit = cab.get("power_limit") or ctx.config.get("power_limit_per_rack") or 0
        threshold = min(cooling_threshold, rack_limit) if rack_limit else cooling_threshold
        if power > threshold:
            issues.append(ValidationIssue(
                rule_id="V002",
                severity=Severity.ERROR,
                category="物理规则",
                message=f"机柜 {cab_name} 功率 {power}W 超过机柜上限 {threshold}W",
                affected_items=[cab_name],
                recommendation="升级散热方式、提高单柜功率上限或减少机柜内设备",
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


def _parse_speed_gbps(speed_str: str) -> float:
    """从速率字符串解析 Gbps 数值,如 '400G' -> 400.0"""
    if not speed_str:
        return 0.0
    s = str(speed_str).strip().upper()
    for unit, factor in (('GB', 1.0), ('G', 1.0), ('TB', 1000.0), ('T', 1000.0)):
        if s.endswith(unit):
            try:
                return float(s[:-len(unit)]) * factor
            except ValueError:
                break
    try:
        return float(s)
    except ValueError:
        return 0.0


def _rule_port_type_match(ctx: ValidationContext) -> List[ValidationIssue]:
    """V004: 端口类型匹配校验

    v2.7.2: 字段映射与 engine.py edges schema 对齐
      - 原 a_port_type/z_port_type → a_speed/z_speed (光模块速率决定端口规格)
      - 若两端光模块速率不一致,视为端口规格不匹配
    """
    issues = []
    for conn in ctx.connections:
        a_speed = conn.get("a_speed", "") or conn.get("speed", "")
        z_speed = conn.get("z_speed", "") or conn.get("speed", "")
        if a_speed and z_speed and a_speed != z_speed:
            conn_name = conn.get("name", "") or f"{conn.get('source', '')}->{conn.get('target', '')}"
            issues.append(ValidationIssue(
                rule_id="V004",
                severity=Severity.ERROR,
                category="兼容性规则",
                message=f"连接 {conn_name} 端口规格不匹配: {a_speed} vs {z_speed}",
                affected_items=[conn_name],
                recommendation="使用相同速率的光模块或添加降速协商配置",
            ))
    return issues


def _rule_speed_match(ctx: ValidationContext) -> List[ValidationIssue]:
    """V005: 速率匹配校验

    v2.7.2: 字段映射与 engine.py edges schema 对齐
      - 原 a_speed/z_speed 两端比较 → 改为校验连接速率与网络类型是否匹配
      - param 网络: 应 ≥ 100G
      - storage 网络: 应 ≥ 25G
      - biz 网络: 应 ≥ 1G
      - oob 网络: 应 ≤ 10G
    """
    issues = []
    speed_limits = {
        "param": (100.0, None),      # 参数网最低 100G
        "storage": (25.0, None),     # 存储网最低 25G
        "biz": (1.0, None),          # 业务网最低 1G
        "oob": (None, 10.0),         # OOB 网最高 10G
    }
    for conn in ctx.connections:
        net_type = conn.get("network_type", "") or conn.get("networkType", "")
        if not net_type:
            continue
        speed_str = conn.get("a_speed", "") or conn.get("speed", "")
        if not speed_str:
            continue
        speed_gbps = _parse_speed_gbps(speed_str)
        if speed_gbps <= 0:
            continue
        limits = speed_limits.get(net_type)
        if not limits:
            continue
        min_speed, max_speed = limits
        conn_name = conn.get("name", "") or f"{conn.get('source', '')}->{conn.get('target', '')}"
        if min_speed and speed_gbps < min_speed:
            issues.append(ValidationIssue(
                rule_id="V005",
                severity=Severity.WARNING,
                category="兼容性规则",
                message=f"连接 {conn_name} 速率 {speed_str} 低于 {net_type} 网络最低要求 {int(min_speed)}G",
                affected_items=[conn_name],
                recommendation=f"{net_type} 网络应使用 ≥ {int(min_speed)}G 速率",
            ))
        elif max_speed and speed_gbps > max_speed:
            issues.append(ValidationIssue(
                rule_id="V005",
                severity=Severity.WARNING,
                category="兼容性规则",
                message=f"连接 {conn_name} 速率 {speed_str} 超过 {net_type} 网络常规上限 {int(max_speed)}G",
                affected_items=[conn_name],
                recommendation=f"{net_type} 网络通常使用 ≤ {int(max_speed)}G 速率",
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


def _rule_gpu_cabinet_overload(ctx: ValidationContext) -> List[ValidationIssue]:
    """V014: GPU 高功率柜多台设备告警 (V2.9.3)

    高功率 GPU(如 DGX H100/H200 10~12KW)应独占机柜；
    若 GPU 柜含 ≥2 台设备且总功率超过上限 80%，提示建议独占。
    """
    issues = []
    for cab in ctx.cabinets:
        if cab.get("type") != "gpu":
            continue
        items = cab.get("items", [])
        if len(items) < 2:
            continue
        power = cab.get("power_watts", 0)
        limit = cab.get("power_limit") or ctx.config.get("power_limit_per_rack") or 0
        if limit and power > limit * 0.8:
            cab_name = cab.get("name", "未知")
            issues.append(ValidationIssue(
                rule_id="V014",
                severity=Severity.WARNING,
                category="物理规则",
                message=f"GPU 柜 {cab_name} 含 {len(items)} 台设备且功率 {power}W 达上限 {int(limit * 0.8)}W 以上，建议独占机柜",
                affected_items=[cab_name] + [it.get("device_name", "") for it in items],
                recommendation="高功率 GPU 服务器应独占机柜(1 台/柜)，或开启 GPU 独占策略",
            ))
    return issues


def _rule_cabinet_utilization(ctx: ValidationContext) -> List[ValidationIssue]:
    """V015: 机柜利用率过低提示 (V2.9.3)

    机柜 U 位利用率 <30% 且非空时提示，帮助发现低效机柜布局。
    """
    issues = []
    rack_type = ctx.config.get("rack_type", 42) or 42
    for cab in ctx.cabinets:
        items = cab.get("items", [])
        if not items:
            continue
        used_u = max((it.get("end_u") or 0) for it in items)
        if rack_type > 0 and used_u / rack_type < 0.3:
            cab_name = cab.get("name", "未知")
            issues.append(ValidationIssue(
                rule_id="V015",
                severity=Severity.INFO,
                category="物理规则",
                message=f"机柜 {cab_name} U 位利用率 {used_u}/{rack_type}U 低于 30%，存在布局优化空间",
                affected_items=[cab_name],
                recommendation="合并低利用率机柜设备或调整上架方案，提高机柜密度",
            ))
    return issues


def _rule_rail_consistency(ctx: ValidationContext) -> List[ValidationIssue]:
    """V007: Rail-Optimized 一致性校验

    v2.7.2: 同时支持两种字段格式
      - rail_mode == 'rail_optimized' (designer.py 实际字段)
      - rail_optimized == True (旧格式/测试用)
    """
    issues = []
    config = ctx.config
    rail_mode = config.get("rail_mode", "")
    is_rail_optimized = (rail_mode == "rail_optimized") or (config.get("rail_optimized") is True)
    if is_rail_optimized:
        num_rails = config.get("num_rails", 8) or config.get("rail_count", 8)
        ports_per_server = config.get("ports_per_server", 8) or config.get("param_ports_per_server", 8)
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
    """V009: 存储网冗余路径校验

    v2.7.2: 字段映射与 engine.py edges schema 对齐
      - 原 cable_type 含"存储" → 改为检查 network_type == 'storage' (英文枚举)
      - 原 a_end_name → 改为 source (与 edges schema 一致)
    """
    issues = []
    storage_conns = [c for c in ctx.connections
                     if c.get("network_type", "") == "storage"
                     or c.get("networkType", "") == "storage"]
    storage_servers = set()
    for c in storage_conns:
        # 服务器侧端点(source 优先,fallback 到 a_end_name)
        src = c.get("source", "") or c.get("a_end_name", "")
        if src.startswith("Server") or src.startswith("GPU服务器") or src.startswith("存储服务器") or src.startswith("通算服务器"):
            storage_servers.add(src)
    for server in storage_servers:
        server_conns = [c for c in storage_conns
                        if (c.get("source", "") or c.get("a_end_name", "")) == server]
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


# V2.7.4-T6: PUE 合规阈值（政策合规，区别于 V003 的优化目标 1.25）
PUE_COMPLIANCE_THRESHOLD = 1.3


def _rule_pue_compliance(ctx: ValidationContext) -> List[ValidationIssue]:
    """V011: PUE ≤ 1.3 合规校验（政策合规级别）

    区别于 V003（PUE > 1.25 优化目标 → WARNING），
    V011 关注政策合规阈值 1.3（如东数西算、绿色数据中心认证要求）。
    """
    issues = []
    if ctx.pue_result:
        pue = ctx.pue_result.get("pue", 0)
        if pue > PUE_COMPLIANCE_THRESHOLD:
            issues.append(ValidationIssue(
                rule_id="V011",
                severity=Severity.WARNING,
                category="合规规则",
                message=f"PUE {pue} 超过合规阈值 {PUE_COMPLIANCE_THRESHOLD}，不满足绿色数据中心认证要求",
                affected_items=[],
                recommendation="升级液冷散热、优化冷热通道隔离、提升自然冷利用率以达到 PUE ≤ 1.3 合规标准",
            ))
    return issues


# V2.7.4-T4: OCP 冷板标准接口兼容设备列表
# 符合 OCP Cold Plate Spec 的冷却液类型
_OCP_COMPATIBLE_COOLANTS = {'PG25', 'PG40', 'FC3283', 'water', '水'}


def _rule_liquid_cooling_interface(ctx: ValidationContext) -> List[ValidationIssue]:
    """V012: 液冷 OCP 冷板标准接口校验

    检查使用冷板液冷的设备是否符合 OCP 冷板标准接口规范：
    - cooling_method 为 cold_plate 时，检查冷却液类型是否为 OCP 兼容
    - 未指定冷却液类型时给 INFO 提示
    """
    issues = []
    checked = set()
    for server in ctx.servers:
        cooling_method = (server.get('cooling_method') or server.get('cooling') or '').lower()
        if cooling_method != 'cold_plate':
            continue

        device_name = server.get('name') or server.get('id') or ''
        if device_name in checked:
            continue
        checked.add(device_name)

        coolant = (server.get('coolant') or '').strip()
        if coolant and coolant not in _OCP_COMPATIBLE_COOLANTS:
            issues.append(ValidationIssue(
                rule_id="V012",
                severity=Severity.WARNING,
                category="合规规则",
                message=f"设备 {device_name} 使用冷板液冷但冷却液 {coolant} 不在 OCP 兼容列表 {sorted(_OCP_COMPATIBLE_COOLANTS)}",
                affected_items=[device_name],
                recommendation="使用 OCP Cold Plate Spec 兼容冷却液（PG25/PG40/FC3283/水）",
            ))
    return issues


# V2.7.5-T7: 信创比例阈值（百分比的设备数量占比）
DOMESTIC_RATIO_INFO = 0.3     # < 30% 时报 INFO 提示
DOMESTIC_RATIO_WARN = 0.5     # < 50% 时报 WARNING


def _rule_domestic_ratio(ctx: ValidationContext) -> List[ValidationIssue]:
    """V013: 信创比例校验

    统计拓扑中国产设备（origin='domestic'）占比，提示信创合规情况。
    - < 30%: INFO 提示国产化率偏低
    - < 50%: WARNING 建议提升国产化率
    - >= 50%: 通过
    """
    issues: List[ValidationIssue] = []
    all_devices = list(ctx.servers) + list(ctx.switches)
    if not all_devices:
        return issues

    domestic_count = 0
    imported_count = 0
    unknown_count = 0

    for dev in all_devices:
        origin = (dev.get('origin') or '').lower()
        if origin == 'domestic':
            domestic_count += 1
        elif origin == 'imported':
            imported_count += 1
        else:
            unknown_count += 1

    total = len(all_devices)
    ratio = domestic_count / total if total > 0 else 0.0

    if ratio < DOMESTIC_RATIO_WARN:
        severity = Severity.INFO if ratio < DOMESTIC_RATIO_INFO else Severity.WARNING
        issues.append(ValidationIssue(
            rule_id="V013",
            severity=severity,
            category="合规规则",
            message=f"国产设备占比 {ratio*100:.1f}% ({domestic_count}/{total})，"
                    f"进口 {imported_count}，未标注 {unknown_count}",
            affected_items=[],
            recommendation="增加国产设备（昇腾/海光/寒武纪）比例以满足信创合规要求（建议 ≥ 50%）",
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
    # V2.7.4-T6/T4: 新增合规校验规则
    engine.register_rule("V011", "合规规则", _rule_pue_compliance)
    engine.register_rule("V012", "合规规则", _rule_liquid_cooling_interface)
    # V2.7.5-T7: 信创比例校验
    engine.register_rule("V013", "合规规则", _rule_domestic_ratio)
    # V2.9.3: 机柜物理合理性校验
    engine.register_rule("V014", "物理规则", _rule_gpu_cabinet_overload)
    engine.register_rule("V015", "物理规则", _rule_cabinet_utilization)
    return engine
