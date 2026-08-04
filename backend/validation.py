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


# ====== V2.9.3-T5: 硬规则 V016-V019 ======

def _rule_server_nic_capacity(ctx: ValidationContext) -> List[ValidationIssue]:
    """V016: 服务器网卡总数 vs Leaf 下行容量

    参数网/存储网所有服务器的网卡总数不得超过 Leaf 下行口总容量，
    否则 Leaf 端口不足导致部分服务器无法接入。

    V3.0.1-T1-3: 双平面（dual_plane_stats）时按平面逐平面校验
      required_per_plane = num_servers × nics_per_server
      capacity_per_plane  = plane.leaf_count × plane.downlink_per_leaf
    """
    issues = []

    # --- 参数网：双平面按平面展开 ---
    dp_stats = ctx.config.get('dual_plane_stats')
    if dp_stats:
        num_servers = int(ctx.config.get('num_servers', 0) or 0)
        nics = int(ctx.config.get('param_nics_per_server', 8) or 8)
        required_per_plane = num_servers * nics
        for pl in dp_stats:
            capacity = int(pl.get('leaf_count', 0) or 0) * int(pl.get('downlink_per_leaf', 0) or 0)
            if capacity > 0 and required_per_plane > capacity:
                issues.append(ValidationIssue(
                    rule_id="V016",
                    severity=Severity.ERROR,
                    category="拓扑规则",
                    message=f"参数网平面{pl.get('plane', '?')}服务器网卡总数 {required_per_plane} "
                            f"超过该平面 Leaf 下行总容量 {capacity}",
                    affected_items=[f"param-plane-{pl.get('plane', '?')}"],
                    recommendation="增加该平面 Leaf 交换机数量或降低每服务器网卡数",
                ))
    else:
        # 参数网（传统四网）
        num_servers = int(ctx.config.get('num_servers', 0) or 0)
        # V3.0.2-T2-1: ZCube 每服务器参数口 = nics_per_gpu（双口混合接入）
        if (str(ctx.config.get('param_network_mode', '') or '').strip().lower()) == 'zcube':
            ports_per_server = int((ctx.config.get('zcube_stats') or {}).get('nics_per_gpu')
                                   or (ctx.config.get('param_zcube') or {}).get('nics_per_gpu') or 2)
        else:
            ports_per_server = int(ctx.config.get('param_ports_per_server', 8) or 8)
        leaf_count = int(ctx.config.get('param_leaf_count', 0) or 0)
        dl = int(ctx.config.get('param_dl', 0) or 0)
        required = num_servers * ports_per_server
        capacity = leaf_count * dl
        if capacity > 0 and required > capacity:
            issues.append(ValidationIssue(
                rule_id="V016",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"参数网服务器网卡总数 {required} 超过 Leaf 下行总容量 {capacity}",
                affected_items=["param"],
                recommendation="增加参数 Leaf 交换机数量或降低每服务器网卡数",
            ))

    # 存储网
    total_servers = int(ctx.config.get('total_servers', num_servers) or 0)
    storage_ports = int(ctx.config.get('storage_ports_per_server', 1) or 1)
    storage_leaf = int(ctx.config.get('storage_leaf_count', 0) or 0)
    storage_dl = int(ctx.config.get('storage_dl', 0) or 0)
    s_required = total_servers * storage_ports
    s_capacity = storage_leaf * storage_dl
    if s_capacity > 0 and s_required > s_capacity:
        issues.append(ValidationIssue(
            rule_id="V016",
            severity=Severity.ERROR,
            category="拓扑规则",
            message=f"存储网网卡总数 {s_required} 超过 Leaf 下行总容量 {s_capacity}",
            affected_items=["storage"],
            recommendation="增加存储 Leaf 交换机数量",
        ))
    return issues


