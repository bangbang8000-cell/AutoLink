"""
AutoLink V1.1 - 入口
智能网络设计工具：自动生成AI智算中心参数网络和存储网络的连接关系表
"""

import datetime
from designer import NetworkDesigner
from exporter import export_all_connections

if __name__ == "__main__":
    designer = NetworkDesigner("network_config.ini")
    designer.print_summary()
    designer.validate_topology()

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    output_filename = f"AI智算网络连接表_{timestamp}.xlsx"
    export_all_connections(designer, output_filename)
