"""
AutoLink V2.1 - Excel导出与格式化
提供服务器视角、交换机视角的连接表生成和Excel美化
支持机柜编号和U位范围 (V2.1新增)
"""

import re
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
from openpyxl.utils import get_column_letter


def _extract_number(s):
    """从字符串中提取数字用于排序"""
    if isinstance(s, (int, float)):
        return int(s)
    if not isinstance(s, str):
        return 0
    match = re.search(r'\d+', s)
    return int(match.group()) if match else 0


def _get_iface_weight(port_str):
    """获取服务器接口类型排序权重: 参数网卡=1, 存储=2, OOB=3, 业务=4"""
    if '参数' in port_str:
        return 1
    if '存储' in port_str:
        return 2
    if 'OOB' in port_str:
        return 3
    if '业务' in port_str:
        return 4
    return 5


def _get_switch_type_weight(device_name):
    """获取交换机类型权重用于排序: Leaf=1, Spine=2, Core=3, 接入=4, 汇聚=5"""
    if "Leaf" in device_name:
        return 1
    elif "Spine" in device_name:
        return 2
    elif "Core" in device_name:
        return 3
    elif "接入" in device_name:
        return 4
    elif "汇聚" in device_name:
        return 5
    return 6


def generate_server_view(designer):
    """生成服务器视角的连接表"""
    connections = []

    for server in designer.servers:
        server_group = designer.server_groups[server.name]
        podid = designer.podid_map.get(server.name, "")
        for conn in server.connections:
            if conn.a_device == server.name:
                connections.append({
                    'podid': podid,
                    '服务器分组': server_group,
                    'A端设备': conn.a_device,
                    'A端接口': conn.a_port,
                    'A端模块': conn.a_module,
                    'A端机柜编号': conn.a_cabinet_name or '',
                    'A端U位': f"{conn.a_start_u}-{conn.a_end_u}" if conn.a_start_u else '',
                    'Z端设备': conn.z_device,
                    'Z端接口': conn.z_port,
                    'Z端模块': conn.z_module,
                    'Z端机柜编号': conn.z_cabinet_name or '',
                    'Z端U位': f"{conn.z_start_u}-{conn.z_end_u}" if conn.z_start_u else '',
                    '线缆类型': conn.cable_type,
                    '描述': conn.description
                })

    df = pd.DataFrame(connections)
    if not df.empty:
        # 按设备聚合, 同设备内按接口类型排序: 参数→存储→OOB→业务
        df['iface_w'] = df['A端接口'].apply(_get_iface_weight)
        df['port_num'] = df['A端接口'].apply(_extract_number)
        # 从设备名末尾提取数字用于自然排序 (GPU服务器_2 < GPU服务器_10)
        df['dev_num'] = df['A端设备'].apply(_extract_number)
        df = df.sort_values(by=['服务器分组', 'dev_num', 'iface_w', 'port_num'])
        df = df.drop(columns=['dev_num', 'iface_w', 'port_num'])
    return df


def generate_switch_view(designer):
    """生成交换机视角的连接表"""
    param_connections = []
    storage_connections = []

    all_switches = (designer.param_leaves + designer.param_spines + designer.param_cores +
                   designer.storage_leaves + designer.storage_spines + designer.storage_cores)

    for switch in all_switches:
        switch_group = designer.switch_groups.get(switch.name, "")
        podid = designer.podid_map.get(switch.name, "")
        for conn in switch.connections:
            if conn.a_device == switch.name:
                row = {
                    'podid': podid,
                    '交换机分组': switch_group,
                    'A端设备': conn.a_device,
                    'A端接口': conn.a_port,
                    'A端模块': conn.a_module,
                    'A端机柜编号': conn.a_cabinet_name or '',
                    'A端U位': f"{conn.a_start_u}-{conn.a_end_u}" if conn.a_start_u else '',
                    'Z端设备': conn.z_device,
                    'Z端接口': conn.z_port,
                    'Z端模块': conn.z_module,
                    'Z端机柜编号': conn.z_cabinet_name or '',
                    'Z端U位': f"{conn.z_start_u}-{conn.z_end_u}" if conn.z_start_u else '',
                    '线缆类型': conn.cable_type,
                    '描述': conn.description
                }
                if "参数" in switch.name:
                    param_connections.append(row)
                else:
                    storage_connections.append(row)

    param_df = pd.DataFrame(param_connections)
    storage_df = pd.DataFrame(storage_connections)

    if not param_df.empty:
        param_df['type_weight'] = param_df['A端设备'].apply(_get_switch_type_weight)
        param_df['dev_num'] = param_df['A端设备'].apply(_extract_number)
        param_df['port_num'] = param_df['A端接口'].apply(_extract_number)
        param_df = param_df.sort_values(by=['type_weight', '交换机分组', 'dev_num', 'A端设备', 'port_num'])
        param_df = param_df.drop(columns=['type_weight', 'dev_num', 'port_num'])

    if not storage_df.empty:
        storage_df['type_weight'] = storage_df['A端设备'].apply(_get_switch_type_weight)
        storage_df['dev_num'] = storage_df['A端设备'].apply(_extract_number)
        storage_df['port_num'] = storage_df['A端接口'].apply(_extract_number)
        storage_df = storage_df.sort_values(by=['type_weight', '交换机分组', 'dev_num', 'A端设备', 'port_num'])
        storage_df = storage_df.drop(columns=['type_weight', 'dev_num', 'port_num'])

    return {'参数网络': param_df, '存储网络': storage_df}