def _rule_optical_module_match(ctx: ValidationContext) -> List[ValidationIssue]:
    """V017: 光模块封装/距离匹配校验

    - OOB 管理网为短距场景, 不应使用 MPO/AOC 光纤(长距模块), 推荐网线/铜缆
    - Scale-Up 网应使用协议专用线缆 (如 UALink-Cable)
    """
    issues = []
    for conn in ctx.connections:
        net = conn.get("network_type", "") or conn.get("networkType", "")
        cable = conn.get("cableType", "") or conn.get("cable_type", "") or ""
        src = conn.get("source", "")
        tgt = conn.get("target", "")
        name = conn.get("name", "") or f"{src}->{tgt}"
        if net == "oob" and cable.upper() in ("MPO", "AOC"):
            issues.append(ValidationIssue(
                rule_id="V017",
                severity=Severity.WARNING,
                category="兼容性规则",
                message=f"OOB 管理网链路 {name} 使用 {cable} 光纤, 短距管理网推荐网线/铜缆",
                affected_items=[name],
                recommendation="OOB 管理网改用网线/铜缆, 降低成本并匹配短距传输",
            ))
        if net == "scale_up" and cable and not cable.endswith("-Cable"):
            issues.append(ValidationIssue(
                rule_id="V017",
                severity=Severity.WARNING,
                category="兼容性规则",
                message=f"Scale-Up 链路 {name} 线缆 {cable} 与协议不匹配, 应使用协议专用线缆",
                affected_items=[name],
                recommendation="Scale-Up 网使用协议专用线缆 (如 NVLink/UALink/UB Cable)",
            ))
    return issues


def _rule_pod_domain_scale(ctx: ValidationContext) -> List[ValidationIssue]:
    """V018: Pod/域规模合理性校验

    - 参数网 Pod 服务器数不应超过单 Pod (2-tier) 容量
    - Scale-Up 单域规模不应超过协议上限 (NVLink 72 / UALink 1024 / UB 384)
    """
    issues = []

    # 参数网 Pod 规模
    servers_per_pod = int(ctx.config.get('param_servers_per_pod', 0) or 0)
    max_2tier = int(ctx.config.get('max_2tier', 0) or 0)
    if max_2tier > 0 and servers_per_pod > max_2tier:
        issues.append(ValidationIssue(
            rule_id="V018",
            severity=Severity.WARNING,
            category="拓扑规则",
            message=f"参数网 Pod 服务器数 {servers_per_pod} 超过单 Pod 容量 {max_2tier}",
            affected_items=["param"],
            recommendation=f"单个 Pod 服务器数应 ≤ {max_2tier}, 超限时应增加 Pod 数量",
        ))

    # Scale-Up 域规模
    su = ctx.config.get("scale_up")
    if su and isinstance(su, dict):
        protocol = su.get('protocol', '')
        num_gpus = int(su.get('num_gpus', 0) or 0)
        domain_limits = {'NVLink': 72, 'UALink': 1024, 'UB': 384}
        limit = domain_limits.get(protocol, 1024)
        domain_size = int(su.get('domain_size', 0) or 0) or num_gpus
        if domain_size > limit:
            issues.append(ValidationIssue(
                rule_id="V018",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"Scale-Up 域规模 {domain_size} 超过 {protocol} 协议上限 {limit}",
                affected_items=["scale_up"],
                recommendation=f"{protocol} 单域 GPU 数应 ≤ {limit}, 增大 domain_size 配置无效, 应降低单域规模",
            ))
    return issues


def _rule_total_power_supply(ctx: ValidationContext) -> List[ValidationIssue]:
    """V019: 整机房功率 vs 供电容量校验

    所有机柜总功耗不得超过总供电容量 (Σ power_limit)。
    """
    issues = []
    total_power = 0
    total_capacity = 0
    for cab in ctx.cabinets:
        # engine cabinets_ctx: 功率记录含 power_watts/power_limit, U 位记录不含
        if "power_watts" in cab:
            total_power += cab.get("power_watts", 0) or 0
            total_capacity += cab.get("power_limit", 0) or 0
    if total_capacity > 0 and total_power > total_capacity:
        issues.append(ValidationIssue(
            rule_id="V019",
            severity=Severity.ERROR,
            category="物理规则",
            message=f"整机房总功率 {total_power}W 超过供电容量 {total_capacity}W (超限 {total_power - total_capacity}W)",
            affected_items=[],
            recommendation="增加机柜数量/供电容量, 或降低设备功耗配置 (如降低功率预设)",
        ))
    return issues


