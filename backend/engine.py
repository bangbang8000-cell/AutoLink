"""
AutoLink V2.1 - Python Engine
统一引擎接口，供 Electron 主进程通过子进程调用
通过 stdin 接收 JSON 请求，stdout 返回 JSON 响应
支持 project_config.json (V2.1) 和 network_config.ini (V2.0) 两种格式

V2.7.6-T7: action 处理改为 decorator 注册(@register_action('design'))
  - 新增 action 不需改 main() 主逻辑
  - 通过 @register_action('xxx') 装饰 handler 即可自动注册
"""

import sys
import json
import os
import datetime

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from designer import NetworkDesignerV2
from exporter import (
    export_all_connections, generate_summary_data, generate_device_list,
    export_cabling_guide, export_bom, generate_report_data, export_pdf_report,
)
from estimation import (
    estimate_pue, calc_convergence_ratio, estimate_cabinet_power_density,
    PUEInput,
)
from validation import create_default_engine, ValidationContext, Severity
import pandas as pd


# ================================================================
# V2.7.6-T7: Action 注册表
# ================================================================

# 全局 action 注册表: action_name -> handler callable
_ACTION_REGISTRY: dict[str, callable] = {}


def register_action(name: str):
    """Action 注册装饰器

    用法:
        @register_action('design')
        def handle_design(params):
            ...

    注册后, main() 会自动从 _ACTION_REGISTRY 查找并派发对应 handler。

    Args:
        name: action 名称 (如 'design' / 'validate' / 'export')

    Returns:
        装饰器函数
    """
    def decorator(func):
        if name in _ACTION_REGISTRY:
            print(f"[Engine] 警告: action '{name}' 已注册, 将被覆盖", file=sys.stderr)
        _ACTION_REGISTRY[name] = func
        return func
    return decorator


def get_action_handler(name: str):
    """获取已注册的 action handler

    Args:
        name: action 名称

    Returns:
        handler 函数, 未注册时返回 None
    """
    return _ACTION_REGISTRY.get(name)


def list_registered_actions() -> list:
    """列出所有已注册的 action 名称 (主要用于调试)"""
    return sorted(_ACTION_REGISTRY.keys())


def _parse_speed_gbps(speed_str: str) -> float:
    """将速率字符串（如 '400G'）解析为 Gbps 数值"""
    if not speed_str:
        return 400.0
    s = speed_str.strip().upper()
    for unit, factor in (('GB', 1.0), ('G', 1.0), ('TB', 1000.0), ('T', 1000.0)):
        if s.endswith(unit):
            try:
                return float(s[:-len(unit)]) * factor
            except ValueError:
                break
    try:
        return float(s)
    except ValueError:
        return 400.0


