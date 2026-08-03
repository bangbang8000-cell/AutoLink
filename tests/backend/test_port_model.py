"""V3.0.0-T0-4: 端口模型显式化（downlink/uplink/ports_per_nic + FatTree 显式叶数）

覆盖：
  - 缺省行为与 2.9.9 一致（半口下联、上联从 ceil(ports/2)+1 开始）
  - 显式 downlink_limit/uplink_limit 生效且上联计数器联动
  - ports_per_nic 属性（服务器/交换机）
  - FatTreeTopology 显式 leaf_count 跳过推导
"""
import math
import pytest

from models import NetworkObject
from topology import FatTreeTopology, calc_max_2tier


# ---------- NetworkObject 缺省行为（与 2.9.9 一致） ----------

def test_leaf_default_half_downlink():
    sw = NetworkObject(name="L1", obj_type="param_leaf", max_ports=64)
    assert sw.downlink_limit == math.floor(64 / 2) == 32
    assert sw.uplink_counter == math.ceil(64 / 2) + 1 == 33
    assert sw.uplink_limit == 64
    assert sw.ports_per_nic == 1


def test_spine_default_same_as_leaf():
    sw = NetworkObject(name="S1", obj_type="param_spine", max_ports=64)
    assert sw.downlink_limit == 32
    assert sw.uplink_counter == 33


def test_core_default_full_ports():
    sw = NetworkObject(name="C1", obj_type="param_core", max_ports=64)
    assert sw.core_limit == 64


def test_server_default():
    s = NetworkObject(name="srv", obj_type="server", max_ports=8)
    assert s.port_limit == 8
    assert s.ports_per_nic == 1


# ---------- 显式端口容量 ----------

def test_leaf_explicit_downlink_limit():
    sw = NetworkObject(name="L1", obj_type="param_leaf", max_ports=64,
                       downlink_limit=16)
    assert sw.downlink_limit == 16
    assert sw.uplink_counter == 17  # 上联从下联+1 开始
    ports = [sw.get_downlink_port() for _ in range(16)]
    assert len(ports) == 16
    with pytest.raises(ValueError):
        sw.get_downlink_port()  # 超限


def test_leaf_explicit_uplink_limit():
    sw = NetworkObject(name="L1", obj_type="param_leaf", max_ports=64,
                       downlink_limit=16, uplink_limit=40)
    assert sw.uplink_limit == 40


def test_server_ports_per_nic():
    s = NetworkObject(name="srv", obj_type="server", max_ports=16, ports_per_nic=2)
    assert s.ports_per_nic == 2


def test_leaf_ports_per_nic_exposed():
    sw = NetworkObject(name="L1", obj_type="param_leaf", max_ports=64, ports_per_nic=2)
    assert sw.ports_per_nic == 2


# ---------- FatTreeTopology 显式叶数 ----------

def test_fat_tree_explicit_leaf_count():
    t = FatTreeTopology(ports_per_server=8, switch_ports=64,
                        network_speed="400G", cable_type_config={},
                        leaf_count=8)
    is3, leaves, spines, cores = t.calculate_hierarchy(num_servers=128)
    assert is3 is True
    assert leaves == 8
    assert spines == max(1, 8 // 2) == 4


def test_fat_tree_default_unchanged():
    t = FatTreeTopology(ports_per_server=8, switch_ports=64,
                        network_speed="400G", cable_type_config={})
    is3, leaves, spines, cores = t.calculate_hierarchy(num_servers=64)
    max_2tier = calc_max_2tier(64, 8)
    if 64 <= max_2tier:
        assert is3 is False
    else:
        assert leaves is not None