def _rule_zcube_structure(ctx: ValidationContext) -> List[ValidationIssue]:
    """V020: ZCube 扁平二部图结构校验 (V3.0.2-T2-1)

    ZCube 模式（param_network_mode == 'zcube'）专属规则：
      - 无 Spine/Core 层级一致性：参数网不得出现 Spine/Core 交换机（层级一致性）
      - 端口容量：num_gpus × nics_per_gpu ≤ 2L × (switch_ports - L)
      - 下联端口不超限：每 Leaf 实际下联 GPU ≤ downlink_per_leaf（保证路径唯一性前提）
      - 双口混合接入：1 ≤ ports_to_group_a ≤ nics_per_gpu（前 p_a 口 → 组 A）
    """
    issues = []
    if (str(ctx.config.get('param_network_mode', '') or '').strip().lower()) != 'zcube':
        return issues

    num_gpus = int(ctx.config.get('num_servers', 0) or 0)
    stats = ctx.config.get('zcube_stats') or {}
    zc = ctx.config.get('param_zcube') or {}
    nics = int(stats.get('nics_per_gpu') or zc.get('nics_per_gpu') or 2)
    L = int(stats.get('leaf_count') or 0)
    switch_ports = int(stats.get('downlink_per_leaf') or 0) + L  # downlink+L=switch_ports

    # --- 层级一致性：无 Spine/Core ---
    spine_core = []
    for sw in ctx.switches:
        if sw.get('network_type') != 'param':
            continue
        if 'Spine' in sw.get('name', '') or 'Core' in sw.get('name', ''):
            spine_core.append(sw.get('name', ''))
    if spine_core:
            issues.append(ValidationIssue(
                rule_id="V020",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"ZCube 扁平二部图不允许 Spine/Core 层，但存在: {', '.join(spine_core[:5])}",
                affected_items=spine_core,
                recommendation="ZCube 模式删除参数网 Spine/Core 交换机，仅保留两组 Leaf",
            ))

    # --- 端口容量：GPU 总网卡 ≤ 两组 Leaf 总下联容量 ---
    if L > 0 and switch_ports > L:
        required = num_gpus * nics
        capacity = 2 * L * (switch_ports - L)
        if required > capacity:
            issues.append(ValidationIssue(
                rule_id="V020",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"ZCube GPU 网卡总数 {required} 超过两组 Leaf 总下联容量 {capacity} (2×{L}×{switch_ports - L})",
                affected_items=["param-zcube"],
                recommendation="增加 Leaf 数或使用更高端口密度交换机 (L×2 > num_gpus×nics/switch_ports 约束)",
            ))

    # --- 双口混合接入比例：1 ≤ p_a ≤ nics ---
    p_a = int(stats.get('ports_to_group_a') or 0)
    if p_a <= 0 or p_a > nics:
        issues.append(ValidationIssue(
            rule_id="V020",
            severity=Severity.ERROR,
            category="拓扑规则",
            message=f"ZCube 双口混合接入比例异常: 组A端口数 {p_a} 超出网卡数 {nics}",
            affected_items=["param-zcube"],
            recommendation="每 GPU 前 ceil(nics/2) 口接组 A，余口接组 B，1 ≤ 组A口数 ≤ 网卡数",
        ))

    # --- 下联端口不超限（路径唯一性前提）：统计每 Leaf 实际下联/互联数 ---
    # 每条物理链路在 edges 中双向各出现一次（c1/c2），仅按 Leaf 作为目标端计数一次
    leaf_down = {}
    leaf_inter = {}
    for conn in ctx.connections:
        if (conn.get('network_type') or conn.get('networkType', '')) != 'param':
            continue
        src, tgt = conn.get('source', ''), conn.get('target', '')
        if tgt.startswith('参数') and 'Leaf' in tgt:
            if src.startswith('参数') and 'Leaf' in src:
                leaf_inter[tgt] = leaf_inter.get(tgt, 0) + 1
            else:
                leaf_down[tgt] = leaf_down.get(tgt, 0) + 1
    downlink_per_leaf = int(stats.get('downlink_per_leaf') or 0)
    inter_per_leaf = L
    for leaf, cnt in sorted(leaf_down.items()):
        if downlink_per_leaf > 0 and cnt > downlink_per_leaf:
            issues.append(ValidationIssue(
                rule_id="V020",
                severity=Severity.ERROR,
                category="拓扑规则",
                message=f"ZCube Leaf {leaf} 下联 GPU {cnt} 超过下联容量 {downlink_per_leaf}",
                affected_items=[leaf],
                recommendation="减少该 Leaf 接入 GPU 数或增加 Leaf 数量",
            ))
    for leaf, cnt in sorted(leaf_inter.items()):
        if inter_per_leaf > 0 and cnt > inter_per_leaf:
            issues.append(ValidationIssue(
                rule_id="V020",
                severity=Severity.WARNING,
                category="拓扑规则",
                message=f"ZCube Leaf {leaf} 组间互联 {cnt} 超过对组 Leaf 数 {inter_per_leaf}",
                affected_items=[leaf],
                recommendation="组间应为全二部互联，每组 Leaf 仅与对组每个 Leaf 各连 1 条",
            ))
    return issues


