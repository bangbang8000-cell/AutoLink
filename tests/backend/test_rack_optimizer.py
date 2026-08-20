"""
打磨轮（v1.5 / AL-R1b）：柜内智能落位优化器测试
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from rack_optimizer import optimize_rack_placements


def _gpu_cab(id_=1, total_u=42, power_limit=6000, devices=None):
    return {
        'id': id_, 'type': 'gpu', 'totalU': total_u, 'power_limit': power_limit,
        'devices': devices or [],
    }


def _dev(did, dtype='GPU Server', height=8, power=1000):
    return {'id': did, 'name': did, 'type': dtype, 'height': height, 'power_watts': power}


def test_place_gpu_into_gpu_cabinet():
    """GPU 设备放进 gpu 柜（1柜1台）"""
    res = optimize_rack_placements([_gpu_cab()], [_dev('gpu-1'), _dev('gpu-2')])
    # 1柜1台上限 → 只放 1 台，另 1 台无位置
    assert res['success'] is True
    assert len(res['placements']) == 1
    assert res['placements'][0]['deviceId'] == 'gpu-1'
    assert res['placements'][0]['startU'] == 1
    assert res['placements'][0]['endU'] == 8
    assert res['unplaced'] == ['gpu-2']


def test_place_gpu_respect_existing_occupancy():
    """GPU 设备避开已占用的 U 位，且受每柜台数上限约束"""
    cab = _gpu_cab(devices=[{'id': 'gpu-0', 'startU': 10, 'endU': 17, 'power_watts': 1000, 'type': 'gpu'}])
    res = optimize_rack_placements([cab], [_dev('gpu-1')])
    # 柜内已 1 台 gpu → 上限 1 → 不再放
    assert res['placements'] == []
    assert res['unplaced'] == ['gpu-1']


def test_place_switch_packs_by_u():
    """交换机（1U）打包进网络柜，超容量换柜"""
    net_cab = {'id': 1, 'type': 'network', 'totalU': 10, 'power_limit': 6000, 'devices': []}
    sw = [_dev(f'sw-{i}', dtype='Switch', height=1, power=100) for i in range(12)]
    res = optimize_rack_placements([net_cab], sw)
    # 10U 容量 → 10 台进柜，2 台无位置
    assert len(res['placements']) == 10
    assert len(res['unplaced']) == 2


def test_power_limit_blocks():
    """功率超限不进柜"""
    cab = _gpu_cab(power_limit=1000, devices=[{'id': 'a', 'startU': 1, 'endU': 2, 'power_watts': 900, 'type': 'gpu'}])
    # 柜内已 900W，再加 200W → 超 1000W 上限 → 拒绝
    cab['devices'] = [{'id': 'a', 'startU': 1, 'endU': 2, 'power_watts': 900}]
    res = optimize_rack_placements([cab], [_dev('gpu-1', power=200)])
    # 但 gpu 每柜台数上限已 1 → gpu-1 也不会进。这里换一个 网络柜验证功率。
    net = {'id': 2, 'type': 'network', 'totalU': 42, 'power_limit': 1000,
           'devices': [{'id': 'a', 'startU': 1, 'endU': 1, 'power_watts': 900}]}
    res2 = optimize_rack_placements([net], [_dev('sw-1', dtype='Switch', height=1, power=200)])
    assert res2['placements'] == []
    assert res2['unplaced'] == ['sw-1']


def test_device_taller_than_rack_unplaced():
    """设备高度超过柜高 → 无位置"""
    cab = _gpu_cab(total_u=42)
    res = optimize_rack_placements([cab], [_dev('big', height=48)])
    assert res['placements'] == []
    assert res['unplaced'] == ['big']