def _estimate_design(designer, params=None):
    """V2.4: 综合 PUE/收敛比/机柜功率密度估算

    params 可选字段：cooling_method / outdoor_temp_c / load_factor / ups_efficiency / has_free_cooling
    """
    params = params or {}

    # 1. IT 功耗
    all_switches = (
        designer.param_leaves + designer.param_spines + designer.param_cores +
        designer.storage_leaves + designer.storage_spines + designer.storage_cores +
        designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg
    )
    server_power = sum(s.power_watts or 0 for s in designer.servers)
    switch_power = sum(sw.power_watts or 0 for sw in all_switches)
    it_power_w = server_power + switch_power
    it_power_kw = round(it_power_w / 1000.0, 2)

    # 2. 机柜数量与功率密度
    # V2.9.0: 机柜数含交换机(网络柜)，来自分配结果
    cabinet_ids = {d.cabinet_id for d in all_switches + designer.servers
                   if getattr(d, 'cabinet_id', None) is not None}
    num_cabinets = len(cabinet_ids) or 1
    density = estimate_cabinet_power_density(it_power_kw, num_cabinets)

    # 3. 默认散热方式：基于功率密度自动判断
    default_cooling = density.get('recommended_cooling', 'air')

    # 4. PUE 估算
    pue_inp = PUEInput(
        it_power_kw=it_power_kw,
        cooling_method=params.get('cooling_method', default_cooling),
        outdoor_temp_c=float(params.get('outdoor_temp_c', 25.0)),
        load_factor=float(params.get('load_factor', 0.8)),
        ups_efficiency=float(params.get('ups_efficiency', 0.96)),
        has_free_cooling=bool(params.get('has_free_cooling', True)),
    )
    pue_result = estimate_pue(pue_inp)

    # 5. 收敛比（参数网/存储网/业务网）
    convergence = {}
    # 参数网
    if designer.param_leaf_count > 0:
        param_dl = getattr(designer, 'param_dl', 0) or 0
        param_ul = max(designer.param_switch_ports - param_dl, 0)
        convergence['param'] = _conv_to_dict(calc_convergence_ratio(
            'param', param_dl, param_ul,
            _parse_speed_gbps(designer.param_speed),
            designer.param_leaf_count,
        ))
    # 存储网
    if designer.storage_leaf_count > 0:
        storage_dl = getattr(designer, 'storage_dl', 0) or 0
        storage_ul = max(designer.storage_switch_ports - storage_dl, 0)
        convergence['storage'] = _conv_to_dict(calc_convergence_ratio(
            'storage', storage_dl, storage_ul,
            _parse_speed_gbps(designer.storage_speed),
            designer.storage_leaf_count,
        ))
    # 业务网
    if getattr(designer, 'biz_enabled', True) and getattr(designer, 'biz_access', None):
        biz_ports = getattr(designer, 'biz_access_ports', 48)
        biz_uplinks = getattr(designer, 'biz_access_uplinks', 8)
        biz_speed = _parse_speed_gbps(getattr(designer, 'biz_port_speed', '25G'))
        convergence['biz'] = _conv_to_dict(calc_convergence_ratio(
            'biz', biz_ports, biz_uplinks, biz_speed, len(designer.biz_access),
        ))

    return {
        'pue': {
            'pue': pue_result.pue,
            'coolingPue': pue_result.cooling_pue,
            'powerDistributionPue': pue_result.power_distribution_pue,
            'otherPue': pue_result.other_pue,
            'totalPowerKw': pue_result.total_power_kw,
            'coolingPowerKw': pue_result.cooling_power_kw,
            'upsLossKw': pue_result.ups_loss_kw,
            'estimatedCoolingMethod': pue_result.estimated_cooling_method,
            'meetsTarget': pue_result.meets_target,
            'recommendation': pue_result.recommendation,
            'itPowerKw': it_power_kw,
            'serverPowerW': server_power,
            'switchPowerW': switch_power,
        },
        'convergence': convergence,
        'cabinetDensity': density,
        # V2.9.1: 功率密度推荐散热 vs 机柜配置散热一致性
        'coolingConsistency': _check_cooling_consistency(
            default_cooling, getattr(designer, 'cooling_method', 'air')),
        'inputs': {
            'cooling_method': pue_inp.cooling_method,
            'outdoor_temp_c': pue_inp.outdoor_temp_c,
            'load_factor': pue_inp.load_factor,
            'ups_efficiency': pue_inp.ups_efficiency,
            'has_free_cooling': pue_inp.has_free_cooling,
        },
    }


def _conv_to_dict(r):
    """ConvergenceResult -> dict"""
    return {
        'networkType': r.network_type,
        'downlinkBwGbps': r.downlink_bw_gbps,
        'uplinkBwGbps': r.uplink_bw_gbps,
        'convergenceRatio': r.convergence_ratio,
        'isBlocking': r.is_blocking,
        'targetRatio': r.target_ratio,
        'meetsTarget': r.meets_target,
        'recommendation': r.recommendation,
    }


