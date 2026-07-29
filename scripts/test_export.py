"""测试 V2.4 导出功能：布线表、BOM、报告数据"""
import sys, os, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from designer import NetworkDesignerV2
from exporter import export_cabling_guide, export_bom, generate_report_data

ini = os.path.join(os.path.dirname(__file__), '..', 'template', 'L20-推理-64', 'network_config.ini')
d = NetworkDesignerV2(ini)

with tempfile.TemporaryDirectory() as tmpdir:
    # 1. 布线表
    cab_file = os.path.join(tmpdir, 'cabling.xlsx')
    df_cab = export_cabling_guide(d, cab_file)
    print(f"\n=== 布线指导表 ===")
    print(f"总行数: {len(df_cab)}")
    print(f"光模块型号分布:")
    if not df_cab.empty:
        print(df_cab.groupby('光模块型号').agg(数量=('A端设备', 'count')).to_string())

    # 2. BOM
    bom_file = os.path.join(tmpdir, 'bom.xlsx')
    df_bom = export_bom(d, bom_file)
    print(f"\n=== BOM 清单 ===")
    print(f"总行数: {len(df_bom)}")
    print(f"类别汇总:")
    if not df_bom.empty:
        summary = df_bom.groupby('类别').agg(数量=('数量', 'sum'), 估价低=('估价低小计', 'sum'), 估价高=('估价高小计', 'sum')).reset_index()
        print(summary.to_string(index=False))

    # 3. 报告数据
    report = generate_report_data(d)
    print(f"\n=== 报告数据 ===")
    print(f"概览: {report['overview']}")
    print(f"架构: {report['architecture']}")
    print(f"功耗: {report['power']}")
    print(f"校验: valid={report['validation']['valid']}")
    print(f"成本: {report['cost']}")
    print(f"光模块型号: {list(report['modules'].keys())}")

print("\n[OK] 所有导出功能测试通过")
