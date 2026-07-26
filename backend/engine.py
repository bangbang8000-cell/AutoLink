"""
AutoLink V2.0 - Python Engine
统一引擎接口，供 Electron 主进程通过子进程调用
通过 stdin 接收 JSON 请求，stdout 返回 JSON 响应
"""

import sys
import json
import os
import datetime

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from designer import NetworkDesignerV2
from exporter import export_all_connections


def handle_design(params):
    """处理拓扑设计请求"""
    config_file = params.get('configFile')
    if not config_file:
        return {"error": "缺少 configFile 参数"}

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
    }

    # Build topology data for visualization
    nodes = []
    edges = []

    for server in designer.servers:
        nodes.append({"id": server.name, "type": "server", "group": server.group, "podid": server.podid})

    for sw in designer.param_leaves:
        nodes.append({"id": sw.name, "type": "param_leaf", "group": designer.switch_groups.get(sw.name, "")})
    for sw in designer.param_spines:
        nodes.append({"id": sw.name, "type": "param_spine", "group": designer.switch_groups.get(sw.name, "")})
    for sw in designer.storage_leaves:
        nodes.append({"id": sw.name, "type": "storage_leaf", "group": designer.switch_groups.get(sw.name, "")})
    for sw in designer.storage_spines:
        nodes.append({"id": sw.name, "type": "storage_spine", "group": designer.switch_groups.get(sw.name, "")})

    for server in designer.servers:
        for conn in server.connections:
            edges.append({
                "source": conn.a_device,
                "target": conn.z_device,
                "speed": conn.a_module,
                "cableType": conn.cable_type,
                "description": conn.description,
            })

    validate_result = designer.validate_topology()

    return {
        "summary": summary,
        "topology": {"nodes": nodes, "edges": edges},
        "valid": validate_result,
    }


def handle_validate(params):
    """处理拓扑验证请求"""
    config_file = params.get('configFile')
    if not config_file:
        return {"error": "缺少 configFile 参数"}

    designer = NetworkDesignerV2(config_file)
    valid = designer.validate_topology()
    return {"valid": valid}


def handle_export(params):
    """处理渲染导出请求"""
    config_file = params.get('configFile')
    output_dir = params.get('outputDir', 'output')
    output_types = params.get('outputTypes', [])

    if not config_file:
        return {"error": "缺少 configFile 参数"}

    designer = NetworkDesignerV2(config_file)
    os.makedirs(output_dir, exist_ok=True)

    results = []
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    mode = designer.downlink_mode

    if 'connections' in output_types or not output_types:
        fn = os.path.join(output_dir, f"AI智算网络_{mode}模式_{ts}.xlsx")
        export_all_connections(designer, fn)
        results.append({"type": "connections", "file": fn, "status": "success"})

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