def _check_cooling_consistency(recommended, configured):
    """V2.9.1: 密度推荐散热 vs 机柜配置散热一致性提示

    配置为默认 air 时不做提示（保守默认）；显式配置非 air 且与密度推荐不一致时提示。
    """
    if not configured or configured == 'air' or recommended == configured:
        return {'consistent': True, 'message': ''}
    return {
        'consistent': False,
        'message': f"机柜配置散热方式({configured})与功率密度推荐({recommended})不一致",
        'recommended': recommended,
        'configured': configured,
    }

def _get_config_file(params):
    """获取配置文件路径，优先使用 project_config.json"""
    config_file = params.get('configFile')
    if not config_file:
        return None, "缺少 configFile 参数"

    if not os.path.exists(config_file):
        return None, f"配置文件不存在: {config_file}"

    # 如果是 JSON 项目配置，直接使用
    if config_file.endswith('.json'):
        return config_file, None

    # 如果是 INI 文件，检查同级目录是否有 project_config.json
    project_dir = os.path.dirname(config_file)
    json_config = os.path.join(project_dir, 'project_config.json')
    if os.path.exists(json_config):
        return json_config, None

    return config_file, None


@register_action('design')
def handle_design(params):
    """处理拓扑设计请求"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    summary = {
        "mode": designer.downlink_mode,
        "numServers": designer.num_servers,
        "totalServers": designer.total_servers,
        "paramLeafCount": designer.param_leaf_count,
        "paramSpineCount": designer.param_spine_count,
        "paramCoreCount": designer.param_core_count,
        "storageLeafCount": designer.storage_leaf_count,
        "storageSpineCount": designer.storage_spine_count,
        "paramSpeed": designer.param_speed,
        "storageSpeed": designer.storage_speed,
        "paramDownlink": getattr(designer, 'param_dl', 0),
        "storageDownlink": getattr(designer, 'storage_dl', 0),
        # V2.1 新增
        "networks": {
            "param_network": getattr(designer, 'param_enabled', True),
            "storage_network": getattr(designer, 'storage_enabled', True),
            "biz_network": getattr(designer, 'biz_enabled', True),
            "oob_network": getattr(designer, 'oob_enabled', True),
        },
        "rackType": getattr(designer, 'rack_type', 42),
        "powerLimitPerRack": getattr(designer, 'power_limit_per_rack', 6000),
        # V2.4.6: Rail-Optimized 模式
        "railMode": getattr(designer, 'rail_mode', 'standard'),
        "railCount": getattr(designer, 'rail_count', 8),
        # V2.7.2: 参数网协议
        "paramProtocol": getattr(designer, 'param_protocol', 'RoCE'),
    }

    # Build topology data for visualization
    nodes = []
    edges = []

    def _sw_node(sw):
        """V2.4.2: 构造交换机节点 dict，包含 layer_hint"""
        return {
            "id": sw.name,
            "type": sw.obj_type,
            "group": designer.switch_groups.get(sw.name, sw.group or ""),
            "podid": designer.podid_map.get(sw.name, sw.podid or ""),
            "layerHint": sw.layer_hint,
            "maxPorts": sw.max_ports,
            # V2.4.6: Rail 字段
            "railId": sw.rail_id,
            "railRole": sw.rail_role,
            # V2.9.0: 交换机机柜字段 (接入 rack_allocation 分配)
            "cabinetId": sw.cabinet_id,
            "cabinetName": sw.cabinet_name,
            "startU": sw.start_u,
            "endU": sw.end_u,
            "powerWatts": sw.power_watts,
            "uHeight": sw.u_height,
        }

    for server in designer.servers:
        nodes.append({
            "id": server.name, "type": "server", "group": server.group, "podid": server.podid,
            "cabinetId": server.cabinet_id, "cabinetName": server.cabinet_name,
            "startU": server.start_u, "endU": server.end_u,
            "powerWatts": server.power_watts, "uHeight": server.u_height,
            "layerHint": server.layer_hint,
            # V2.4.6: Rail 字段
            "railId": server.rail_id,
            "railRole": server.rail_role,
        })

    # V2.4.2: 输出全部 11 类交换机节点
    for sw in designer.param_leaves:
        nodes.append(_sw_node(sw))
    for sw in designer.param_spines:
        nodes.append(_sw_node(sw))
    for sw in designer.param_cores:
        nodes.append(_sw_node(sw))
    for sw in designer.storage_leaves:
        nodes.append(_sw_node(sw))
    for sw in designer.storage_spines:
        nodes.append(_sw_node(sw))
    for sw in designer.storage_cores:
        nodes.append(_sw_node(sw))
    for sw in designer.biz_access:
        nodes.append(_sw_node(sw))
    for sw in designer.biz_agg:
        nodes.append(_sw_node(sw))
    for sw in designer.oob_access:
        nodes.append(_sw_node(sw))
    for sw in designer.oob_agg:
        nodes.append(_sw_node(sw))

    # V2.4.3: 遍历 servers + 所有交换机的 connections，按 (a,z,a_port) 去重
    # 修复 Bug: 旧版只遍历 designer.servers，导致交换机间连接（Leaf-Spine/Spine-Core/Access-Agg）不可见
    all_switches = (
        designer.param_leaves + designer.param_spines + designer.param_cores +
        designer.storage_leaves + designer.storage_spines + designer.storage_cores +
        designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg
    )
    all_devices = designer.servers + all_switches
    seen_conns = set()
    for dev in all_devices:
        for conn in dev.connections:
            # 只在 a_device 侧输出一次，避免双向存储导致的重复
            if conn.a_device != dev.name:
                continue
            pair_key = tuple(sorted([conn.a_device, conn.z_device])) + (conn.a_port,)
            if pair_key in seen_conns:
                continue
            seen_conns.add(pair_key)
            edges.append({
                "source": conn.a_device,
                "target": conn.z_device,
                "speed": conn.a_module,
                "aSpeed": conn.a_module,   # v2.7.2: 供 V004 端口规格匹配校验
                "zSpeed": conn.z_module,   # v2.7.2: 供 V004 端口规格匹配校验
                "cableType": conn.cable_type,
                "description": conn.description,
                "networkType": conn.network_type,
                "network_type": conn.network_type,  # v2.7.2: 供 V005/V009 校验读取
                "aCabinetId": conn.a_cabinet_id,
                "aCabinetName": conn.a_cabinet_name,
                "aStartU": conn.a_start_u,
                "aEndU": conn.a_end_u,
                "zCabinetId": conn.z_cabinet_id,
                "zCabinetName": conn.z_cabinet_name,
                "zStartU": conn.z_start_u,
                "zEndU": conn.z_end_u,
            })

    # V2.7.2: 接入 validation.py 规则校验引擎(10 条规则结构化校验)
    validate_result = designer.validate_topology()

    # V2.7.2: 构造 ValidationContext,传入 validation.py 引擎
    # 1. 收集机柜信息(含设备 U 位用于 V006)
    # V2.9.0: 统计范围含交换机,并标注机柜类型(来自 rack_allocation 分配)
    cabinet_type_map = {cab.id: cab.type for cab in (getattr(designer, '_rack_cabinets', []) or [])}
    cabinet_map = {}
    for dev in all_devices:
        if dev.cabinet_id is None:
            continue
        cid = dev.cabinet_id
        if cid not in cabinet_map:
            cabinet_map[cid] = {
                "name": dev.cabinet_name or f"机柜{cid}",
                "type": cabinet_type_map.get(cid, 'gpu'),
                "power_watts": 0,
                "cooling_method": getattr(designer, '_default_cooling_method', 'air'),
                "items": [],
            }
        cabinet_map[cid]["power_watts"] += dev.power_watts or 0
        cabinet_map[cid]["items"].append({
            "device_name": dev.name,
            "start_u": dev.start_u or 0,
            "end_u": dev.end_u or 0,
        })

    cabinets_ctx = []
    for cid, info in cabinet_map.items():
        # V002: 机柜功率密度校验(每机柜一条记录)
        cabinets_ctx.append({
            "name": info["name"],
            "power_watts": info["power_watts"],
            "cooling_method": info["cooling_method"],
            "power_limit": getattr(designer, 'power_limit_per_rack', 6000) or 6000,
        })
        # V006: U 位冲突校验(每个设备一条记录)
        for item in info["items"]:
            cabinets_ctx.append({
                "name": info["name"],
                "device_name": item["device_name"],
                "start_u": item["start_u"],
                "end_u": item["end_u"],
            })

    # 2. 收集交换机信息(含 network_type 用于 V008)
    switches_ctx = []
    for sw in all_switches:
        # 推断交换机所属网络类型
        if sw.obj_type.startswith('param'):
            net_type = 'param'
        elif sw.obj_type.startswith('storage'):
            net_type = 'storage'
        elif sw.obj_type.startswith('oob'):
            net_type = 'oob'
        elif sw.obj_type.startswith('biz'):
            net_type = 'biz'
        else:
            net_type = ''
        switches_ctx.append({
            "name": sw.name,
            "obj_type": sw.obj_type,
            "network_type": net_type,
            "max_ports": sw.max_ports,
        })

    # 3. 构造 config 字典(用于 V007 Rail 一致性校验)
    config_ctx = {
        "rail_mode": getattr(designer, 'rail_mode', 'standard'),
        "rail_count": getattr(designer, 'rail_count', 8),
        "num_rails": getattr(designer, 'rail_count', 8),
        "param_ports_per_server": getattr(designer, 'param_ports_per_server', 8),
        "ports_per_server": getattr(designer, 'param_ports_per_server', 8),
        "oob_enabled": getattr(designer, 'oob_enabled', True),
        # V2.9.3: 机柜配置 (供 V014/V015 读取)
        "rack_type": getattr(designer, 'rack_type', 42),
        "power_limit_per_rack": getattr(designer, 'power_limit_per_rack', 6000) or 6000,
    }

    # 4. 计算 PUE/收敛比结果(供 V001/V003/V010 读取)
    try:
        estimation = _estimate_design(designer)
    except Exception as e:
        estimation = {"error": f"估算失败: {e}"}

    pue_result_ctx = estimation.get("pue") if isinstance(estimation, dict) else None
    convergence_results_ctx = estimation.get("convergence", {}) if isinstance(estimation, dict) else {}

    # 5. 调用 validation 引擎
    validation_engine = create_default_engine()
    val_ctx = ValidationContext(
        servers=[{"name": s.name, "cabinet_id": s.cabinet_id} for s in designer.servers],
        switches=switches_ctx,
        connections=edges,
        cabinets=cabinets_ctx,
        config=config_ctx,
        pue_result=pue_result_ctx,
        convergence_results=convergence_results_ctx,
    )
    rule_issues = validation_engine.validate(val_ctx)

    # V2.4.6: 旧版端口溢出校验结果(保留作为补充)
    port_overflow_issues = [
        {
            "rule_id": "PORT_OVERFLOW" if "端口溢出" in e else "CONN_COUNT",
            "severity": "error",
            "category": "拓扑校验",
            "message": e,
            "affected_items": [e.split()[0]] if e.split() else [],
            "recommendation": "调整服务器数量或交换机端口数" if "端口溢出" in e else "检查连接生成逻辑",
        }
        for e in validate_result.get("errors", [])
    ]

    # V2.7.2: 合并 validation 引擎结果 + 旧版端口溢出结果
    validation_issues = port_overflow_issues + [
        {
            "rule_id": issue.rule_id,
            "severity": issue.severity.value,
            "category": issue.category,
            "message": issue.message,
            "affected_items": issue.affected_items,
            "recommendation": issue.recommendation,
        }
        for issue in rule_issues
    ]

    # valid 字段:旧版端口溢出校验 + 新版规则校验均无 ERROR 才为 True
    has_error = any(i["severity"] == "error" for i in validation_issues)
    is_valid = validate_result["valid"] and not has_error

    # 功率评估 (V2.1新增)
    power_data = _calculate_power_summary(designer)

    return {
        "summary": summary,
        "topology": {"nodes": nodes, "edges": edges},
        "valid": is_valid,
        "validationIssues": validation_issues,
        "powerData": power_data,
        "estimation": estimation,
    }


@register_action('estimate')
def handle_estimate(params):
    """V2.4: 参数化 PUE/收敛比估算（支持用户调整散热方式等参数）"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    return _estimate_design(designer, params.get('estimateParams', {}))


