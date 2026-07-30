"""
AutoLink V2.1 - Python Engine
统一引擎接口，供 Electron 主进程通过子进程调用
通过 stdin 接收 JSON 请求，stdout 返回 JSON 响应
支持 project_config.json (V2.1) 和 network_config.ini (V2.0) 两种格式
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
import pandas as pd


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
    cabinet_ids = {s.cabinet_id for s in designer.servers if s.cabinet_id is not None}
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
                "cableType": conn.cable_type,
                "description": conn.description,
                "networkType": conn.network_type,
                "aCabinetId": conn.a_cabinet_id,
                "aCabinetName": conn.a_cabinet_name,
                "aStartU": conn.a_start_u,
                "aEndU": conn.a_end_u,
                "zCabinetId": conn.z_cabinet_id,
                "zCabinetName": conn.z_cabinet_name,
                "zStartU": conn.z_start_u,
                "zEndU": conn.z_end_u,
            })

    validate_result = designer.validate_topology()

    # V2.4.6: 结构化校验问题列表
    validation_issues = [
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

    # 功率评估 (V2.1新增)
    power_data = _calculate_power_summary(designer)

    # V2.4: PUE/收敛比/机柜功率密度估算
    try:
        estimation = _estimate_design(designer)
    except Exception as e:
        estimation = {"error": f"估算失败: {e}"}

    return {
        "summary": summary,
        "topology": {"nodes": nodes, "edges": edges},
        "valid": validate_result["valid"],
        "validationIssues": validation_issues,
        "powerData": power_data,
        "estimation": estimation,
    }


def handle_estimate(params):
    """V2.4: 参数化 PUE/收敛比估算（支持用户调整散热方式等参数）"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    return _estimate_design(designer, params.get('estimateParams', {}))


def handle_report(params):
    """V2.4: 生成完整报告数据（供前端可视化展示）"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    return generate_report_data(designer)


def _calculate_power_summary(designer):
    """计算机柜功率使用情况"""
    cabinets = {}
    power_limit = getattr(designer, 'power_limit_per_rack', 6000) or 6000
    for server in designer.servers:
        if server.cabinet_id is None:
            continue
        cid = server.cabinet_id
        if cid not in cabinets:
            cabinets[cid] = {
                "cabinetId": cid,
                "cabinetName": server.cabinet_name or f"机柜{cid}",
                "totalPower": 0,
                "deviceCount": 0,
                "powerLimit": power_limit,
                "devices": [],
            }
        server_power = server.power_watts or 0
        cabinets[cid]["totalPower"] += server_power
        cabinets[cid]["deviceCount"] += 1
        cabinets[cid]["devices"].append({
            "name": server.name,
            "power": server_power,
            "uHeight": server.u_height or 1,
            "startU": server.start_u,
            "endU": server.end_u,
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


def handle_validate(params):
    """处理拓扑验证请求"""
    config_file, error = _get_config_file(params)
    if error:
        return {"error": error}

    designer = NetworkDesignerV2(config_file)
    result = designer.validate_topology()
    return {"valid": result["valid"]}


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
    """主入口：从 stdin 读取 JSON，处理后输出到 stdout"""
    try:
        raw = sys.stdin.read()
        request = json.loads(raw)
        action = request.get('action', '')
        params = request.get('params', {})

        actions = {
            'design': handle_design,
            'validate': handle_validate,
            'export': handle_export,
            'estimate': handle_estimate,
            'report': handle_report,
        }

        handler = actions.get(action)
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
