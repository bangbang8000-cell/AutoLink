"""F5-3（45-a）IP 规划校验：子网/网关/IP 分配

校验维度：
  IP001 掩码/网段合法性
  IP002 子网重叠
  IP003 网关冲突（重复网关 / 网关不在所属段内）
  IP004 IP 段内分配越界
  IP005 IP 分配重复

check_ip_plan 直接校验 AIDC plan:table 的 ip_segments 与 deviceList 网关，
同时提供底层纯函数（validate_subnet / check_subnet_overlap / check_gateway_conflicts /
check_allocations）供测试与门禁复用。全部基于标准库 ipaddress，确定性可测。
"""
import ipaddress
from typing import Any, Dict, List, Optional, Sequence

from validation_engine.core import (
    ValidationProblem, SEVERITY_ERROR, SEVERITY_WARNING,
    CATEGORY_IP,
)


def validate_subnet(subnet_str: Any) -> tuple[bool, str]:
    """掩码/网段合法性校验，返回 (ok, reason)。"""
    if subnet_str is None:
        return False, '网段为空'
    s = str(subnet_str).strip()
    if not s:
        return False, '网段为空'
    if '/' not in s:
        return False, f'网段缺少掩码/前缀（应为 CIDR 如 10.1.0.0/20）: {s}'
    try:
        net = ipaddress.ip_network(s, strict=False)
    except ValueError as e:
        return False, f'网段格式非法: {e}'
    # 非严格模式允许主机位非零（如 10.1.16.1/20），这里仅校验格式；严格性交由越界检查
    if net.version != 4:
        return False, f'仅支持 IPv4 网段: {s}'
    return True, ''


def _to_network(subnet_str: Any) -> Optional[ipaddress.IPv4Network]:
    try:
        return ipaddress.ip_network(str(subnet_str).strip(), strict=False)
    except (ValueError, TypeError):
        return None


def check_subnet_overlap(subnets: Sequence[Any]) -> List[ValidationProblem]:
    """子网重叠校验：任意两网段存在地址交集即报 IP002。"""
    problems: List[ValidationProblem] = []
    nets: List[tuple[str, ipaddress.IPv4Network]] = []
    for s in subnets:
        if s is None:
            continue
        net = _to_network(s)
        if net:
            nets.append((str(s), net))
    for i, (name_a, na) in enumerate(nets):
        for name_b, nb in nets[i + 1:]:
            if na.overlaps(nb):
                problems.append(ValidationProblem(
                    rule_id='IP002',
                    severity=SEVERITY_ERROR,
                    category=CATEGORY_IP,
                    location=f'ip_segments[{name_a}] ↔ ip_segments[{name_b}]',
                    message=f'子网重叠：{name_a} 与 {name_b} 地址区间相交',
                    suggestion='调整网段划分（如增大前缀或错开地址区间），避免地址冲突',
                    data={'a': name_a, 'b': name_b},
                ))
    return problems