@register_action('report')
def handle_report(params):
    """V2.4: 生成完整报告数据（供前端可视化展示）"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    return generate_report_data(designer)


def _calculate_power_summary(designer):
    """V2.9.0: 计算机柜功率使用情况（含交换机，机柜类型来自分配结果）"""
    cabinets = {}
    power_limit = getattr(designer, 'power_limit_per_rack', 6000) or 6000
    cabinet_type_map = {cab.id: cab.type for cab in (getattr(designer, '_rack_cabinets', []) or [])}
    all_devices = list(designer.servers) + (
        getattr(designer, 'param_leaves', []) + getattr(designer, 'param_spines', []) +
        getattr(designer, 'param_cores', []) + getattr(designer, 'storage_leaves', []) +
        getattr(designer, 'storage_spines', []) + getattr(designer, 'storage_cores', []) +
        getattr(designer, 'oob_access', []) + getattr(designer, 'oob_agg', []) +
        getattr(designer, 'biz_access', []) + getattr(designer, 'biz_agg', [])
    )
    for dev in all_devices:
        if dev.cabinet_id is None:
            continue
        cid = dev.cabinet_id
        if cid not in cabinets:
            cabinets[cid] = {
                "cabinetId": cid,
                "cabinetName": dev.cabinet_name or f"机柜{cid}",
                "type": cabinet_type_map.get(cid, 'gpu'),
                "totalPower": 0,
                "deviceCount": 0,
                "powerLimit": power_limit,
                "devices": [],
            }
        dev_power = dev.power_watts or 0
        cabinets[cid]["totalPower"] += dev_power
        cabinets[cid]["deviceCount"] += 1
        cabinets[cid]["devices"].append({
            "name": dev.name,
            "power": dev_power,
            "uHeight": dev.u_height or 1,
            "startU": dev.start_u,
            "endU": dev.end_u,
        })

    cabinet_list = []
    for cid in sorted(cabinets.keys()):
        cb = cabinets[cid]
        cb["percent"] = round(cb["totalPower"] / cb["powerLimit"] * 100, 1) if cb["powerLimit"] > 0 else 0
        cb["exceeded"] = cb["totalPower"] > cb["powerLimit"]
        cabinet_list.append(cb)

    return {
        "cabinets": cabinet_list,
        "totalRacks": len(cabinet_list),
        "totalPowerWatts": sum(c["totalPower"] for c in cabinet_list),
    }


@register_action('validate')
def handle_validate(params):
    """处理拓扑验证请求"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    result = designer.validate_topology()
    return {"valid": result["valid"]}


