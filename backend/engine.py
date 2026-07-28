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
from exporter import export_all_connections, generate_summary_data
import pandas as pd


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
    }

    # Build topology data for visualization
    nodes = []
    edges = []

    for server in designer.servers:
        nodes.append({
            "id": server.name, "type": "server", "group": server.group, "podid": server.podid,
            "cabinetId": server.cabinet_id, "cabinetName": server.cabinet_name,
            "startU": server.start_u, "endU": server.end_u,
            "powerWatts": server.power_watts, "uHeight": server.u_height,
        })

    for sw in designer.param_leaves:
        nodes.append({"id": sw.name, "type": "param_leaf", "group": designer.switch_groups.get(sw.name, ""), "podid": designer.podid_map.get(sw.name, "")})
    for sw in designer.param_spines:
        nodes.append({"id": sw.name, "type": "param_spine", "group": designer.switch_groups.get(sw.name, ""), "podid": designer.podid_map.get(sw.name, "")})
    for sw in designer.storage_leaves:
        nodes.append({"id": sw.name, "type": "storage_leaf", "group": designer.switch_groups.get(sw.name, ""), "podid": designer.podid_map.get(sw.name, "")})
    for sw in designer.storage_spines:
        nodes.append({"id": sw.name, "type": "storage_spine", "group": designer.switch_groups.get(sw.name, ""), "podid": designer.podid_map.get(sw.name, "")})

    for server in designer.servers:
        for conn in server.connections:
            edges.append({
                "source": conn.a_device,
                "target": conn.z_device,
                "speed": conn.a_module,
                "cableType": conn.cable_type,
                "description": conn.description,
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

    # 功率评估 (V2.1新增)
    power_data = _calculate_power_summary(designer)

    return {
        "summary": summary,
        "topology": {"nodes": nodes, "edges": edges},
        "valid": validate_result,
        "powerData": power_data,
    }


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
    valid = designer.validate_topology()
    return {"valid": valid}


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
            summary_df = generate_summary_data(designer)
            with pd.ExcelWriter(fn, engine='openpyxl') as writer:
                summary_df.to_excel(writer, sheet_name='设备清单', index=False)
            results.append({"type": "deviceList", "file": fn, "status": "success"})
        except Exception as e:
            results.append({"type": "deviceList", "file": fn, "status": "error", "error": str(e)})

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
