"""
AutoLink v2.9.0 T7 — rack_allocation.py 机柜分配算法测试

覆盖（对标 v2.9.X PRD 3.2 验收基准）:
  - GPU 高功率独占: DGX H100/H200 单柜 1 台
  - GPU 功率装箱: Atlas 6.5KW 16KW 柜 2 台、MLU590 3.8KW 12KW 柜 3 台
  - 通算/存储装箱: 2U 0.8KW 12KW 柜 15 台
  - 网络设备聚柜: 1U 0.2KW 交换机 U 位约束 42 台/柜
  - gpu_dedicated 开关、U 位无冲突、功率边界、分阶段 seed
"""
import pytest
from rack_allocation import (
    RackAllocator, DeviceSlot, CabinetAllocation,
    infer_device_type, infer_network,
    DEVICE_TYPE_GPU, DEVICE_TYPE_COMPUTE, DEVICE_TYPE_STORAGE, DEVICE_TYPE_NETWORK,
    GPU_DEDICATE_RATIO,
)


def make_servers(name_prefix, count, power, u_height, dtype, group=""):
    """批量构造设备槽位"""
    return [DeviceSlot(name=f"{name_prefix}_{i}", obj_type='server', group=group or name_prefix,
                       power_watts=power, u_height=u_height, device_type=dtype)
            for i in range(1, count + 1)]


def assert_u_no_conflict(cabinets):
    """断言所有柜内设备 U 位无重叠"""
    for cab in cabinets:
        occupied = []
        for d in cab.devices:
            for u in range(d.start_u, d.end_u + 1):
                assert u not in occupied, f"柜{cab.name} U位 {u} 冲突: {d.name}"
                occupied.append(u)


def assert_power_ok(cabinets):
    """断言每柜功率不超过上限"""
    for cab in cabinets:
        assert cab.total_power <= cab.power_limit, f"柜{cab.name} 超功率 {cab.total_power}W > {cab.power_limit}W"


def assert_u_ok(cabinets, rack_type):
    """断言每柜 U 位不超机柜容量"""
    for cab in cabinets:
        assert cab.used_u <= rack_type, f"柜{cab.name} U位超限 {cab.used_u}U > {rack_type}U"


class TestInfer:
    """设备类型/网段推断测试"""

    def test_gpu_group(self):
        assert infer_device_type('server', 'GPU服务器组1') == DEVICE_TYPE_GPU

    def test_storage_group(self):
        assert infer_device_type('server', '存储服务器组') == DEVICE_TYPE_STORAGE

    def test_compute_group(self):
        assert infer_device_type('server', '通算服务器组') == DEVICE_TYPE_COMPUTE

    def test_switch_obj_type(self):
        assert infer_device_type('param_leaf') == DEVICE_TYPE_NETWORK
        assert infer_device_type('storage_spine') == DEVICE_TYPE_NETWORK
        assert infer_device_type('oob_access') == DEVICE_TYPE_NETWORK

    def test_network_extract(self):
        assert infer_network('param_leaf') == 'param'
        assert infer_network('storage_spine') == 'storage'
        assert infer_network('oob_access') == 'oob'
        assert infer_network('biz_agg') == 'biz'
        assert infer_network('server') == ''