def check_gateway_conflicts(gateway_map: Dict[str, List[Any]]) -> List[ValidationProblem]:
    """网关冲突校验。

    gateway_map：{segment_name: [gateway_ip, ...]}（或 {segment_name: gateway_ip}）
    IP003a 同段内网关重复；IP003b 网关不在所属段内；IP003c 跨段网关重复（同一 IP 出现在多段）。
    """
    problems: List[ValidationProblem] = []
    seg_to_net: Dict[str, Optional[ipaddress.IPv4Network]] = {}
    all_gws: Dict[str, str] = {}   # ip -> segment
    for seg, gws in (gateway_map or {}).items():
        if not isinstance(gws, list):
            gws = [gws]
        net = _to_network(seg)
        seg_to_net[seg] = net
        seen_in_seg: set[str] = set()
        for gw in gws:
            if gw is None:
                continue
            ip_str = str(gw).strip()
            if not ip_str:
                continue
            # IP003a 同段重复
            if ip_str in seen_in_seg:
                problems.append(ValidationProblem(
                    rule_id='IP003',
                    severity=SEVERITY_ERROR,
                    category=CATEGORY_IP,
                    location=f'gateway.{seg}',
                    message=f'{seg} 内网关重复：{ip_str}',
                    suggestion='同段内网关地址应唯一',
                    data={'segment': seg, 'gateway': ip_str},
                ))
            seen_in_seg.add(ip_str)
            # IP003c 跨段重复
            if ip_str in all_gws and all_gws[ip_str] != seg:
                problems.append(ValidationProblem(
                    rule_id='IP003',
                    severity=SEVERITY_ERROR,
                    category=CATEGORY_IP,
                    location=f'gateway.{seg}.{ip_str}',
                    message=f'网关 {ip_str} 同时出现在 {all_gws[ip_str]} 与 {seg}',
                    suggestion='不同网段不应使用同一网关地址',
                    data={'gateway': ip_str, 'segments': [all_gws[ip_str], seg]},
                ))
            all_gws[ip_str] = seg
            # IP003b 网关不在所属段内
            if net is not None:
                try:
                    if ipaddress.ip_address(ip_str) not in net:
                        problems.append(ValidationProblem(
                            rule_id='IP003',
                            severity=SEVERITY_ERROR,
                            category=CATEGORY_IP,
                            location=f'gateway.{seg}.{ip_str}',
                            message=f'网关 {ip_str} 不在所属网段 {seg} 内',
                            suggestion=f'将网关改为 {seg} 网段内的地址',
                            data={'segment': seg, 'gateway': ip_str},
                        ))
                except ValueError:
                    problems.append(ValidationProblem(
                        rule_id='IP003',
                        severity=SEVERITY_ERROR,
                        category=CATEGORY_IP,
                        location=f'gateway.{seg}.{ip_str}',
                        message=f'网关 {ip_str} 不是合法 IPv4 地址',
                        suggestion='修正网关地址格式',
                        data={'segment': seg, 'gateway': ip_str},
                    ))
            else:
                ok, reason = validate_subnet(seg)
                if not ok:
                    problems.append(ValidationProblem(
                        rule_id='IP001',
                        severity=SEVERITY_ERROR,
                        category=CATEGORY_IP,
                        location=f'ip_segments.{seg}',
                        message=f'网关所属网段 {seg} 非法：{reason}',
                        suggestion='修正网段定义',
                        data={'segment': seg, 'reason': reason},
                    ))
    return problems


