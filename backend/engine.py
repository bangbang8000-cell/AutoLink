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

# V3.0.0-T0-6/T0-7: 统一 stdio 为 UTF-8（持久 NDJSON 协议；PyInstaller 打包后不依赖环境变量）
for _stream in (sys.stdin, sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8')
    except Exception:
        pass

from designer import NetworkDesignerV2
# V3.0.0-T0-3: 网络插件注册 + 组网模式（network_mode）分派接缝
from network_plugin import register_builtin_plugins, resolve_network_mode
from topology import calc_max_2tier
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


# ================================================================
# V3.0.0-T0-3: 网络插件接线（engine 启动即注册内置插件）
# ================================================================

_PLUGINS_READY = False


def _ensure_plugins_ready() -> None:
    """幂等注册内置网络插件（main 进程与直接调用 handle_design 的测试共用）

    register_builtin_plugins() 同名覆盖注册，重复调用安全。
    """
    global _PLUGINS_READY
    if _PLUGINS_READY:
        return
    register_builtin_plugins()
    _PLUGINS_READY = True


def _validate_cluster_network_modes(config) -> list:
    """校验 clusters 各集群 network_mode 是否可处理（V3.0.0-T0-3 分派接缝）

    - 'native'  → 传统 designer 原生路径（缺省/standard/fat_tree/rail 等），放行
    - 'plugin'  → 插件注册表可处理（3.0.1+ 新组网），放行
    - 'unknown' → 未注册模式，收集错误（防止静默走错路径）
    返回错误信息列表（空 = 全部可处理）。clusters 缺失/空 = 未启用多集群，直接放行。
    """
    errors = []
    clusters = (config or {}).get('clusters') or []
    for cl in clusters:
        if not isinstance(cl, dict):
            continue
        cid = cl.get('cluster_id', '')
        mode = cl.get('network_mode')
        status = resolve_network_mode(mode)
        if status == 'unknown':
            errors.append(
                f"clusters[{cid or '?'}].network_mode='{mode}' 暂不支持"
                f"（3.0 原生支持 {sorted(resolve_network_mode.__globals__['NATIVE_NETWORK_MODES'])}）")
    return errors


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
    # V3.0.2-T2-1: ZCube 无 Spine 层，Leaf 上行口为组间互联（非收敛），跳过收敛比计算
    is_zcube = getattr(designer, 'param_network_mode', 'standard') == 'zcube'
    if designer.param_leaf_count > 0 and not is_zcube:
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


def _run_validation(designer):
    """V3.1.1-T5-6: 统一校验管线（design / validate / AI 答疑共用）

    UI、CLI、AI 三入口走同一执行路径，校验结果一致：
      - `designer.validate_topology()` 旧版端口溢出校验（errors 列表）
      - `validation.py` 引擎 22 条规则（V001-V022，每条含 rule_id/severity/
        category/message/affected_items/recommendation —— recommendation 即修复建议）

    返回: {valid, errors, validationIssues, estimation}
    """
    # V2.4.3: 统一访问器（消除 11 类硬编码聚合）
    all_switches = designer.all_switches()
    all_devices = designer.all_devices()

    # V2.4.3: 遍历 servers + 所有交换机的 connections，按 (a,z,a_port) 去重
    # 修复 Bug: 旧版只遍历 designer.servers，导致交换机间连接（Leaf-Spine/Spine-Core/Access-Agg）不可见
    edges = []
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

    # V2.7.2: 接入 validation.py 规则校验引擎(结构化校验)
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
                # 修复: designer 属性为 cooling_method（rack_config），非 _default_cooling_method
                "cooling_method": getattr(designer, 'cooling_method', 'air'),
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
        elif sw.obj_type.startswith('combined'):
            net_type = 'combined'
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
        # V2.9.3-T5: V016/V018 容量与规模校验数据
        "num_servers": designer.num_servers,
        "total_servers": designer.total_servers,
        "param_leaf_count": getattr(designer, 'param_leaf_count', 0),
        "param_dl": getattr(designer, 'param_dl', 0),
        "storage_leaf_count": getattr(designer, 'storage_leaf_count', 0),
        "storage_dl": getattr(designer, 'storage_dl', 0),
        # V3.0.2-T2-11: 交换机 1 分 2 扇出（breakout）逻辑口因子（V016 按逻辑口校验）
        "param_breakout_count": getattr(designer, 'param_breakout_count', 1),
        "storage_breakout_count": getattr(designer, 'storage_breakout_count', 1),
        "storage_ports_per_server": getattr(designer, 'storage_ports_per_server', 1),
        "param_servers_per_pod": getattr(designer, 'param_servers_per_pod', 0),
        "max_2tier": calc_max_2tier(designer.param_switch_ports, designer.param_ports_per_server),
        "scale_up": getattr(designer, 'scale_up_config', None),
        # V3.0.1-T1-3: 双平面按平面校验数据（V016 扩展）
        "param_nics_per_server": getattr(designer, 'param_nics_per_server', 8),
        "ports_per_nic": getattr(designer, 'ports_per_nic', 1),
        "dual_plane_stats": getattr(designer, 'dual_plane_stats', None),
        # V3.0.2-T2-1: ZCube 校验数据（V020）
        "param_network_mode": getattr(designer, 'param_network_mode', 'standard'),
        "param_zcube": getattr(designer, 'zcube_config', {}),
        "zcube_stats": getattr(designer, 'zcube_stats', None),
        # V3.0.2-T2-3: 华为超节点校验数据（V021）
        "huawei_stats": getattr(designer, 'huawei_stats', {}),
        # V3.0.2-T2-5: 三合一融合网校验数据（V022）
        "eth_combined": getattr(designer, 'eth_combined', False),
        "combined_leaf_count": len(getattr(designer, 'combined_leaves', [])),
        "param_spine_count": getattr(designer, 'param_spine_count', 0),
        "param_core_count": getattr(designer, 'param_core_count', 0),
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

    return {
        "valid": is_valid,
        "errors": validate_result.get("errors", []),
        "validationIssues": validation_issues,
        "estimation": estimation,
    }


@register_action('design')
def handle_design(params):
    """处理拓扑设计请求"""
    # V3.0.0-T0-3: 确保内置网络插件已注册（分派接缝就绪）
    _ensure_plugins_ready()
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    # V3.0.0-T0-3: cluster network_mode 分派校验（未知模式明确报错，防静默走错路径）
    if config_file.endswith('.json'):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                _raw_config = json.load(f)
            mode_errors = _validate_cluster_network_modes(_raw_config)
            if mode_errors:
                return {"error": "; ".join(mode_errors)}
        except (OSError, json.JSONDecodeError) as e:
            return {"error": f"读取配置失败: {e}"}

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
        # V3.0.0-T0-3: 网络域 / 集群元数据（插件化 + 正交模型输出）
        "domains": [d.to_dict() for d in getattr(designer, 'domains', [])],
        "clusters": getattr(designer, 'clusters', []),
        # V2.1 新增
        "networks": {
            "param_network": getattr(designer, 'param_enabled', True),
            "storage_network": getattr(designer, 'storage_enabled', True),
            "biz_network": getattr(designer, 'biz_enabled', True),
            "oob_network": getattr(designer, 'oob_enabled', True),
            # V3.0.2-T2-5: 三合一网卡开关（storage+biz+带内管理合一）
            "eth_combined": getattr(designer, 'eth_combined', False),
        },
        "rackType": getattr(designer, 'rack_type', 42),
        "powerLimitPerRack": getattr(designer, 'power_limit_per_rack', 6000),
        # V2.4.6: Rail-Optimized 模式
        "railMode": getattr(designer, 'rail_mode', 'standard'),
        "railCount": getattr(designer, 'rail_count', 8),
        # V2.7.2: 参数网协议
        "paramProtocol": getattr(designer, 'param_protocol', 'RoCE'),
        # V2.9.3-T2: Scale-Up 配置与统计
        "scaleUp": {
            "enabled": bool(getattr(designer, 'scale_up_config', None)),
            "config": getattr(designer, 'scale_up_config', None),
            "stats": getattr(designer, 'scale_up_stats', {}),
        },
        # V3.0.2-T2-3: 华为超节点配置与统计
        "huaweiSuperNode": {
            "enabled": getattr(designer, 'param_network_mode', '') == 'huawei_supernode',
            "config": getattr(designer, 'huawei_config', None),
            "stats": getattr(designer, 'huawei_stats', {}),
        },
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
    # V3.0.2-T2-5: 三合一融合网 Leaf 节点
    for sw in getattr(designer, 'combined_leaves', []):
        nodes.append(_sw_node(sw))
    for sw in designer.biz_access:
        nodes.append(_sw_node(sw))
    for sw in designer.biz_agg:
        nodes.append(_sw_node(sw))
    for sw in designer.oob_access:
        nodes.append(_sw_node(sw))
    for sw in designer.oob_agg:
        nodes.append(_sw_node(sw))

    # V2.9.3-T2: Scale-Up GPU 节点
    for gpu in getattr(designer, 'scale_up_gpus', []):
        nodes.append({
            "id": gpu.name, "type": gpu.obj_type, "group": gpu.group,
            "podid": gpu.podid,
            "domainId": gpu.domain_id,
            "protocol": gpu.protocol,
            "networkType": gpu.network_type,
            "network_type": gpu.network_type,
            "layerHint": gpu.layer_hint,
            "cabinetId": gpu.cabinet_id, "cabinetName": gpu.cabinet_name,
            "startU": gpu.start_u, "endU": gpu.end_u,
            "powerWatts": gpu.power_watts, "uHeight": gpu.u_height,
        })

    # V3.0.2-T2-3: 华为超节点 NPU 节点 + Scale-Out 交换机
    for npu in getattr(designer, 'huawei_npus', []):
        nodes.append({
            "id": npu.name, "type": npu.obj_type, "group": npu.group,
            "podid": npu.podid,
            "domainId": npu.domain_id,
            "protocol": npu.protocol,
            "networkType": npu.network_type,
            "network_type": npu.network_type,
            "layerHint": npu.layer_hint,
            "cabinetId": npu.cabinet_id, "cabinetName": npu.cabinet_name,
            "startU": npu.start_u, "endU": npu.end_u,
            "powerWatts": npu.power_watts, "uHeight": npu.u_height,
        })
    for sw in getattr(designer, 'huawei_scaleout_switches', []):
        nodes.append(_sw_node(sw))

    # V2.4.3: 遍历 servers + 所有交换机的 connections，按 (a,z,a_port) 去重
    # 修复 Bug: 旧版只遍历 designer.servers，导致交换机间连接（Leaf-Spine/Spine-Core/Access-Agg）不可见
    # V3.0.0-T0-3: 统一访问器（消除 11 类硬编码聚合）
    all_switches = designer.all_switches()
    all_devices = designer.all_devices()
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
                # 修复: designer 属性为 cooling_method（rack_config），非 _default_cooling_method
                "cooling_method": getattr(designer, 'cooling_method', 'air'),
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
        elif sw.obj_type.startswith('combined'):
            net_type = 'combined'
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
        # V2.9.3-T5: V016/V018 容量与规模校验数据
        "num_servers": designer.num_servers,
        "total_servers": designer.total_servers,
        "param_leaf_count": getattr(designer, 'param_leaf_count', 0),
        "param_dl": getattr(designer, 'param_dl', 0),
        "storage_leaf_count": getattr(designer, 'storage_leaf_count', 0),
        "storage_dl": getattr(designer, 'storage_dl', 0),
        # V3.0.2-T2-11: 交换机 1 分 2 扇出（breakout）逻辑口因子（V016 按逻辑口校验）
        "param_breakout_count": getattr(designer, 'param_breakout_count', 1),
        "storage_breakout_count": getattr(designer, 'storage_breakout_count', 1),
        "storage_ports_per_server": getattr(designer, 'storage_ports_per_server', 1),
        "param_servers_per_pod": getattr(designer, 'param_servers_per_pod', 0),
        "max_2tier": calc_max_2tier(designer.param_switch_ports, designer.param_ports_per_server),
        "scale_up": getattr(designer, 'scale_up_config', None),
        # V3.0.1-T1-3: 双平面按平面校验数据（V016 扩展）
        "param_nics_per_server": getattr(designer, 'param_nics_per_server', 8),
        "ports_per_nic": getattr(designer, 'ports_per_nic', 1),
        "dual_plane_stats": getattr(designer, 'dual_plane_stats', None),
        # V3.0.2-T2-1: ZCube 校验数据（V020）
        "param_network_mode": getattr(designer, 'param_network_mode', 'standard'),
        "param_zcube": getattr(designer, 'zcube_config', {}),
        "zcube_stats": getattr(designer, 'zcube_stats', None),
        # V3.0.2-T2-3: 华为超节点校验数据（V021）
        "huawei_stats": getattr(designer, 'huawei_stats', {}),
        # V3.0.2-T2-5: 三合一融合网校验数据（V022）
        "eth_combined": getattr(designer, 'eth_combined', False),
        "combined_leaf_count": len(getattr(designer, 'combined_leaves', [])),
        "param_spine_count": getattr(designer, 'param_spine_count', 0),
        "param_core_count": getattr(designer, 'param_core_count', 0),
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
    estimation = _estimate_design(designer, params.get('estimateParams', {}))
    return generate_report_data(designer, estimation)


def _calculate_power_summary(designer):
    """V2.9.0: 计算机柜功率使用情况（含交换机，机柜类型来自分配结果）"""
    cabinets = {}
    power_limit = getattr(designer, 'power_limit_per_rack', 6000) or 6000
    cabinet_type_map = {cab.id: cab.type for cab in (getattr(designer, '_rack_cabinets', []) or [])}
    # V3.0.0-T0-3: 统一访问器（保持原语义：服务器 + 交换机，不含 Scale-Up GPU）
    all_devices = designer.servers + designer.all_switch_lists()
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
    """处理拓扑验证请求（V3.1.1-T5-6: 返回完整校验问题 + 修复建议，供 AI 答疑）"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    validation = _run_validation(designer)
    return {
        "valid": validation["valid"],
        "errors": validation["errors"],
        "validationIssues": validation["validationIssues"],
    }


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


@register_action('project_config_to_ini')
def handle_project_config_to_ini(params):
    """V2.9.6-T1: 校验 project_config 并反向序列化为 network_config.ini

    参数:
        config: 完整 ProjectConfig 字典
    返回:
        {valid: bool, error: str | None, ini: str | None}
        校验失败时 valid=False 且带 error，ini 为 None
    """
    from migration import project_config_to_ini
    from project_config import validate_config
    config = params.get('config')
    if not isinstance(config, dict):
        return {"valid": False, "error": "config 必须是 JSON 对象", "ini": None}

    error = validate_config(config)
    if error:
        return {"valid": False, "error": error, "ini": None}

    try:
        ini = project_config_to_ini(config)
        return {"valid": True, "error": None, "ini": ini}
    except Exception as e:
        return {"valid": False, "error": f"INI 生成失败: {e}", "ini": None}


@register_action('room:create')
def handle_room_create(params):
    """V3.0.4-T3-1: 创建机房矩阵（默认全部 empty、无占位）

    参数:
        rows: 行命名列表，如 ['A', 'B', ..., 'O']
        cols: 列编号列表，如 [1, 2, ..., 15]
        name: 机房名称（可选，默认 '机房'）
        project: 项目名（可选，V3.1.4-T8-3 对话场景：提供则落盘到项目 room_layout.json；
                 前端调用不传 project 时仅返回矩阵 dict，行为不变；兼容 projectName 别名）
    返回:
        矩阵 dict（未传 project）；{success, matrix, issues}（传 project 时）
    """
    from room import create_default_room, MAX_MATRIX_CELLS
    rows = params.get('rows') or []
    cols = params.get('cols') or []
    if not rows or not cols:
        return {"error": "rows/cols 不能为空"}
    if len(rows) * len(cols) > MAX_MATRIX_CELLS:
        return {"error": f"矩阵规模过大（> {MAX_MATRIX_CELLS}）"}
    matrix = create_default_room(rows, cols, name=str(params.get('name') or '机房'))
    project = params.get('project') or params.get('projectName')
    if project:
        import os
        from manage import workspace_dir
        from room import LAYOUT_FILENAME, save_room_layout
        layout_path = os.path.join(workspace_dir(), str(project), LAYOUT_FILENAME)
        save_room_layout(layout_path, matrix)
        return {'success': True, 'matrix': matrix.to_dict(),
                'issues': [f'已创建并保存 {project} 机房矩阵（{len(rows)}×{len(cols)}）']}
    return matrix.to_dict()


@register_action('room:validate')
def handle_room_validate(params):
    """V3.0.4-T3-1: 校验 room_layout.json 数据（保存前防写入损坏布局）

    参数:
        layout: RoomMatrix 字典
    返回:
        {valid: bool, errors: [str]}
    """
    from room import validate_room_layout
    data = params.get('layout')
    if not isinstance(data, dict):
        return {"valid": False, "errors": ["layout 必须是 JSON 对象"]}
    errors = validate_room_layout(data)
    return {"valid": not errors, "errors": errors}


@register_action('room:optimize')
def handle_room_optimize(params):
    """V3.1.4-T8-1: 机房智能落位（约束满足 + 多目标优化：功率均衡/散热分区/网络就近/布线最短）

    参数:
        matrix: RoomMatrix 字典（优先；缺省按 project 读 room_layout.json）
        project: 项目名（matrix 缺省时读取该项目的机房矩阵；兼容 projectName 别名）
        counts: 类型→数量（对话场景，如 {gpu:120, network:60, storage:45}）
        cabinets: 具体机柜列表 [{id, type, power_watts}]（与 counts 二选一，cabinets 优先）
        objectives: 目标权重 {power_balance, thermal_zones, network_locality, shortest_cable}
        constraints: 上架约束 {powerLimitPerRack, typeDeviceMap}
        time_budget_s: 时间预算（默认 5s）；reset_existing: 是否清空已落位重排（默认 False 保留手动放置）
    返回:
        {success, placements[{position,type,cabinetId,powerWatts}], scores, issues, stats}
    """
    from room_optimizer import optimize_from_params
    params = dict(params or {})
    # AIHUB normalize_params 会把 project → projectName（历史别名），兼容两种键
    if 'projectName' in params and 'project' not in params:
        params['project'] = params['projectName']
    return optimize_from_params(params)


@register_action('room:set-type')
def handle_room_set_type(params):
    """V3.1.4-T8-3: 标记矩阵位置机柜类型（对话驱动：AI 按用户需求标记类型域，落盘到项目矩阵）

    参数:
        project: 项目名（必填；兼容 projectName 别名）
        position: 位置，如 'A1'
        type: 类型（gpu/network/storage/compute/combined/empty）
    返回:
        {success, matrix, issues}
    """
    import os
    from manage import workspace_dir
    from room import LAYOUT_FILENAME, ROOM_TYPES, load_room_layout, save_room_layout

    project = str(params.get('project') or params.get('projectName') or '').strip()
    position = str(params.get('position') or '').strip().upper()
    cell_type = str(params.get('type') or '').strip().lower()
    if not project:
        return {'success': False, 'error': '缺少参数：project（项目名）'}
    if not position:
        return {'success': False, 'error': '缺少参数：position（位置，如 A1）'}
    if cell_type not in ROOM_TYPES:
        return {'success': False, 'error': f'类型非法：{cell_type}（可选 {sorted(ROOM_TYPES)}）'}
    layout_path = os.path.join(workspace_dir(), project, LAYOUT_FILENAME)
    try:
        matrix = load_room_layout(layout_path)
    except FileNotFoundError:
        return {'success': False, 'error': f'项目 {project} 无 {LAYOUT_FILENAME}（请先创建机房矩阵）'}
    except (OSError, ValueError, TypeError) as e:
        return {'success': False, 'error': f'读取 {project} 机房矩阵失败: {e}'}
    if position not in matrix.cells:
        return {'success': False, 'error': f'矩阵位置不存在: {position}'}
    matrix.set_type(position, cell_type)
    save_room_layout(layout_path, matrix)
    return {'success': True, 'matrix': matrix.to_dict(),
            'issues': [f'已标记 {position} 类型为 {cell_type}']}


@register_action('room:place')
def handle_room_place(params):
    """V3.1.4-T8-3: 上架/移除机柜到矩阵位置（对话驱动；复用 RoomConstraints 校验并落盘）

    参数:
        project: 项目名（必填；兼容 projectName 别名）
        position: 位置，如 'A1'
        cabinet_id: 机柜 id（必填；0/null 表示移除该位置机柜）
        cabinet_type: 机柜类型（可选，提供时做类型域校验，如 gpu/network/storage/compute）
        power_watts: 机柜功率（可选，用于单柜功率上限校验）
        constraints: 上架约束 {powerLimitPerRack, typeDeviceMap}（可选）
    返回:
        {success, matrix, issues}
    """
    import os
    from manage import workspace_dir
    from room import (
        LAYOUT_FILENAME, ROOM_TYPE_COMBINED, ROOM_TYPE_EMPTY,
        RoomConstraints, load_room_layout, save_room_layout,
    )

    project = str(params.get('project') or params.get('projectName') or '').strip()
    position = str(params.get('position') or '').strip().upper()
    if not project:
        return {'success': False, 'error': '缺少参数：project（项目名）'}
    if not position:
        return {'success': False, 'error': '缺少参数：position（位置，如 A1）'}
    layout_path = os.path.join(workspace_dir(), project, LAYOUT_FILENAME)
    try:
        matrix = load_room_layout(layout_path)
    except FileNotFoundError:
        return {'success': False, 'error': f'项目 {project} 无 {LAYOUT_FILENAME}（请先创建机房矩阵）'}
    except (OSError, ValueError, TypeError) as e:
        return {'success': False, 'error': f'读取 {project} 机房矩阵失败: {e}'}
    cell = matrix.cells.get(position)
    if cell is None:
        return {'success': False, 'error': f'矩阵位置不存在: {position}'}

    # 移除模式
    if params.get('cabinet_id') in (None, '', 0, '0'):
        matrix.remove_cabinet(position)
        save_room_layout(layout_path, matrix)
        return {'success': True, 'matrix': matrix.to_dict(),
                'issues': [f'已移除 {position} 机柜']}

    try:
        cabinet_id = int(params.get('cabinet_id'))
    except (TypeError, ValueError):
        return {'success': False, 'error': f'cabinet_id 非法: {params.get("cabinet_id")!r}'}

    # 复用 RoomConstraints：占位 / 类型域（提供 cabinet_type 时）/ 单柜功率上限
    constraints = (RoomConstraints.from_dict(params['constraints'])
                   if isinstance(params.get('constraints'), dict) else RoomConstraints())
    issues = []
    if not cell.is_available():
        issues.append(f'位置 {position} 是占位（{cell.placeholder}），不可放置机柜')
    power = int(params.get('power_watts') or 0)
    if power and power > constraints.power_limit_per_rack:
        issues.append(f'位置 {position} 功率 {power}W 超过上限 {constraints.power_limit_per_rack}W')
    cabinet_type = str(params.get('cabinet_type') or '').strip().lower()
    if cabinet_type and cell.type not in (ROOM_TYPE_COMBINED, ROOM_TYPE_EMPTY):
        allowed = constraints.type_device_map.get(cell.type, [])
        if cabinet_type not in allowed:
            issues.append(f'位置 {position} 类型为 {cell.type}，不允许放置 {cabinet_type} 机柜')
    if issues:
        return {'success': False, 'error': '；'.join(issues), 'issues': issues}

    # 位置冲突：已被其他机柜占用
    if cell.cabinet_id is not None and cell.cabinet_id != cabinet_id:
        msg = f'位置 {position} 已被机柜 {cell.cabinet_id} 占用，请先移除'
        return {'success': False, 'error': msg, 'issues': [msg]}
    # 移动语义：机柜已在别处 → 移除旧位置（与前端 mountCabinet 一致）
    for pos, c in matrix.cells.items():
        if c.cabinet_id == cabinet_id and pos != position:
            c.cabinet_id = None
    matrix.place_cabinet(position, cabinet_id)
    save_room_layout(layout_path, matrix)
    return {'success': True, 'matrix': matrix.to_dict(),
            'issues': [f'机柜 {cabinet_id} 已上架到 {position}']}


# ================================================================
# V3.0.4-T3-4: 统一配置体系（config:*，模型/文件层，预留 CLI 接口）
# ================================================================

@register_action('config:list-schema')
def handle_config_list_schema(params):
    """V3.0.4-T3-4: 返回四类配置 schema 元数据 + 预设列表

    返回:
        {schemas: {type: {schemaVersion, fields}}, presets: [...]}
    """
    from config_schema import list_schemas, list_presets
    return {'schemas': list_schemas(), 'presets': list_presets()}


@register_action('config:apply-preset')
def handle_config_apply_preset(params):
    """V3.0.4-T3-4: 套用配置预设（覆盖当前配置 + 宽松校验）

    参数:
        presetId: 预设 id（如 'ib-allflash'）
        config: 当前设计配置（扁平字段）
    返回:
        {config: dict, errors: [str]}
    """
    from config_schema import apply_preset
    config, errors = apply_preset(str(params.get('presetId', '')), params.get('config'))
    return {'config': config, 'errors': errors}


@register_action('config:export')
def handle_config_export(params):
    """V3.0.4-T3-4: 导出统一配置包裹

    参数:
        appSettings: 应用设置（localStorage 收集的 autolink-* 扁平键）
        projectConfig: 当前设计配置
    返回:
        {payload: {format, version, exportedAt, appSettings, projectConfig}}
    """
    from config_schema import export_config
    payload = export_config(params.get('appSettings'), params.get('projectConfig'))
    return {'payload': payload}


@register_action('config:import')
def handle_config_import(params):
    """V3.0.4-T3-4: 导入统一配置包裹（校验 + 宽松合并）

    参数:
        payload: 导出时生成的统一包裹 JSON
    返回:
        {appSettings: dict, projectConfig: dict, errors: [str]}
    """
    from config_schema import import_config
    return import_config(params.get('payload'))


@register_action('cli:info')
def handle_cli_info(params):
    """V3.1.0-T4-3: CLI 能力信息（版本 + 全部 action 清单）

    供 cli:info IPC / 前端排查使用；action 清单来自注册表（与 CLI 子命令树一致）。
    """
    from cli import CLI_VERSION
    return {
        'cliVersion': CLI_VERSION,
        'actions': list_registered_actions(),
    }


# ================================================================
# V3.1.1-T5-3: AI 对话 action（autolink_hub 懒加载，首次调用 init_hub）
#  - ai:chat 流式回复经 emit_event（引擎模式）或收集返回（CLI 模式）
#  - 工具调用经 cli.execute（自动写 cli-audit.jsonl，R5.7 AI 留轨迹）
# ================================================================

_current_request_id: str = ''

# T6-3: 复用的全局 asyncio 事件循环（避免每次对话新建/泄漏）
_ai_loop = None


def _get_ai_loop():
    """T6-3: 获取（惰性创建）全局 asyncio 事件循环，跨 ai:* action 复用"""
    import asyncio
    global _ai_loop
    if _ai_loop is None or _ai_loop.is_closed():
        _ai_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_ai_loop)
    return _ai_loop


def emit_event_current(chunk: str) -> None:
    """V3.1.1-T5-3: 发送流式事件到当前请求（AI 对话 handler 用）"""
    _write_line({"type": "event", "requestId": _current_request_id, "chunk": chunk})


def _init_ai_hub() -> None:
    """懒加载初始化 AI Hub（幂等）"""
    from autolink_hub.hub import init_hub
    init_hub(os.environ.get('AUTOLINK_USER_DATA', ''))


@register_action('ai:chat')
def handle_ai_chat(params):
    """V3.1.1-T5-3: AI 对话（流式）

    参数: sessionId/message/mode/provider/autonomyMode/projectName/attachments。
    引擎模式（main 循环）逐 chunk emit_event 流式输出；
    CLI 模式（无 request_id）收集全部 chunk 后以非流式返回完整回复。
    """
    from autolink_hub.agent.agent import get_or_create_session, clear_session

    _init_ai_hub()

    session_id = params.get('sessionId') or 'default'
    message = params.get('message') or ''
    mode = params.get('mode') or 'general'
    provider = params.get('provider')
    autonomy_mode = params.get('autonomyMode') or 'semi_auto'
    project_name = params.get('projectName') or ''
    attachments = params.get('attachments')

    session = get_or_create_session(session_id)
    session.set_mode(mode, project_name)
    if provider:
        session.set_provider(provider)
    session.autonomy_mode = autonomy_mode
    session.add_user_message(message, attachments)

    request_id = _current_request_id
    collected: list[str] = []

    async def _run():
        async for chunk in session.run_stream():
            if request_id:
                emit_event(request_id, chunk)
            else:
                collected.append(chunk)
        return {
            'sessionId': session_id,
            'status': 'completed',
            'messages': len(session.messages),
            'reply': ''.join(collected) if not request_id else None,
        }

    return _get_ai_loop().run_until_complete(_run())


@register_action('ai:providers')
def handle_ai_providers(params):
    """V3.1.1-T5-3: 可用 Provider 列表（含 enabled/is_default）"""
    from autolink_hub.hub import init_hub, list_providers
    from autolink_hub.config import settings
    _init_ai_hub()
    return {'providers': list_providers(), 'default': settings.default_provider}


@register_action('ai:config')
def handle_ai_config(params):
    """V3.1.1-T5-3: 保存 Provider 配置（BYO-Key）并热重载"""
    from autolink_hub.hub import configure_provider
    _init_ai_hub()
    return configure_provider(
        params.get('provider', ''),
        params.get('apiKey', ''),
        params.get('model', ''),
        params.get('baseUrl', ''),
    )


@register_action('ai:config-default')
def handle_ai_config_default(params):
    """V3.1.1-T5-3: 设置默认 Provider"""
    from autolink_hub.hub import set_default_provider
    _init_ai_hub()
    return set_default_provider(params.get('provider', ''))


@register_action('ai:test')
def handle_ai_test(params):
    """V3.1.1-T5-3: 测试 Provider 连接"""
    from autolink_hub.hub import test_connection
    _init_ai_hub()
    return _get_ai_loop().run_until_complete(test_connection(
        params.get('provider', ''),
        params.get('apiKey', ''),
        params.get('baseUrl', ''),
        params.get('model', ''),
    ))


@register_action('ai:models')
def handle_ai_models(params):
    """V3.1.1-T5-3: 拉取模型列表（OpenAI 兼容端点 /models）"""
    from autolink_hub.hub import fetch_models
    _init_ai_hub()
    return _get_ai_loop().run_until_complete(fetch_models(
        params.get('baseUrl', ''),
        params.get('apiKey', ''),
    ))


@register_action('ai:clear')
def handle_ai_clear(params):
    """V3.1.1-T5-3: 清除会话"""
    from autolink_hub.agent.agent import clear_session
    _init_ai_hub()
    clear_session(params.get('sessionId') or 'default')
    return {'status': 'ok'}


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
    # V2.9.3-T6: 报告数据复用 estimation(收敛比等)
    estimation = _estimate_design(designer, params.get('estimateParams', {}))

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
            report_data = generate_report_data(designer, estimation)
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


# ================================================================
# V3.1.3-T7-1: 对话管理域只读查询（设备库/模板/项目 → AIHUB 管理工具）
# 全部只读：列表/详情，不创建或修改文件（权限 AUTO）
# ================================================================

@register_action('device:list')
def handle_device_list(params):
    """V3.1.3-T7-1: 设备库列表（category 分类/厂商/型号 或 query 关键词过滤）"""
    from manage import list_devices
    return list_devices(
        category=params.get('category', ''),
        query=params.get('query', ''),
        limit=params.get('limit', 50),
    )


@register_action('device:defaults')
def handle_device_defaults(params):
    """V3.1.3-T7-6: 共享设备选型规则（协议 + GPU 世代 → 全部默认交换机，与向导一致）"""
    from device_defaults import defaults
    return defaults(params)


@register_action('template:list')
def handle_template_list(params):
    """V3.1.3-T7-1: 模板列表（内置 + 用户模板，含规模摘要）"""
    from manage import list_templates
    return list_templates()


@register_action('template:view')
def handle_template_view(params):
    """V3.1.3-T7-1: 查看模板详情（含完整 ProjectConfig）"""
    from manage import view_template
    return view_template(params.get('name', ''))


@register_action('project:list')
def handle_project_list(params):
    """V3.1.3-T7-1: 项目列表（扫描工作区）"""
    from manage import list_projects
    return list_projects()


@register_action('project:info')
def handle_project_info(params):
    """V3.1.3-T7-1: 项目详情（meta + ProjectConfig + 宽松校验摘要）"""
    from manage import project_info
    return project_info(params.get('name', ''))


@register_action('project:generate')
def handle_project_generate(params):
    """V3.1.3-T7-2: 需求生成（轨道 B）——LLM 抽取的 ProjectConfig → 规范化补全 + 置信度标注，只预览不落盘"""
    from manage import generate_project
    return generate_project(name=params.get('name', ''), config=params.get('config') or {})


@register_action('file:parse')
def handle_file_parse(params):
    """V3.1.3-T7-3: 示例文件解析（Excel/JSON/CSV/文本 → 结构化数据，只读）"""
    from file_parser import parse_file
    return parse_file(path=params.get('path', ''), file_type=params.get('type', ''))


@register_action('capacity:list-presets')
def handle_capacity_list_presets(params):
    """V3.1.3-T7-4: 容量规划模型档案清单（前端选择器用）"""
    from capacity_planning import get_presets
    presets = get_presets()
    return {'presets': presets, 'total': len(presets)}


@register_action('capacity:recommend')
def handle_capacity_recommend(params):
    """V3.1.3-T7-4: 容量规划推荐（模型 + GPU 规模 → Scale-Up/Scale-Out/收敛比/层数）"""
    from capacity_planning import recommend
    return recommend(params)


def _write_line(obj: dict) -> None:
    """V3.0.0-T0-6: 单行 NDJSON 输出 + flush（持久进程逐行协议）"""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_event(request_id: str, chunk: str) -> None:
    """V3.0.0-T0-6: 发送流式事件行 {type:'event', requestId, chunk}

    供流式 handler 使用（未来 AI 对话/进度），Electron 端逐行透传 webContents.send('ai:stream', ...)。
    """
    _write_line({"type": "event", "requestId": request_id, "chunk": chunk})


def main():
    """主入口：stdin 逐行读取 NDJSON 请求 → stdout 逐行 NDJSON 响应（持久 Agent 进程）

    V3.0.0-T0-6: 由"一次性读 stdin"重构为"逐行循环"：
      - 请求行: {"action": "...", "params": {...}, "requestId": "..."}
      - 响应行: {"type": "result", "requestId", "success", "data"|"error"}
      - 事件行: {"type": "event", "requestId", "chunk"}   （handler 经 emit_event 发送）
      - 解析失败: {"type": "error", "requestId", "error"}
    每行输出后 flush；stdin 关闭（EOF）时退出 → 兼容旧的一次性管道调用。
    """
    # V3.0.0-T0-3: 持久进程启动即注册内置网络插件（action 分派就绪）
    _ensure_plugins_ready()
    # V3.1.2-T6-4: 启动预热 AI Hub（幂等），首次 AI 对话零冷启动
    try:
        _init_ai_hub()
    except Exception as _e:
        # 预热失败不阻塞启动（首次 ai:* action 仍会懒加载）
        print(f"AI Hub 预热失败（延迟懒加载）: {_e}", file=sys.stderr)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request_id = ''
        try:
            request = json.loads(raw)
            request_id = request.get('requestId', '')
            global _current_request_id
            _current_request_id = request_id  # V3.1.1-T5-3: AI 流式事件定位当前请求
            action = request.get('action', '')
            params = request.get('params', {})
            handler = get_action_handler(action)
            if not handler:
                _write_line({"type": "result", "requestId": request_id,
                             "success": False, "error": f"未知 action: {action}"})
                continue
            # V3.1.0-T4-1: 统一经 CLI 执行层（参数校验/审计/执行），UI 与 CLI 行为一致
            from cli import execute as cli_execute
            result = cli_execute(action, params)
            _write_line({"type": "result", "requestId": request_id, "success": True, "data": result})
        except json.JSONDecodeError as e:
            _write_line({"type": "error", "requestId": request_id, "error": f"JSON 解析失败: {e}"})
        except Exception as e:
            _write_line({"type": "result", "requestId": request_id, "success": False, "error": str(e)})


if __name__ == "__main__":
    # V3.0.0-T0-7: 引擎进程内将第三方日志 print 重定向到 stderr，保证 stdout 仅含 NDJSON 协议行
    # （仅引擎独立进程生效；pytest 直接 import 本模块不受影响）
    import builtins as _builtins
    _orig_print = _builtins.print

    def _print(*args, **kwargs):
        kwargs.setdefault('file', sys.stderr)
        _orig_print(*args, **kwargs)

    _builtins.print = _print
    main()
