"""
AutoLink V2.0 - 统一入口
支持 full(满接) / custom(自定义下行口数) 双模式
用法: python main.py [config_file]
"""
import sys, datetime, os
from designer import NetworkDesignerV2
from exporter import export_all_connections

if __name__ == "__main__":
    config_file = sys.argv[1] if len(sys.argv) > 1 else "network_config.ini"
    designer = NetworkDesignerV2(config_file)
    designer.print_summary()
    designer.validate_topology()

    os.makedirs("output", exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    mode = designer.downlink_mode
    fn = os.path.join("output", f"AI智算网络_{mode}模式_{ts}.xlsx")
    export_all_connections(designer, fn)