@register_action('migrate')
def handle_migrate(params):
    """V2.7.2-T10: 迁移 V2.0 INI 项目为 V2.1 JSON 格式

    参数:
        projectDir: 项目目录绝对路径
    返回:
        {migrated: bool, jsonPath: str | None, warnings: [str]}
    """
    from migration import migrate_project, needs_migration
    project_dir = params.get('projectDir', '')
    if not project_dir or not os.path.isdir(project_dir):
        return {"migrated": False, "warnings": ["项目目录无效"]}

    if not needs_migration(project_dir):
        return {"migrated": False, "warnings": []}

    json_path, warnings = migrate_project(project_dir)
    return {
        "migrated": json_path is not None,
        "jsonPath": json_path,
        "warnings": warnings or [],
    }


@register_action('export')
def handle_export(params):
    """处理渲染导出请求"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    output_dir = params.get('outputDir', 'output')
    output_types = params.get('outputTypes', [])

    designer = NetworkDesignerV2(config_file)
    os.makedirs(output_dir, exist_ok=True)

    results = []
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    mode = designer.downlink_mode

    if 'connections' in output_types:
        fn = os.path.join(output_dir, f"AI智算网络_{mode}模式_{ts}.xlsx")
        export_all_connections(designer, fn)
        results.append({"type": "connections", "file": fn, "status": "success"})

    if 'deviceList' in output_types:
        fn = os.path.join(output_dir, f"设备清单_{mode}模式_{ts}.xlsx")
        try:
            device_df = generate_device_list(designer)
            with pd.ExcelWriter(fn, engine='openpyxl') as writer:
                device_df.to_excel(writer, sheet_name='设备清单', index=False)
            results.append({"type": "deviceList", "file": fn, "status": "success"})
        except Exception as e:
            results.append({"type": "deviceList", "file": fn, "status": "error", "error": str(e)})

    # V2.4: 布线指导表
    if 'cablingGuide' in output_types:
        fn = os.path.join(output_dir, f"布线指导表_{mode}模式_{ts}.xlsx")
        try:
            export_cabling_guide(designer, fn)
            results.append({"type": "cablingGuide", "file": fn, "status": "success"})
        except Exception as e:
            results.append({"type": "cablingGuide", "file": fn, "status": "error", "error": str(e)})

    # V2.4: BOM 成本估算
    if 'bom' in output_types:
        fn = os.path.join(output_dir, f"BOM成本估算_{mode}模式_{ts}.xlsx")
        try:
            export_bom(designer, fn)
            results.append({"type": "bom", "file": fn, "status": "success"})
        except Exception as e:
            results.append({"type": "bom", "file": fn, "status": "error", "error": str(e)})

    # V2.4: PDF 报告数据（直接返回数据，不导出文件）
    if 'reportData' in output_types:
        try:
            report_data = generate_report_data(designer)
            results.append({"type": "reportData", "data": report_data, "status": "success"})
        except Exception as e:
            results.append({"type": "reportData", "status": "error", "error": str(e)})

    # V2.4.6: PDF 报告文件导出
    if 'pdfReport' in output_types:
        fn = os.path.join(output_dir, f"设计报告_{mode}模式_{ts}.pdf")
        try:
            export_pdf_report(designer, fn)
            results.append({"type": "pdfReport", "file": fn, "status": "success"})
        except Exception as e:
            results.append({"type": "pdfReport", "file": fn, "status": "error", "error": str(e)})

    return {
        "results": results,
        "outputDir": output_dir,
    }


def main():
    """主入口：从 stdin 读取 JSON，处理后输出到 stdout

    V2.7.6-T7: 使用 _ACTION_REGISTRY 注册表派发 action
      - 所有 handler 通过 @register_action('xxx') 装饰器自动注册
      - main() 仅负责从注册表查找并派发, 不再硬编码 action 列表
    """
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
        action = request.get('action', '')
        params = request.get('params', {})

        # V2.7.6-T7: 从注册表查找 handler
        handler = get_action_handler(action)
        if not handler:
            response = {"success": False, "error": f"未知 action: {action}"}
        else:
            result = handler(params)
            response = {"success": True, "data": result}

    except Exception as e:
        response = {"success": False, "error": str(e)}

    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