class TestGpuDedicated:
    """GPU 高功率独占机柜测试"""

    def test_h100_12kw_one_per_cabinet(self):
        """128×DGX H100 (10.2KW/8U) + 12KW 柜 → 128 柜, 1 台/柜"""
        devices = make_servers('GPU服务器', 128, 10200, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000, naming_prefix='机柜')
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 128
        for cab in allocator.cabinets:
            assert cab.device_count == 1
            assert cab.total_power == 10200
        assert_u_no_conflict(allocator.cabinets)
        assert_power_ok(allocator.cabinets)

    def test_h200_16kw_one_per_cabinet(self):
        """128×HGX H200 (12KW/8U) + 16KW 柜 → 128 柜, 1 台/柜"""
        devices = make_servers('GPU服务器', 128, 12000, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=16000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 128
        for cab in allocator.cabinets:
            assert cab.device_count == 1

    def test_atlas_16kw_two_per_cabinet(self):
        """32×Atlas (6.5KW/8U) + 16KW 柜 → 16 柜, 2 台/柜 (6.5×2=13 ≤ 16)"""
        devices = make_servers('GPU服务器', 32, 6500, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=16000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 16
        for cab in allocator.cabinets:
            assert cab.device_count == 2
            assert cab.total_power == 13000
        assert_u_no_conflict(allocator.cabinets)

    def test_atlas_12kw_one_per_cabinet(self):
        """32×Atlas (6.5KW) + 12KW 柜 → 32 柜 (6.5×2=13 > 12, 独占)"""
        devices = make_servers('GPU服务器', 32, 6500, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 32
        for cab in allocator.cabinets:
            assert cab.device_count == 1

    def test_mlu590_12kw_three_per_cabinet(self):
        """30×MLU590 (3.8KW/4U) + 12KW 柜 → 10 柜, 3 台/柜 (3.8×3=11.4 ≤ 12)"""
        devices = make_servers('GPU服务器', 30, 3800, 4, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 10
        for cab in allocator.cabinets:
            assert cab.device_count == 3
            assert cab.total_power == 11400
        assert_u_no_conflict(allocator.cabinets)
        assert_u_ok(allocator.cabinets, 42)

    def test_gpu_dedicated_flag(self):
        """gpu_dedicated=True 时 3.8KW GPU 也独占机柜"""
        devices = make_servers('GPU服务器', 30, 3800, 4, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000, gpu_dedicated=True)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 30
        for cab in allocator.cabinets:
            assert cab.device_count == 1


class TestComputeStorage:
    """通算/存储装箱测试"""

    def test_compute_15_per_cabinet_12kw(self):
        """128×通算 (0.8KW/2U) + 12KW 柜 → 9 柜, 前 8 柜 15 台"""
        devices = make_servers('通算服务器', 128, 800, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 9
        full_cabs = allocator.cabinets[:8]
        for cab in full_cabs:
            assert cab.device_count == 15
            assert cab.total_power == 12000  # 功率恰好占满
            assert cab.used_u == 30
        assert allocator.cabinets[-1].device_count == 8
        assert_u_no_conflict(allocator.cabinets)
        assert_power_ok(allocator.cabinets)

    def test_compute_20_per_cabinet_16kw(self):
        """40×通算 (0.8KW/2U) + 16KW 柜 → 2 柜, 20 台/柜"""
        devices = make_servers('通算服务器', 40, 800, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=16000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 2
        for cab in allocator.cabinets:
            assert cab.device_count == 20
            assert cab.total_power == 16000

    def test_storage_mixed_u_height(self):
        """存储柜容纳不同 U 高设备: 4U 0.9KW + 2U 0.6KW 混合装箱"""
        devices = make_servers('存储服务器', 20, 900, 4, DEVICE_TYPE_STORAGE)
        devices += make_servers('存储服务器', 10, 600, 2, DEVICE_TYPE_STORAGE)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert_u_no_conflict(allocator.cabinets)
        assert_power_ok(allocator.cabinets)
        assert_u_ok(allocator.cabinets, 42)
        for cab in allocator.cabinets:
            assert cab.type == 'storage'


class TestNetwork:
    """网络设备聚柜测试"""

    def test_switch_u_constraint(self):
        """64×1U 交换机 (0.2KW) + 12KW 柜 → 2 柜 (42+22, U 位约束)"""
        devices = [DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf',
                              group='参数Leaf组', power_watts=200, u_height=1,
                              device_type=DEVICE_TYPE_NETWORK, network='param')
                   for i in range(1, 65)]
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 2
        assert allocator.cabinets[0].device_count == 42
        assert allocator.cabinets[1].device_count == 22
        assert_u_no_conflict(allocator.cabinets)
        assert_u_ok(allocator.cabinets, 42)

    def test_switch_same_network_grouping(self):
        """同网段交换机优先同柜聚柜"""
        devices = []
        for i in range(1, 21):
            devices.append(DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf',
                                      group='参数Leaf组', power_watts=200, u_height=1,
                                      device_type=DEVICE_TYPE_NETWORK, network='param'))
        for i in range(1, 21):
            devices.append(DeviceSlot(name=f"存储Leaf_{i}", obj_type='storage_leaf',
                                      group='存储Leaf组', power_watts=300, u_height=1,
                                      device_type=DEVICE_TYPE_NETWORK, network='storage'))
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        # 同网段聚柜: param 20 台 + storage 20 台各自一个柜（不混柜）
        assert len(allocator.cabinets) == 2
        for cab in allocator.cabinets:
            nets = {d.network for d in cab.devices}
            assert len(nets) == 1
        assert_u_no_conflict(allocator.cabinets)

    def test_high_power_switch(self):
        """51.2T CPO (3.5KW/4U) + 12KW 柜 → 3 台/柜"""
        devices = [DeviceSlot(name=f"参数Core_{i}", obj_type='param_core',
                              group='参数Core组', power_watts=3500, u_height=4,
                              device_type=DEVICE_TYPE_NETWORK, network='param')
                   for i in range(1, 10)]
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 3
        for cab in allocator.cabinets:
            assert cab.device_count == 3
            assert cab.total_power == 10500
        assert_u_no_conflict(allocator.cabinets)


class TestEdgeCases:
    """边界场景测试"""

    def test_power_exactly_at_limit(self):
        """2×6KW 设备 + 12KW 柜 → 2 台共柜 (功率恰好=上限)"""
        devices = make_servers('通算服务器', 2, 6000, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 1
        assert allocator.cabinets[0].device_count == 2
        assert allocator.cabinets[0].total_power == 12000

    def test_u_exactly_at_limit(self):
        """21×2U 设备 + 42U 柜 (0.5KW, 无顶部预留) → 1 柜满 U 位"""
        devices = make_servers('通算服务器', 21, 500, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=0)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 1
        assert allocator.cabinets[0].used_u == 42

    def test_single_device(self):
        """单设备分配"""
        devices = make_servers('GPU服务器', 1, 10200, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 1
        d = devices[0]
        assert d.cabinet_id == 1
        assert d.start_u == 1
        assert d.end_u == 8
        assert d.cabinet_name == '机柜1'

    def test_empty_devices(self):
        """空设备列表 → 无机柜"""
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate([])
        assert allocator.cabinets == []

    def test_zero_power_zero_u(self):
        """零功率零U设备不产生异常"""
        devices = [DeviceSlot(name='x', obj_type='server', power_watts=0, u_height=0,
                              device_type=DEVICE_TYPE_COMPUTE)]
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 1

    def test_percent_and_exceeded(self):
        """机柜利用率与超限标记 (15×0.8KW=12KW 恰好占满)"""
        devices = make_servers('通算服务器', 15, 800, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        cab = allocator.cabinets[0]
        assert cab.percent == pytest.approx(100.0, abs=0.1)
        assert not cab.exceeded


class TestMixedAndSeed:
    """混合场景与分阶段分配测试"""

    def test_mixed_scenario(self):
        """128 GPU + 32 通算 + 16 存储 + 40 交换机混合分配"""
        devices = make_servers('GPU服务器', 128, 10200, 8, DEVICE_TYPE_GPU, group='GPU服务器组')
        devices += make_servers('通算服务器', 32, 800, 2, DEVICE_TYPE_COMPUTE, group='通算服务器组')
        devices += make_servers('存储服务器', 16, 800, 2, DEVICE_TYPE_STORAGE, group='存储服务器组')
        devices += [DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf',
                               group='参数Leaf组', power_watts=200, u_height=1,
                               device_type=DEVICE_TYPE_NETWORK, network='param')
                    for i in range(1, 41)]
        allocator = RackAllocator(rack_type=42, power_limit=12000, naming_prefix='机柜')
        allocator.allocate(devices)
        # 128 GPU 独占 + 通算 3 柜(15+15+2) + 存储 2 柜(15+1) + 网络 1 柜(40 台 U 位 40)
        assert len(allocator.cabinets) == 128 + 3 + 2 + 1
        assert_u_no_conflict(allocator.cabinets)
        assert_power_ok(allocator.cabinets)
        assert_u_ok(allocator.cabinets, 42)
        # 类型正确
        gpu_cabs = [c for c in allocator.cabinets if c.type == 'gpu']
        net_cabs = [c for c in allocator.cabinets if c.type == 'network']
        assert len(gpu_cabs) == 128
        assert len(net_cabs) == 1

    def test_seed_staged_allocation(self):
        """分阶段分配: 先服务器后交换机, 机柜编号连续"""
        servers = make_servers('GPU服务器', 4, 10200, 8, DEVICE_TYPE_GPU)
        switches = [DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf',
                               group='参数Leaf组', power_watts=200, u_height=1,
                               device_type=DEVICE_TYPE_NETWORK, network='param')
                    for i in range(1, 5)]
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(servers)
        assert len(allocator.cabinets) == 4
        allocator2 = RackAllocator(rack_type=42, power_limit=12000)
        allocator2.seed(allocator.cabinets)
        allocator2.allocate(switches)
        assert len(allocator2.cabinets) == 5
        assert switches[0].cabinet_id == 5
        assert allocator2.cabinets[-1].name == '机柜5'

    def test_scaleup_domain_contiguous_cabinets(self):
        """R4.1: Scale-Up 同域 GPU 聚柜 — 按域分组输入时柜号连续 (域=GPU服务器组)"""
        # 域1: 8 台 GPU, 域2: 8 台 GPU (H100 独占)
        devices = []
        for domain in (1, 2):
            for i in range(1, 9):
                devices.append(DeviceSlot(
                    name=f"GPU_{domain}_{i}", obj_type='server',
                    group=f"GPU服务器组{domain}",
                    power_watts=10200, u_height=8, device_type=DEVICE_TYPE_GPU,
                ))
        allocator = RackAllocator(rack_type=42, power_limit=12000)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 16
        # 域1 的 8 台独占柜号连续 (1-8), 域2 连续 (9-16)
        domain1_ids = [d.cabinet_id for d in devices if 'GPU_1_' in d.name]
        domain2_ids = [d.cabinet_id for d in devices if 'GPU_2_' in d.name]
        assert sorted(domain1_ids) == list(range(1, 9))
        assert sorted(domain2_ids) == list(range(9, 17))
        # 每柜单台独占
        for cab in allocator.cabinets:
            assert cab.device_count == 1


class TestDirectionalMounting:
    """M5 方向化上架：服务器从底部向上、网络从顶部向下、顶部预留 2U（默认可配）"""

    def test_gpu_bottom_up_with_top_reserved(self):
        """GPU 从底部 U1 向上连续上架，顶部预留 2U 为空（42U 柜 → 最高占用 ≤ 40）"""
        devices = make_servers('GPU服务器', 4, 10200, 8, DEVICE_TYPE_GPU)
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=2)
        allocator.allocate(devices)
        cabs = [c for c in allocator.cabinets if c.devices]
        for cab in cabs:
            assert cab.devices[0].start_u == 1
            assert cab.devices[0].end_u == 8
            assert cab.used_u_top == 0
        assert all(d.end_u <= 40 for c in cabs for d in c.devices)

    def test_network_top_down(self):
        """网络设备从顶部向下：最高位 = usable_u = totalU - top_reserved_u，然后向下"""
        switches = [DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf', group='参数Leaf组',
                               power_watts=200, u_height=2, device_type=DEVICE_TYPE_NETWORK, network='param')
                    for i in range(1, 4)]
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=2)
        allocator.allocate(switches)
        cab = allocator.cabinets[0]
        starts = sorted(d.start_u for d in cab.devices)
        # 3×2U = 6U，从 40 向下：39-40, 37-38, 35-36
        assert starts == [35, 37, 39]
        assert all(d.end_u <= 40 for d in cab.devices)
        assert cab.used_u_bottom == 0

    def test_servers_bottom_network_top_separate(self):
        """服务器柜全底部、网络柜全顶部，各自无冲突，预留 2U 保持"""
        servers = make_servers('通算服务器', 10, 500, 2, DEVICE_TYPE_COMPUTE)
        switches = [DeviceSlot(name=f"参数Leaf_{i}", obj_type='param_leaf', group='参数Leaf组',
                               power_watts=200, u_height=1, device_type=DEVICE_TYPE_NETWORK, network='param')
                    for i in range(1, 3)]
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=2)
        allocator.allocate(servers + switches)
        assert_u_no_conflict(allocator.cabinets)
        assert_u_ok(allocator.cabinets, 42)
        compute_cab = [c for c in allocator.cabinets if c.type == 'compute'][0]
        net_cab = [c for c in allocator.cabinets if c.type == 'network'][0]
        assert all(d.end_u <= 40 for d in compute_cab.devices + net_cab.devices)
        assert compute_cab.used_u_top == 0
        assert net_cab.used_u_bottom == 0

    def test_top_reserved_config(self):
        """top_reserved_u 可配：0/2/4 影响网络设备最高位"""
        for reserved, expected_top in [(0, 42), (2, 40), (4, 38)]:
            sw = [DeviceSlot(name="参数Leaf_1", obj_type='param_leaf', group='参数Leaf组',
                             power_watts=200, u_height=1, device_type=DEVICE_TYPE_NETWORK, network='param')]
            a = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=reserved)
            a.allocate(sw)
            assert sw[0].end_u == expected_top, f'top_reserved_u={reserved} 应占用 U{expected_top}'

    def test_full_bottom_requires_second_cabinet(self):
        """默认预留 2U：21×2U=42U 超过可用 40U → 需 2 柜，首柜恰好 40U"""
        devices = make_servers('通算服务器', 21, 500, 2, DEVICE_TYPE_COMPUTE)
        allocator = RackAllocator(rack_type=42, power_limit=12000, top_reserved_u=2)
        allocator.allocate(devices)
        assert len(allocator.cabinets) == 2
        assert allocator.cabinets[0].used_u == 40