def _rule_huawei_supernode_structure(ctx: ValidationContext) -> List[ValidationIssue]:
    """V021: 华为超节点结构校验 (V3.0.2-T2-3)

    华为超节点模式（param_network_mode == 'huawei_supernode'）专属规则：
      - 层级一致性：不得出现传统参数网 Leaf/Spine/Core 交换机（超节点仅 Scale-Out 交换机）
      - UB 域内全对等：network_type='ub' 边数 = num_npus × (num_npus-1) / 2
      - Scale-Out 上联：network_type='scale_out' 的 NPU 上联边数 = num_npus × scaleout_ports_per_npu
      - 域一致性：域内 NPU 数可整除（无残域导致统计异常）
    """
    issues = []
    if (str(ctx.config.get('param_network_mode', '') or '').strip().lower()) != 'huawei_supernode':
        return issues

    stats = ctx.config.get('huawei_stats') or {}
    num_npus = int(stats.get('num_npus') or 0)
    if num_npus <= 0:
        return issues

    # --- 层级一致性：无传统参数 Leaf/Spine/Core ---
    legacy_sw = [sw.get('name', '') for sw in ctx.switches
                 if ('Leaf' in sw.get('name', '') or 'Spine' in sw.get('name', ''))
                 and 'ScaleOut' not in sw.get('name', '')]
    if legacy_sw:
        issues.append(ValidationIssue(
            rule_id="V021",
            severity=Severity.ERROR,
            category="拓扑规则",
            message=f"华为超节点不允许传统参数网 Leaf/Spine 交换机，但存在: {', '.join(legacy_sw[:5])}",
            affected_items=legacy_sw,
            recommendation="华为超节点组网仅含 Scale-Out 交换机与 NPU，删除参数网 Leaf/Spine/Core",
        ))

    # --- UB 域内全对等边数与 Scale-Out 上联边数 ---
    ub_edges = 0
    so_uplink = 0
    for conn in ctx.connections:
        net = conn.get('network_type') or conn.get('networkType', '')
        if net == 'ub':
            ub_edges += 1
        elif net == 'scale_out' and str(conn.get('source', '')).startswith('NPU_'):
            so_uplink += 1
    expected_ub = num_npus * (num_npus - 1) // 2
    if ub_edges != expected_ub:
        issues.append(ValidationIssue(
            rule_id="V021",
            severity=Severity.WARNING,
            category="拓扑规则",
            message=f"华为超节点 UB 域内全对等边数 {ub_edges} ≠ 期望 {expected_ub} (N×(N-1)/2)",
            affected_items=["huawei-ub"],
            recommendation="UB 域内应全对等互联，每对 NPU 恰好一条双向链路",
        ))
    expected_so = num_npus * int(stats.get('scaleout_ports_per_npu') or 0)
    if expected_so > 0 and so_uplink != expected_so:
        issues.append(ValidationIssue(
            rule_id="V021",
            severity=Severity.WARNING,
            category="拓扑规则",
            message=f"华为超节点 Scale-Out 上联边数 {so_uplink} ≠ 期望 {expected_so} (NPU×上联口)",
            affected_items=["huawei-scaleout"],
            recommendation="每 NPU 按 scaleout_ports_per_npu 接入域内 Scale-Out 交换机",
        ))

    # --- 域一致性：域内 NPU 数可整除 ---
    npus_per_domain = int(stats.get('npus_per_domain') or 0)
    num_domains = int(stats.get('num_domains') or 0)
    if num_domains > 0 and npus_per_domain > 0 and num_npus % npus_per_domain != 0:
        issues.append(ValidationIssue(
            rule_id="V021",
            severity=Severity.WARNING,
            category="拓扑规则",
            message=f"华为超节点 NPU 总数 {num_npus} 不能被域内 NPU 数 {npus_per_domain} 整除",
            affected_items=["huawei-domains"],
            recommendation="调整 num_npus 或 ub_domain_size，使域划分无残域",
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
    # V2.9.3-T5: 硬规则 (容量/光模块/规模/供电)
    engine.register_rule("V016", "拓扑规则", _rule_server_nic_capacity)
    engine.register_rule("V017", "兼容性规则", _rule_optical_module_match)
    engine.register_rule("V018", "拓扑规则", _rule_pod_domain_scale)
    engine.register_rule("V019", "物理规则", _rule_total_power_supply)
    # V3.0.2-T2-1: ZCube 专属结构规则
    engine.register_rule("V020", "拓扑规则", _rule_zcube_structure)
    # V3.0.2-T2-3: 华为超节点专属结构规则
    engine.register_rule("V021", "拓扑规则", _rule_huawei_supernode_structure)
    return engine