def generate_summary_data(designer):
    """生成网络设计摘要数据"""
    half_ports = designer.param_switch_ports // 2
    if designer.param_3tier_needed:
        servers_per_group = min(designer.param_servers_per_pod // designer.param_ports_per_server, half_ports)
        param_downlink_usage = f"{servers_per_group}/{half_ports} ({servers_per_group / half_ports * 100:.1f}%)"
        param_uplink_usage = f"{half_ports}/{half_ports} (100.0%)"
    else:
        param_downlink_usage = f"{designer.param_servers_per_group}/{half_ports} ({designer.param_servers_per_group / half_ports * 100:.1f}%)"
        uplinks_used = min(half_ports, designer.param_spine_count)
        param_uplink_usage = f"{uplinks_used}/{half_ports} ({uplinks_used / half_ports * 100:.1f}%)"

    half_ports = designer.storage_switch_ports // 2
    if designer.storage_3tier_needed:
        servers_per_group = min(designer.storage_servers_per_pod // designer.storage_ports_per_server, half_ports)
        storage_downlink_usage = f"{servers_per_group}/{half_ports} ({servers_per_group / half_ports * 100:.1f}%)"
        storage_uplink_usage = f"{half_ports}/{half_ports} (100.0%)"
    else:
        storage_downlink_usage = f"{designer.storage_servers_per_group}/{half_ports} ({designer.storage_servers_per_group / half_ports * 100:.1f}%)"
        uplinks_used = min(half_ports, designer.storage_spine_count)
        storage_uplink_usage = f"{uplinks_used}/{half_ports} ({uplinks_used / half_ports * 100:.1f}%)"

    param_tier_info = "3层(Leaf-Spine-Core)" if designer.param_3tier_needed else "2层(Leaf-Spine)"
    storage_tier_info = "3层(Leaf-Spine-Core)" if designer.storage_3tier_needed else "2层(Leaf-Spine)"

    if designer.param_3tier_needed:
        param_group_info = f"{designer.param_pods}个POD, 每个POD{designer.param_servers_per_pod}台"
    else:
        param_group_info = f"{designer.param_groups}组, 每组{designer.param_servers_per_group}台"

    if designer.storage_3tier_needed:
        storage_group_info = f"{designer.storage_pods}个POD, 每个POD{designer.storage_servers_per_pod}台"
    else:
        storage_group_info = f"{designer.storage_groups}组, 每组{designer.storage_servers_per_group}台"

    summary = [
        ["网络设计摘要", ""],
        ["设计时间", pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")],
        ["", ""],
        ["GPU服务器配置", ""],
        ["服务器数量", designer.num_servers],
        ["参数网卡/服务器", designer.param_ports_per_server],
        ["存储网卡/服务器", designer.storage_ports_per_server],
        ["", ""],
        ["参数网络设计", ""],
        ["交换机端口数", designer.param_switch_ports],
        ["Leaf交换机数量", designer.param_leaf_count],
        ["Spine交换机数量", designer.param_spine_count],
        ["Core交换机数量", designer.param_core_count if designer.param_3tier_needed else "无"],
        ["网络层级", param_tier_info],
        ["服务器分组", param_group_info],
        ["下行端口使用率", param_downlink_usage],
        ["上行端口使用率", param_uplink_usage],
        ["收敛比例", "1:1:1" if designer.param_3tier_needed else "1:1"],
        ["", ""],
        ["存储网络设计", ""],
        ["交换机端口数", designer.storage_switch_ports],
        ["Leaf交换机数量", designer.storage_leaf_count],
        ["Spine交换机数量", designer.storage_spine_count],
        ["Core交换机数量", designer.storage_core_count if designer.storage_3tier_needed else "无"],
        ["网络层级", storage_tier_info],
        ["服务器分组", storage_group_info],
        ["下行端口使用率", storage_downlink_usage],
        ["上行端口使用率", storage_uplink_usage],
        ["收敛比例", "1:1:1" if designer.storage_3tier_needed else "1:1"],
        ["", ""],
        ["网络速度配置", ""],
        ["参数网络速度", designer.param_speed],
        ["存储网络速度", designer.storage_speed],
        ["线缆类型", "参数: MPO | 存储: AOC | OOB: 网线/光纤 | 业务: 光纤"]
    ]
    return pd.DataFrame(summary, columns=["项目", "值"])


def generate_device_list(designer):
    """Generate device inventory from topology and device profiles"""
    items = []

    # Collect all device types and their counts from the designer
    # Servers: from designer.servers, group by group (e.g., "GPU服务器", "存储服务器")
    server_groups = {}
    for server in designer.servers:
        group = server.group or "GPU服务器"
        if group not in server_groups:
            server_groups[group] = {"count": 0, "u_height": server.u_height or 4, "power": server.power_watts or 2000}
        server_groups[group]["count"] += 1

    for group, info in server_groups.items():
        items.append({
            "设备类型": group,
            "厂商": "",
            "型号": "",
            "数量": info["count"],
            "单机功耗(W)": info["power"],
            "U位高度": info["u_height"],
            "总功耗(W)": info["count"] * info["power"],
            "总U位": info["count"] * info["u_height"],
        })

    # Switches: count by type prefix
    switch_types = {}
    all_switches = (designer.param_leaves + designer.param_spines + designer.param_cores +
                    designer.storage_leaves + designer.storage_spines + designer.storage_cores +
                    designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg)

    for sw in all_switches:
        stype = sw.obj_type.replace('param_', '').replace('storage_', '')
        stype_map = {
            'leaf': 'Leaf交换机', 'spine': 'Spine交换机', 'core': 'Core交换机',
            'access': '接入交换机', 'agg': '汇聚交换机',
        }
        label = stype_map.get(stype, stype)
        if label not in switch_types:
            switch_types[label] = {"count": 0, "power": sw.power_watts or 0, "u_height": sw.u_height or 1}
        switch_types[label]["count"] += 1

    for stype, info in switch_types.items():
        items.append({
            "设备类型": stype,
            "厂商": "",
            "型号": "",
            "数量": info["count"],
            "单机功耗(W)": info["power"],
            "U位高度": info["u_height"],
            "总功耗(W)": info["count"] * info["power"],
            "总U位": info["count"] * info["u_height"],
        })

    # Add totals row
    if len(items) > 0:
        total_power = sum(i["总功耗(W)"] for i in items)
        total_u = sum(i["总U位"] for i in items)
        items.append({
            "设备类型": "合计",
            "厂商": "",
            "型号": "",
            "数量": sum(i["数量"] for i in items),
            "单机功耗(W)": "",
            "U位高度": "",
            "总功耗(W)": total_power,
            "总U位": total_u,
        })

    columns = ["设备类型", "厂商", "型号", "数量", "单机功耗(W)", "U位高度", "总功耗(W)", "总U位"]
    return pd.DataFrame(items, columns=columns)


def apply_excel_formatting(filename):
    """应用Excel格式美化：合并同设备行、组分隔线、边框、交替行色"""
    from openpyxl.styles import Border, Side, PatternFill, Font, Alignment

    wb = load_workbook(filename)
    thin = Side(style='thin')
    thick = Side(style='medium')
    thin_border = Border(left=thin, right=thin, top=thin, bottom=thin)
    thick_bottom = Border(left=thin, right=thin, top=thin, bottom=thick)
    header_fill = PatternFill(start_color="4F81BD", end_color="4F81BD", fill_type="solid")
    header_font = Font(bold=True, size=12, color="FFFFFF")
    group_fill = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left_align = Alignment(horizontal='left', vertical='center', wrap_text=True)
    even_fill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
    odd_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

    col_widths = {
        'podid': 15, '服务器分组': 15, '交换机分组': 15,
        'A端设备': 30, 'A端接口': 15, 'A端模块': 12,
        'A端机柜编号': 15, 'A端U位': 12,
        'Z端设备': 30, 'Z端接口': 15, 'Z端模块': 12,
        'Z端机柜编号': 15, 'Z端U位': 12,
        '线缆类型': 12, '描述': 35, '项目': 25, '值': 40
    }

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        max_row = ws.max_row
        max_col = ws.max_column

        if max_row <= 1:
            continue

        ws.freeze_panes = 'A3'
        ws.auto_filter.ref = f"A1:{get_column_letter(max_col)}{max_row}"

        # 列宽
        for col_idx, col_name in enumerate(ws[1], 1):
            ws.column_dimensions[get_column_letter(col_idx)].width = col_widths.get(col_name.value, 15)

        ws.row_dimensions[1].height = 28

        # 标题行
        for c in ws[1]:
            c.font = header_font; c.fill = header_fill
            c.alignment = center_align; c.border = thin_border

        # 识别列：从标题行确定podid_col, group_col, device_col, port_col
        headers = {cell.value: cell.column for cell in ws[1] if cell.value}
        podid_col = headers.get('podid')
        group_col = headers.get('服务器分组') or headers.get('交换机分组')
        device_col = headers.get('A端设备')
        port_col = headers.get('A端接口')

        # 读取所有数据值（处理NaN → ffill）
        if max_row >= 2:
            rows_data = []
            for row_idx in range(2, max_row + 1):
                row_vals = {}
                for col in [podid_col, group_col, device_col, port_col]:
                    if col:
                        v = ws.cell(row=row_idx, column=col).value
                        row_vals[col] = v
                rows_data.append(row_vals)

            # Forward-fill NaN values (pandas output leaves merged cells as NaN)
            for i in range(len(rows_data)):
                if i > 0:
                    for col in [podid_col, group_col, device_col]:
                        if col and rows_data[i].get(col) is None:
                            rows_data[i][col] = rows_data[i-1].get(col)

            # 写回填充值
            for i, rd in enumerate(rows_data):
                r = i + 2
                for col, val in rd.items():
                    if col and ws.cell(row=r, column=col).value is None and val is not None:
                        ws.cell(row=r, column=col).value = val

        # 摘要sheet特殊处理
        if sheet_name in ('网络设计摘要', '设计摘要'):
            for row in ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col):
                for cell in row:
                    cell.alignment = center_align
                    cell.border = thin_border
            continue

        # ===== 收集合并区域和组分界 =====
        merge_regions = []
        group_boundaries = set()

        # podid列合并
        if podid_col:
            cur, start = None, 2
            for r in range(2, max_row + 1):
                v = ws.cell(row=r, column=podid_col).value
                if v != cur:
                    if cur is not None and r - 1 > start:
                        merge_regions.append((start, r - 1, podid_col, podid_col))
                    cur, start = v, r
            if cur is not None and max_row > start:
                merge_regions.append((start, max_row, podid_col, podid_col))

        # 分组列合并 + 组分界标记
        if group_col:
            cur, start = None, 2
            for r in range(2, max_row + 1):
                v = ws.cell(row=r, column=group_col).value
                if v != cur:
                    if cur is not None:
                        if r - 1 > start:
                            merge_regions.append((start, r - 1, group_col, group_col))
                        group_boundaries.add(r - 1)  # 组结束行
                    cur, start = v, r
            if cur is not None and max_row > start:
                merge_regions.append((start, max_row, group_col, group_col))

        # 设备列合并（在每个分组内独立合并）
        if device_col and group_col:
            for r in range(2, max_row + 1):
                if r == 2:
                    cur_dev, dev_start = ws.cell(row=r, column=device_col).value, r
                    continue
                if r in group_boundaries:
                    continue  # 不在边界重置, 让下一行group变更触发合并
                dev_val = ws.cell(row=r, column=device_col).value
                grp_val = ws.cell(row=r, column=group_col).value
                prev_grp = ws.cell(row=r - 1, column=group_col).value
                if grp_val != prev_grp:
                    if r - 1 > dev_start:
                        merge_regions.append((dev_start, r - 1, device_col, device_col))
                    cur_dev, dev_start = dev_val, r
                elif dev_val != cur_dev:
                    if r - 1 > dev_start:
                        merge_regions.append((dev_start, r - 1, device_col, device_col))
                    cur_dev, dev_start = dev_val, r
            if max_row > dev_start:
                merge_regions.append((dev_start, max_row, device_col, device_col))
        elif device_col:
            cur, start = None, 2
            for r in range(2, max_row + 1):
                v = ws.cell(row=r, column=device_col).value
                if v != cur:
                    if cur is not None and r - 1 > start:
                        merge_regions.append((start, r - 1, device_col, device_col))
                    cur, start = v, r
            if cur is not None and max_row > start:
                merge_regions.append((start, max_row, device_col, device_col))

        # 应用合并
        for sr, er, sc, ec in merge_regions:
            ws.merge_cells(start_row=sr, end_row=er, start_column=sc, end_column=ec)

        # ===== 数据行样式 (单次遍历) =====
        for row_idx in range(2, max_row + 1):
            is_boundary = row_idx in group_boundaries
            fill = even_fill if row_idx % 2 == 0 else odd_fill
            row = [ws.cell(row=row_idx, column=c) for c in range(1, max_col + 1)]

            for cell in row:
                cell.border = thick_bottom if is_boundary else thin_border
                if is_boundary and cell.column == group_col:
                    cell.fill = group_fill
                else:
                    cell.fill = fill
                col = cell.column
                if col == podid_col or col == group_col or col == device_col:
                    cell.alignment = center_align
                elif col == max_col or (port_col and col > device_col):
                    cell.alignment = left_align if col == max_col else center_align
                else:
                    cell.alignment = center_align

        # 端口列居左
        if port_col:
            for r in range(2, max_row + 1):
                ws.cell(row=r, column=port_col).alignment = center_align

    wb.save(filename)
    print(f"已应用Excel格式美化: {filename}")


def export_all_connections(designer, filename):
    """导出所有连接关系到单个Excel文件"""
    with pd.ExcelWriter(filename, engine='openpyxl') as writer:
        try:
            generate_summary_data(designer).to_excel(writer, sheet_name='网络设计摘要', index=False)
            generate_server_view(designer).to_excel(writer, sheet_name='服务器连接表', index=False)
            switch_views = generate_switch_view(designer)
            switch_views['参数网络'].to_excel(writer, sheet_name='参数网络连接表', index=False)
            switch_views['存储网络'].to_excel(writer, sheet_name='存储网络连接表', index=False)

            # OOB网络
            if designer.oob_enabled and designer.oob_access:
                oob_df = _generate_access_agg_view(designer, designer.oob_access, designer.oob_agg)
                oob_df.to_excel(writer, sheet_name='OOB网络连接表', index=False)
                # OOB汇聚反向视角
                oob_rev = _generate_agg_reverse_view(designer, designer.oob_access, designer.oob_agg, "OOB")
                if oob_rev is not None:
                    oob_rev.to_excel(writer, sheet_name='OOB汇聚视角', index=False)

            # 业务网络
            if designer.biz_enabled and designer.biz_access:
                biz_df = _generate_access_agg_view(designer, designer.biz_access, designer.biz_agg)
                biz_df.to_excel(writer, sheet_name='业务网络连接表', index=False)

        except Exception as e:
            print(f"生成连接表时出错: {e}")
            if len(writer.book.sheetnames) == 0:
                writer.book.create_sheet("错误信息")
            raise

    apply_excel_formatting(filename)
    print(f"所有连接表已导出到: {filename}")


def _generate_access_agg_view(designer, access_switches, agg_switches):
    """生成接入-汇聚网络交换机视角的连接表"""
    connections = []
    all_switches = access_switches + agg_switches

    for sw in all_switches:
        sw_group = designer.switch_groups.get(sw.name, "")
        podid = designer.podid_map.get(sw.name, "")
        for conn in sw.connections:
            if conn.a_device == sw.name:
                connections.append({
                    'podid': podid,
                    '交换机分组': sw_group,
                    'A端设备': conn.a_device,
                    'A端接口': conn.a_port,
                    'A端模块': conn.a_module,
                    'A端机柜编号': conn.a_cabinet_name or '',
                    'A端U位': f"{conn.a_start_u}-{conn.a_end_u}" if conn.a_start_u else '',
                    'Z端设备': conn.z_device,
                    'Z端接口': conn.z_port,
                    'Z端模块': conn.z_module,
                    'Z端机柜编号': conn.z_cabinet_name or '',
                    'Z端U位': f"{conn.z_start_u}-{conn.z_end_u}" if conn.z_start_u else '',
                    '线缆类型': conn.cable_type,
                    '描述': conn.description
                })

    df = pd.DataFrame(connections)
    if not df.empty:
        df['type_weight'] = df['A端设备'].apply(_get_switch_type_weight)
        df['dev_num'] = df['A端设备'].apply(_extract_number)
        df['port_num'] = df['A端接口'].apply(_extract_number)
        df = df.sort_values(by=['type_weight', '交换机分组', 'dev_num', 'A端设备', 'port_num'])
        df = df.drop(columns=['type_weight', 'dev_num', 'port_num'])
    return df


def _generate_agg_reverse_view(designer, access_switches, agg_switches, network_name):
    """生成汇聚交换机反向视角 (A端=汇聚, Z端=接入)"""
    connections = []

    for agg in agg_switches:
        sw_group = designer.switch_groups.get(agg.name, "")
        podid = designer.podid_map.get(agg.name, "")
        for conn in agg.connections:
            if conn.a_device == agg.name:
                connections.append({
                    'podid': podid,
                    '交换机分组': sw_group,
                    'A端设备': conn.a_device,
                    'A端接口': conn.a_port,
                    'A端模块': conn.a_module,
                    'A端机柜编号': conn.a_cabinet_name or '',
                    'A端U位': f"{conn.a_start_u}-{conn.a_end_u}" if conn.a_start_u else '',
                    'Z端设备': conn.z_device,
                    'Z端接口': conn.z_port,
                    'Z端模块': conn.z_module,
                    'Z端机柜编号': conn.z_cabinet_name or '',
                    'Z端U位': f"{conn.z_start_u}-{conn.z_end_u}" if conn.z_start_u else '',
                    '线缆类型': conn.cable_type,
                    '描述': conn.description
                })

    df = pd.DataFrame(connections)
    if not df.empty:
        df['dev_num'] = df['A端设备'].apply(_extract_number)
        df['port_num'] = df['A端接口'].apply(_extract_number)
        df = df.sort_values(by=['交换机分组', 'dev_num', 'A端设备', 'port_num'])
        df = df.drop(columns=['dev_num', 'port_num'])
    return df if not df.empty else None


# ================================================================
# V2.4 新增：布线指导表 / BOM / 报告数据
# ================================================================

def export_cabling_guide(designer, filename):
    """V2.4: 导出布线指导表（含光模块型号、长度估算、成本）

    每条连接生成一行，包含：
    - A/Z 端设备、端口、机柜、U位
    - 线缆类型、速率
    - 光模块型号、规格、封装、光纤类型
    - 估算长度、价格区间
    """
    from optical_selector import select_module_for_connection, estimate_module_cost

    rows = []
    all_switches = (
        designer.param_leaves + designer.param_spines + designer.param_cores +
        designer.storage_leaves + designer.storage_spines + designer.storage_cores +
        designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg
    )
    all_devices = designer.servers + all_switches
    seen_conns = set()

    for dev in all_devices:
        for conn in dev.connections:
            if conn.a_device != dev.name:
                continue
            # 去重（每条连接在 A 端和 Z 端各存一份）
            pair_key = tuple(sorted([conn.a_device, conn.z_device])) + (conn.a_port,)
            if pair_key in seen_conns:
                continue
            seen_conns.add(pair_key)

            sel = select_module_for_connection(conn)
            cost_lo, cost_hi = estimate_module_cost(sel.price_range) if sel else (0, 0)

            rows.append({
                '网络类型': conn.network_type or '',
                'A端设备': conn.a_device,
                'A端端口': conn.a_port,
                'A端机柜': conn.a_cabinet_name or '',
                'A端U位': f"{conn.a_start_u}-{conn.a_end_u}" if conn.a_start_u else '',
                'Z端设备': conn.z_device,
                'Z端端口': conn.z_port,
                'Z端机柜': conn.z_cabinet_name or '',
                'Z端U位': f"{conn.z_start_u}-{conn.z_end_u}" if conn.z_start_u else '',
                '速率': conn.a_module or '',
                '线缆类型': conn.cable_type,
                '光模块型号': sel.module_id if sel else '',
                '封装': sel.form_factor if sel else '',
                '规格': sel.spec if sel else '',
                '光纤类型': sel.fiber_type if sel else '',
                '支持距离(m)': sel.distance_m if sel else '',
                '估算长度(m)': f"{sel.estimated_length_m:.1f}" if sel else '',
                '价格区间': sel.price_range if sel else '',
                '估价低(元)': cost_lo,
                '估价高(元)': cost_hi,
                '描述': conn.description,
            })

    df = pd.DataFrame(rows)
    if not df.empty:
        df['__num'] = df['A端设备'].apply(_extract_number)
        df = df.sort_values(by=['网络类型', '__num', 'A端设备'])
        df = df.drop(columns=['__num'])

    with pd.ExcelWriter(filename, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='布线指导表', index=False)
        # 汇总 sheet
        if not df.empty:
            summary = df.groupby(['速率', '光模块型号', '价格区间']).agg(
                数量=('A端设备', 'count'),
                估价低合计=('估价低(元)', 'sum'),
                估价高合计=('估价高(元)', 'sum'),
            ).reset_index()
            summary.to_excel(writer, sheet_name='光模块汇总', index=False)

    apply_excel_formatting(filename)
    print(f"布线指导表已导出: {filename}")
    return df


def export_bom(designer, filename):
    """V2.4: 导出 BOM 成本估算表

    汇总所有设备 + 光模块，按型号分组，含数量和价格区间
    """
    from optical_selector import select_module_for_connection, estimate_module_cost
    from device_library import get_device_library

    try:
        library = get_device_library()
    except Exception:
        library = None

    rows = []

    # 1. 服务器
    for server in designer.servers:
        dev = None
        if library and hasattr(server, 'device_profile') and server.device_profile:
            dev = library.get(server.device_profile)
        price = getattr(dev, 'price_range', None) if dev else None
        rows.append({
            '类别': 'GPU服务器' if 'GPU' in (server.name + getattr(dev, 'description', '') or '') else '服务器',
            '设备名称': server.name,
            '设备型号': getattr(dev, 'id', '') if dev else '',
            '描述': getattr(dev, 'description', '') if dev else server.obj_type,
            '数量': 1,
            '单位功率(W)': server.power_watts or 0,
            '价格区间': price or '',
        })

    # 2. 交换机
    all_switches = (
        designer.param_leaves + designer.param_spines + designer.param_cores +
        designer.storage_leaves + designer.storage_spines + designer.storage_cores +
        designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg
    )
    for sw in all_switches:
        dev = None
        if library and hasattr(sw, 'device_profile') and sw.device_profile:
            dev = library.get(sw.device_profile)
        price = getattr(dev, 'price_range', None) if dev else None
        sw_type = '参数网交换机' if '参数' in sw.name else \
                  '存储网交换机' if '存储' in sw.name else \
                  'OOB交换机' if 'OOB' in sw.name else \
                  '业务交换机' if '业务' in sw.name else '交换机'
        rows.append({
            '类别': sw_type,
            '设备名称': sw.name,
            '设备型号': getattr(dev, 'id', '') if dev else '',
            '描述': getattr(dev, 'description', '') if dev else sw.obj_type,
            '数量': 1,
            '单位功率(W)': sw.power_watts or 0,
            '价格区间': price or '',
        })

    # 3. 光模块（按型号汇总）
    seen_conns = set()
    module_counts = {}
    for dev in designer.servers + all_switches:
        for conn in dev.connections:
            if conn.a_device != dev.name:
                continue
            pair_key = tuple(sorted([conn.a_device, conn.z_device])) + (conn.a_port,)
            if pair_key in seen_conns:
                continue
            seen_conns.add(pair_key)

            sel = select_module_for_connection(conn, library)
            if sel:
                key = sel.module_id
                if key not in module_counts:
                    module_counts[key] = {
                        'category': '光模块',
                        'name': sel.module_id,
                        'model': sel.module_id,
                        'desc': sel.description,
                        'count': 0,
                        'power': sel.distance_m,  # 用支持距离代替功率
                        'price': sel.price_range,
                    }
                module_counts[key]['count'] += 1

    for mod_data in module_counts.values():
        rows.append({
            '类别': '光模块',
            '设备名称': mod_data['name'],
            '设备型号': mod_data['model'],
            '描述': mod_data['desc'],
            '数量': mod_data['count'],
            '单位功率(W)': 0,
            '价格区间': mod_data['price'],
        })

    df = pd.DataFrame(rows)

    # 计算价格估算
    price_map = {'低': (500, 2000), '中': (2000, 8000), '高': (8000, 30000), '极高': (30000, 100000)}
    df['估价低(元)'] = df['价格区间'].map(lambda x: price_map.get(x, (0, 0))[0])
    df['估价高(元)'] = df['价格区间'].map(lambda x: price_map.get(x, (0, 0))[1])
    df['估价低小计'] = df['估价低(元)'] * df['数量']
    df['估价高小计'] = df['估价高(元)'] * df['数量']

    # 汇总
    total_lo = df['估价低小计'].sum()
    total_hi = df['估价高小计'].sum()
    total_power = (df['单位功率(W)'] * df['数量']).sum()

    with pd.ExcelWriter(filename, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='BOM清单', index=False)
        # 按类别汇总
        cat_summary = df.groupby('类别').agg(
            数量=('数量', 'sum'),
            估价低合计=('估价低小计', 'sum'),
            估价高合计=('估价高小计', 'sum'),
            总功率W=('单位功率(W)', lambda x: (x * df.loc[x.index, '数量']).sum()),
        ).reset_index()
        cat_summary.to_excel(writer, sheet_name='类别汇总', index=False)
        # 总计
        total_df = pd.DataFrame([{
            '项目': '总计',
            '设备总数': df['数量'].sum(),
            '估价低(元)': total_lo,
            '估价高(元)': total_hi,
            '总功率(W)': total_power,
            '估价区间': f"¥{total_lo:,} ~ ¥{total_hi:,}",
        }])
        total_df.to_excel(writer, sheet_name='总计', index=False)

    apply_excel_formatting(filename)
    print(f"BOM已导出: {filename} (估价: ¥{total_lo:,} ~ ¥{total_hi:,})")
    return df


def generate_report_data(designer):
    """V2.4: 生成 PDF 报告所需的完整数据（字典格式）

    返回包含以下章节的数据：
    1. 项目概览
    2. 网络架构
    3. 设备清单
    4. 拓扑参数
    5. 功耗与散热
    6. 布线汇总
    7. 成本估算
    8. 校验结果
    """
    from optical_selector import select_module_for_connection, estimate_module_cost

    # 1. 项目概览
    overview = {
        'GPU服务器数': designer.num_servers,
        '存储服务器数': designer.additional_storage,
        '通算服务器数': designer.additional_compute,
        '服务器总数': designer.total_servers,
        '参数网速率': designer.param_speed,
        '存储网速率': designer.storage_speed,
        '下行模式': designer.downlink_mode,
    }

    # 2. 网络架构
    all_switches = (
        designer.param_leaves + designer.param_spines + designer.param_cores +
        designer.storage_leaves + designer.storage_spines + designer.storage_cores +
        designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg
    )
    architecture = {
        '参数网Leaf': len(designer.param_leaves),
        '参数网Spine': len(designer.param_spines),
        '参数网Core': len(designer.param_cores),
        '存储网Leaf': len(designer.storage_leaves),
        '存储网Spine': len(designer.storage_spines),
        '存储网Core': len(designer.storage_cores),
        'OOB接入': len(designer.oob_access),
        'OOB汇聚': len(designer.oob_agg),
        '业务接入': len(designer.biz_access),
        '业务汇聚': len(designer.biz_agg),
        '交换机总数': len(all_switches),
    }

    # 3. 功耗
    server_power = sum(s.power_watts or 0 for s in designer.servers)
    switch_power = sum(sw.power_watts or 0 for sw in all_switches)
    total_power = server_power + switch_power
    power = {
        '服务器功耗(W)': server_power,
        '交换机功耗(W)': switch_power,
        '总IT功耗(W)': total_power,
        '总IT功耗(kW)': round(total_power / 1000, 2),
        '机柜功率限制(W)': designer.power_limit_per_rack,
        '散热方式': '风冷',
    }

    # 4. 校验结果
    validation = designer.validate_topology()

    # 5. 光模块汇总
    seen_conns = set()
    module_stats = {}
    for dev in designer.servers + all_switches:
        for conn in dev.connections:
            if conn.a_device != dev.name:
                continue
            pair_key = tuple(sorted([conn.a_device, conn.z_device])) + (conn.a_port,)
            if pair_key in seen_conns:
                continue
            seen_conns.add(pair_key)
            sel = select_module_for_connection(conn)
            if sel:
                if sel.module_id not in module_stats:
                    module_stats[sel.module_id] = {'count': 0, 'price': sel.price_range, 'spec': sel.spec}
                module_stats[sel.module_id]['count'] += 1

    # 6. 成本估算
    price_map = {'低': (500, 2000), '中': (2000, 8000), '高': (8000, 30000), '极高': (30000, 100000)}
    module_cost_lo = sum(price_map.get(s['price'], (0, 0))[0] * s['count'] for s in module_stats.values())
    module_cost_hi = sum(price_map.get(s['price'], (0, 0))[1] * s['count'] for s in module_stats.values())

    cost = {
        '光模块总数': sum(s['count'] for s in module_stats.values()),
        '光模块估价低(元)': module_cost_lo,
        '光模块估价高(元)': module_cost_hi,
        '光模块估价区间': f"¥{module_cost_lo:,} ~ ¥{module_cost_hi:,}",
    }

    return {
        'overview': overview,
        'architecture': architecture,
        'power': power,
        'validation': validation,
        'modules': module_stats,
        'cost': cost,
        'generated_at': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S'),
    }