def check_allocations(allocations: Sequence[Dict[str, Any]],
                      segments: Optional[Dict[str, str]] = None) -> List[ValidationProblem]:
    """IP 分配校验。

    allocations：[{ip, segment(可选), name}] — 校验：
      IP004 越界：ip 不在其所属 segment 内（segment 缺省则校验是否落入任意已知段）
      IP005 重复：同一 IP 被分配多次
    """
    problems: List[ValidationProblem] = []
    seg_nets: Dict[str, Optional[ipaddress.IPv4Network]] = {
        k: _to_network(v) for k, v in (segments or {}).items()}
    all_nets = [n for n in seg_nets.values() if n is not None]
    seen: Dict[str, str] = {}

    for alloc in allocations or []:
        if not isinstance(alloc, dict):
            continue
        ip_str = str(alloc.get('ip') or '').strip()
        name = alloc.get('name') or alloc.get('device') or ''
        if not ip_str:
            continue
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            problems.append(ValidationProblem(
                rule_id='IP004',
                severity=SEVERITY_ERROR,
                category=CATEGORY_IP,
                location=f'allocations[{name or "?"}].ip',
                message=f'分配地址 {ip_str} 不是合法 IPv4 地址',
                suggestion='修正分配地址格式',
                data={'ip': ip_str, 'name': name},
            ))
            continue

        seg = alloc.get('segment')
        seg_key = str(seg) if seg is not None else ''
        net = None
        if seg_key:
            # segment 可能是段名（compute）或直接是 CIDR
            if seg_key in seg_nets:
                net = seg_nets[seg_key]
            else:
                net = _to_network(seg_key)
        if net is not None and ip not in net:
            problems.append(ValidationProblem(
                rule_id='IP004',
                severity=SEVERITY_ERROR,
                category=CATEGORY_IP,
                location=f'allocations[{name or "?"}].ip',
                message=f'分配地址 {ip_str} 越界：不在网段 {seg_key} 内',
                suggestion=f'将 {ip_str} 调整到 {seg_key} 地址段范围内',
                data={'ip': ip_str, 'segment': seg_key, 'name': name},
            ))
        elif not seg_key:
            # 未指定段：必须落入任意已知段
            if all_nets and not any(ip in n for n in all_nets):
                problems.append(ValidationProblem(
                    rule_id='IP004',
                    severity=SEVERITY_ERROR,
                    category=CATEGORY_IP,
                    location=f'allocations[{name or "?"}].ip',
                    message=f'分配地址 {ip_str} 不落入任何已知网段',
                    suggestion='核对分配地址与网段划分',
                    data={'ip': ip_str, 'name': name},
                ))
        # IP005 重复
        if ip_str in seen and seen[ip_str] != name:
            problems.append(ValidationProblem(
                rule_id='IP005',
                severity=SEVERITY_ERROR,
                category=CATEGORY_IP,
                location=f'allocations[].ip = {ip_str}',
                message=f'IP 重复分配：{ip_str} 同时用于 {seen[ip_str]} 与 {name}',
                suggestion='确保每个 IP 只分配给一台设备',
                data={'ip': ip_str, 'a': seen[ip_str], 'b': name},
            ))
        seen[ip_str] = name or ip_str
    return problems


def check_ip_plan(plan: Optional[Dict]) -> List[ValidationProblem]:
    """校验 AIDC plan:table 的 IP 规划（ip_segments + deviceList 网关）。"""
    problems: List[ValidationProblem] = []
    if not isinstance(plan, dict):
        return problems

    macro = plan.get('macro') if isinstance(plan.get('macro'), dict) else {}
    segments = macro.get('ipSegments') or macro.get('ip_segments') or {}
    if not isinstance(segments, dict):
        return problems

    # IP001 掩码合法性
    for seg, cidr in segments.items():
        ok, reason = validate_subnet(cidr)
        if not ok:
            problems.append(ValidationProblem(
                rule_id='IP001',
                severity=SEVERITY_ERROR,
                category=CATEGORY_IP,
                location=f'macro.ipSegments.{seg}',
                message=f'网段 {seg}={cidr} 非法：{reason}',
                suggestion='修正网段定义（IPv4 CIDR 或掩码）',
                data={'segment': seg, 'cidr': str(cidr), 'reason': reason},
            ))

    # IP002 子网重叠
    problems.extend(check_subnet_overlap(list(segments.values())))

    # IP003 网关：deviceList 中带 gateways 的设备，网关须在对应 compute 段内且不重复
    gateway_map: Dict[str, List[str]] = {}
    compute_seg = segments.get('compute') or next(iter(segments.values()), '')
    gateway_map[compute_seg] = []
    for dev in (plan.get('deviceList') or []):
        if not isinstance(dev, dict):
            continue
        gws = dev.get('gateways') or []
        if not isinstance(gws, list):
            gws = [gws]
        for gw in gws:
            if gw is not None:
                gateway_map[compute_seg].append(str(gw))
    problems.extend(check_gateway_conflicts(gateway_map))

    # IP004/IP005 分配：terminals 携带 desc 非 IP；此处从 deviceList 网关已覆盖；
    # 若 plan 含显式 allocations（扩展字段）则校验
    if 'allocations' in plan:
        problems.extend(check_allocations(plan.get('allocations'), segments))

    return problems
