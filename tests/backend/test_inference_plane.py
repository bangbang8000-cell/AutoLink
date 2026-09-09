"""5.2.2-522-f: 推理加速平面（D4）测试

推理 4 合 1 = 3 合 1（eth_combined）+ 独立精简参数面（小型交换机域，收敛比 1:1~3:1）。
覆盖：
  - inference_plane_topology 层次计算（收敛比 → 下行端口/Leaf 数量）
  - designer 集成：inference_plane=true + inference_servers=N → 生成推理 Leaf、前 N 台服务器接入推理域、
    推理域独立于主参数网（叠加），校验通过
  - inference_plane=false / inference_servers=0 时不生成推理域（无回归）
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backend'))

from inference_plane_topology import InferencePlaneTopology
from designer import NetworkDesignerV2


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _inference_4in1_config(name="bk_inf", servers=16, inference_servers=4):
    """推理 4 合 1：eth_combined=true + inference_plane=true + inference_servers=N"""
    cfg = {
        'meta': {'name': name},
        'topology': {
            'num_gpu_servers': servers,
            'num_all_flash_storage': 1,
            'num_compute_servers': 1,
            'param_protocol': 'RoCE',
            'param_speed': '400G',
            'param_ports_per_server': 8,
            'param_switch_ports': 64,
            'storage_ports_per_server': 1,
            'storage_speed': '200G',
            'storage_switch_ports': 48,
            'inference_plane': True,
            'inference_servers': inference_servers,
            'inference_speed': '400G',
            'inference_convergence': 3,
        },
        'networks': {
            'param_network': True,
            'storage_network': True,
            'biz_network': True,
            'oob_network': True,
            'eth_combined': True,
        },
    }
    return cfg


class TestInferencePlaneTopology:
    def test_hierarchy_convergence_1to1(self):
        """收敛比 1:1 → 下行端口 = 交换机端口一半；Leaf 数 = ceil(总网卡/下行)"""
        topo = InferencePlaneTopology(nics_per_server=2, switch_ports=64,
                                      convergence=1, speed='400G')
        stat = topo.calculate_hierarchy(num_inference_servers=32)
        # 1:1 → downlink = 64*1/2 = 32；32 台 × 2 口 = 64 → 64/32 = 2 Leaf
        assert stat['downlink_per_leaf'] == 32, stat
        assert stat['leaf_count'] == 2, stat

    def test_hierarchy_convergence_3to1(self):
        """收敛比 3:1 → 下行端口 = 交换机端口 3/4（更精简、Leaf 更少）"""
        topo = InferencePlaneTopology(nics_per_server=2, switch_ports=64,
                                      convergence=3, speed='400G')
        stat = topo.calculate_hierarchy(num_inference_servers=32)
        # 3:1 → downlink = 64*3/4 = 48；64 口 / 48 = 2 Leaf（ceil）
        assert stat['downlink_per_leaf'] == 48, stat
        assert stat['leaf_count'] == 2, stat

    def test_hierarchy_grows_with_servers(self):
        """推理服务器增加 → Leaf 数增长"""
        topo = InferencePlaneTopology(nics_per_server=2, switch_ports=64, convergence=3)
        small = topo.calculate_hierarchy(num_inference_servers=16)['leaf_count']
        large = topo.calculate_hierarchy(num_inference_servers=64)['leaf_count']
        assert large >= small

    def test_create_and_wire(self):
        """创建推理 Leaf + 接线：每台推理服务器 nics_per_server 口全部接入推理域"""
        topo = InferencePlaneTopology(nics_per_server=2, switch_ports=64, convergence=3)
        stat = topo.calculate_hierarchy(num_inference_servers=8)
        topo.create_network_objects(stat)
        assert len(topo.leaves) == stat['leaf_count']
        from models import NetworkObject
        servers = []
        for i in range(1, 9):
            s = NetworkObject(name=f"推理服务器_{i}", obj_type='server', max_ports=64)
            s.server_index = i
            servers.append(s)
        conns = topo.generate_connections(servers)
        # 8 台 × 2 口 = 16 条连接（单向服务器→Leaf，双向 Connection 数量为 2 倍）
        server_side = [c for c in conns if c.network_type == 'inference' and c.a_device.startswith('推理服务器')]
        assert len(server_side) == 8 * 2, len(server_side)


class TestDesignerInferencePlane:
    def test_inference_4in1_generates_inference_domain(self, tmp_path):
        """designer: inference_plane=true + inference_servers=N → 生成推理 Leaf、前 N 台接入推理域、校验通过"""
        d = NetworkDesignerV2(str(_write(tmp_path, _inference_4in1_config())))
        assert getattr(d, 'inference_plane', False) is True
        assert len(d.inference_leaves) > 0, '应生成推理 Leaf'
        # 推理服务器接入推理域（前 inference_servers 台）
        inference_conns = [c for s in d.servers for c in s.connections
                           if c.network_type == 'inference' and c.a_device == s.name]
        assert inference_conns, '推理域无连接'
        # 每台推理服务器（前 4 台）至少 1 条推理连接
        inference_servers_conn = {}
        for c in inference_conns:
            inference_servers_conn.setdefault(c.a_device, 0)
            inference_servers_conn[c.a_device] += 1
        assert len(inference_servers_conn) == 4, inference_servers_conn
        vr = d.validate_topology()
        assert vr['valid'], vr['errors']

    def test_inference_plane_disabled_no_domain(self, tmp_path):
        """inference_plane=false → 不生成推理域（无回归）"""
        cfg = _inference_4in1_config(inference_servers=4)
        cfg['topology']['inference_plane'] = False
        d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
        assert len(d.inference_leaves) == 0
        inference_conns = [c for s in d.servers for c in s.connections
                           if c.network_type == 'inference']
        assert not inference_conns

    def test_inference_servers_zero_no_domain(self, tmp_path):
        """inference_plane=true 但 inference_servers=0 → 不生成推理域"""
        d = NetworkDesignerV2(str(_write(tmp_path, _inference_4in1_config(inference_servers=0))))
        assert len(d.inference_leaves) == 0
