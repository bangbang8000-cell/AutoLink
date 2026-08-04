"""
AutoLink v2.7.1 T2 — validation.py 规则校验引擎测试

覆盖 V001-V010 共 10 条校验规则,每条规则至少 1 正例 + 1 反例。
"""
import pytest
from validation import (
    ValidationEngine, ValidationContext, ValidationIssue, Severity,
    create_default_engine,
)


@pytest.fixture
def engine():
    return create_default_engine()


class TestV001ConvergenceRatio:
    """V001: 收敛比校验"""

    def test_passes_when_meets_target(self, engine):
        """正例:收敛比满足目标,无问题"""
        ctx = ValidationContext(convergence_results={
            "param": {"meets_target": True, "convergence_ratio": 1.0, "target_ratio": 1.0},
        })
        issues = engine.validate(ctx)
        v001 = [i for i in issues if i.rule_id == "V001"]
        assert len(v001) == 0

    def test_warns_when_exceeds_target(self, engine):
        """反例:收敛比超标,应报 WARNING"""
        ctx = ValidationContext(convergence_results={
            "param": {"meets_target": False, "convergence_ratio": 2.5, "target_ratio": 1.0},
        })
        issues = engine.validate(ctx)
        v001 = [i for i in issues if i.rule_id == "V001"]
        assert len(v001) == 1
        assert v001[0].severity == Severity.WARNING
        assert "param" in v001[0].message


class TestV002CabinetPower:
    """V002: 机柜功率密度校验"""

    def test_passes_when_within_threshold(self, engine):
        """正例:功率在阈值内"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "power_watts": 10000, "cooling_method": "air"},
        ])
        issues = engine.validate(ctx)
        v002 = [i for i in issues if i.rule_id == "V002"]
        assert len(v002) == 0

    def test_errors_when_exceeds_air_threshold(self, engine):
        """反例:风冷 20kW 超过 15kW 上限"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "power_watts": 20000, "cooling_method": "air"},
        ])
        issues = engine.validate(ctx)
        v002 = [i for i in issues if i.rule_id == "V002"]
        assert len(v002) == 1
        assert v002[0].severity == Severity.ERROR

    def test_passes_with_cold_plate(self, engine):
        """正例:冷板液冷 50kW 在 60kW 上限内"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "power_watts": 50000, "cooling_method": "cold_plate"},
        ])
        issues = engine.validate(ctx)
        v002 = [i for i in issues if i.rule_id == "V002"]
        assert len(v002) == 0


class TestV014GpuCabinetOverload:
    """V014: GPU 高功率柜多台设备告警 (V2.9.3)"""

    def test_passes_when_gpu_cabinet_single_device(self, engine):
        """正例:GPU 柜单台设备(独占)不告警"""
        ctx = ValidationContext(cabinets=[
            {"name": "G1", "type": "gpu", "power_watts": 10200, "power_limit": 12000,
             "items": [{"device_name": "GPU1", "start_u": 1, "end_u": 8}]},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V014"]) == 0

    def test_passes_when_low_power_gpu_multi(self, engine):
        """正例:低功率 GPU 多台共柜且未超 80% 不告警"""
        ctx = ValidationContext(cabinets=[
            {"name": "G1", "type": "gpu", "power_watts": 6000, "power_limit": 12000,
             "items": [{"device_name": "GPU1", "start_u": 1, "end_u": 4},
                       {"device_name": "GPU2", "start_u": 5, "end_u": 8}]},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V014"]) == 0

    def test_warns_when_high_power_gpu_multi(self, engine):
        """反例:高功率 GPU 多台共柜且超上限 80% 应告警"""
        ctx = ValidationContext(cabinets=[
            {"name": "G1", "type": "gpu", "power_watts": 10200, "power_limit": 12000,
             "items": [{"device_name": "GPU1", "start_u": 1, "end_u": 8},
                       {"device_name": "GPU2", "start_u": 9, "end_u": 16}]},
        ])
        issues = engine.validate(ctx)
        v014 = [i for i in issues if i.rule_id == "V014"]
        assert len(v014) == 1
        assert v014[0].severity == Severity.WARNING


class TestV015CabinetUtilization:
    """V015: 机柜利用率过低提示 (V2.9.3)"""

    def test_passes_when_utilized(self, engine):
        """正例:利用率 ≥30% 不提示"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "items": [{"device_name": "D1", "start_u": 1, "end_u": 20}]},
        ], config={"rack_type": 42})
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V015"]) == 0

    def test_info_when_underutilized(self, engine):
        """反例:利用率 <30% 提示 INFO"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "items": [{"device_name": "D1", "start_u": 1, "end_u": 8}]},
        ], config={"rack_type": 42})
        issues = engine.validate(ctx)
        v015 = [i for i in issues if i.rule_id == "V015"]
        assert len(v015) == 1
        assert v015[0].severity == Severity.INFO

    def test_skips_empty_cabinet(self, engine):
        """空柜不提示"""
        ctx = ValidationContext(cabinets=[{"name": "C1", "items": []}], config={"rack_type": 42})
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V015"]) == 0


class TestV003PUETarget:
    """V003: PUE 达标校验"""

    def test_passes_when_pue_low(self, engine):
        """正例:PUE 1.2 < 1.25"""
        ctx = ValidationContext(pue_result={"pue": 1.2, "recommendation": "ok"})
        issues = engine.validate(ctx)
        v003 = [i for i in issues if i.rule_id == "V003"]
        assert len(v003) == 0

    def test_warns_when_pue_high(self, engine):
        """反例:PUE 1.3 > 1.25"""
        ctx = ValidationContext(pue_result={"pue": 1.3, "recommendation": "优化"})
        issues = engine.validate(ctx)
        v003 = [i for i in issues if i.rule_id == "V003"]
        assert len(v003) == 1
        assert v003[0].severity == Severity.WARNING

    def test_no_pue_result(self, engine):
        """正例:无 PUE 结果时不报错"""
        ctx = ValidationContext(pue_result=None)
        issues = engine.validate(ctx)
        v003 = [i for i in issues if i.rule_id == "V003"]
        assert len(v003) == 0


class TestV004PortTypeMatch:
    """V004: 端口类型匹配校验

    v2.7.2: 字段映射改为 a_speed/z_speed (光模块速率决定端口规格)
    """

    def test_passes_when_matching(self, engine):
        """正例:两端光模块速率一致"""
        ctx = ValidationContext(connections=[
            {"name": "c1", "a_speed": "400G", "z_speed": "400G"},
        ])
        issues = engine.validate(ctx)
        v004 = [i for i in issues if i.rule_id == "V004"]
        assert len(v004) == 0

    def test_errors_when_mismatch(self, engine):
        """反例:400G vs 800G 端口规格不匹配"""
        ctx = ValidationContext(connections=[
            {"name": "c1", "a_speed": "400G", "z_speed": "800G"},
        ])
        issues = engine.validate(ctx)
        v004 = [i for i in issues if i.rule_id == "V004"]
        assert len(v004) == 1
        assert v004[0].severity == Severity.ERROR


class TestV005SpeedMatch:
    """V005: 速率匹配校验

    v2.7.2: 改为校验连接速率与网络类型是否匹配
    """

    def test_passes_when_param_speed_ok(self, engine):
        """正例:param 网络 400G 满足最低 100G"""
        ctx = ValidationContext(connections=[
            {"name": "c1", "network_type": "param", "a_speed": "400G"},
        ])
        issues = engine.validate(ctx)
        v005 = [i for i in issues if i.rule_id == "V005"]
        assert len(v005) == 0

    def test_warns_when_param_speed_too_low(self, engine):
        """反例:param 网络 25G 低于 100G 最低要求"""
        ctx = ValidationContext(connections=[
            {"name": "c1", "network_type": "param", "a_speed": "25G"},
        ])
        issues = engine.validate(ctx)
        v005 = [i for i in issues if i.rule_id == "V005"]
        assert len(v005) == 1
        assert v005[0].severity == Severity.WARNING

    def test_warns_when_oob_speed_too_high(self, engine):
        """反例:oob 网络 400G 超过 10G 上限"""
        ctx = ValidationContext(connections=[
            {"name": "c1", "network_type": "oob", "a_speed": "400G"},
        ])
        issues = engine.validate(ctx)
        v005 = [i for i in issues if i.rule_id == "V005"]
        assert len(v005) == 1
        assert v005[0].severity == Severity.WARNING


class TestV006UPositionConflict:
    """V006: U位冲突校验"""

    def test_passes_when_no_conflict(self, engine):
        """正例:U位不重叠"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "device_name": "D1", "start_u": 1, "end_u": 4},
            {"name": "C1", "device_name": "D2", "start_u": 5, "end_u": 8},
        ])
        issues = engine.validate(ctx)
        v006 = [i for i in issues if i.rule_id == "V006"]
        assert len(v006) == 0

    def test_errors_when_conflict(self, engine):
        """反例:U位重叠"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "device_name": "D1", "start_u": 1, "end_u": 6},
            {"name": "C1", "device_name": "D2", "start_u": 4, "end_u": 8},
        ])
        issues = engine.validate(ctx)
        v006 = [i for i in issues if i.rule_id == "V006"]
        assert len(v006) == 1
        assert v006[0].severity == Severity.ERROR


class TestV007RailConsistency:
    """V007: Rail-Optimized 一致性校验"""

    def test_passes_when_consistent(self, engine):
        """正例:端口数 == Rail 数"""
        ctx = ValidationContext(config={"rail_optimized": True, "num_rails": 8, "ports_per_server": 8})
        issues = engine.validate(ctx)
        v007 = [i for i in issues if i.rule_id == "V007"]
        assert len(v007) == 0

    def test_errors_when_inconsistent(self, engine):
        """反例:端口数 4 != Rail 数 8"""
        ctx = ValidationContext(config={"rail_optimized": True, "num_rails": 8, "ports_per_server": 4})
        issues = engine.validate(ctx)
        v007 = [i for i in issues if i.rule_id == "V007"]
        assert len(v007) == 1
        assert v007[0].severity == Severity.ERROR

    def test_skips_when_not_rail(self, engine):
        """正例:非 Rail-Optimized 模式不校验"""
        ctx = ValidationContext(config={"rail_optimized": False})
        issues = engine.validate(ctx)
        v007 = [i for i in issues if i.rule_id == "V007"]
        assert len(v007) == 0


class TestV008OOBReachability:
    """V008: 带外管理网可达性校验"""

    def test_passes_when_oob_switches_exist(self, engine):
        """正例:有 OOB 交换机"""
        ctx = ValidationContext(
            config={"oob_enabled": True},
            switches=[{"name": "OOB-1", "network_type": "oob"}],
        )
        issues = engine.validate(ctx)
        v008 = [i for i in issues if i.rule_id == "V008"]
        assert len(v008) == 0

    def test_warns_when_no_oob_switch(self, engine):
        """反例:无 OOB 交换机"""
        ctx = ValidationContext(config={"oob_enabled": True}, switches=[])
        issues = engine.validate(ctx)
        v008 = [i for i in issues if i.rule_id == "V008"]
        assert len(v008) == 1
        assert v008[0].severity == Severity.WARNING

    def test_skips_when_oob_disabled(self, engine):
        """正例:OOB 关闭时不校验"""
        ctx = ValidationContext(config={"oob_enabled": False}, switches=[])
        issues = engine.validate(ctx)
        v008 = [i for i in issues if i.rule_id == "V008"]
        assert len(v008) == 0


class TestV009StorageRedundancy:
    """V009: 存储网冗余路径校验

    v2.7.2: 字段映射改为 network_type == 'storage' (英文枚举)
    """

    def test_passes_when_dual_links(self, engine):
        """正例:存储网双链路"""
        ctx = ValidationContext(connections=[
            {"source": "Server1", "network_type": "storage"},
            {"source": "Server1", "network_type": "storage"},
        ])
        issues = engine.validate(ctx)
        v009 = [i for i in issues if i.rule_id == "V009"]
        assert len(v009) == 0

    def test_warns_when_single_link(self, engine):
        """反例:仅单链路"""
        ctx = ValidationContext(connections=[
            {"source": "Server1", "network_type": "storage"},
        ])
        issues = engine.validate(ctx)
        v009 = [i for i in issues if i.rule_id == "V009"]
        assert len(v009) == 1
        assert v009[0].severity == Severity.WARNING


class TestV010ParamOversubscription:
    """V010: 参数网过载校验"""

    def test_passes_when_low_ratio(self, engine):
        """正例:收敛比 1.2 < 1.5"""
        ctx = ValidationContext(convergence_results={
            "param": {"convergence_ratio": 1.2},
        })
        issues = engine.validate(ctx)
        v010 = [i for i in issues if i.rule_id == "V010"]
        assert len(v010) == 0

    def test_errors_when_high_ratio(self, engine):
        """反例:收敛比 2.0 > 1.5"""
        ctx = ValidationContext(convergence_results={
            "param": {"convergence_ratio": 2.0},
        })
        issues = engine.validate(ctx)
        v010 = [i for i in issues if i.rule_id == "V010"]
        assert len(v010) == 1
        assert v010[0].severity == Severity.ERROR


class TestEngineBasics:
    """引擎基础功能"""

    def test_default_engine_has_15_rules(self, engine):
        """默认引擎含 20 条规则 (V001-V020, V3.0.2-T2-1 新增 V020 ZCube 结构规则)"""
        assert engine.get_rule_count() == 20

    def test_rule_exception_becomes_error_issue(self, engine):
        """规则函数抛异常时应转为 ERROR issue"""
        def bad_rule(ctx):
            raise ValueError("boom")
        engine.register_rule("V999", "测试", bad_rule)
        issues = engine.validate(ValidationContext())
        v999 = [i for i in issues if i.rule_id == "V999"]
        assert len(v999) == 1
        assert v999[0].severity == Severity.ERROR
        assert "boom" in v999[0].message


class TestV011PUECompliance:
    """V011: PUE ≤ 1.3 政策合规校验 (V2.9.1 补缺)"""

    def test_passes_when_pue_at_1_3(self, engine):
        """正例:PUE 恰好 1.3 不超合规阈值"""
        ctx = ValidationContext(pue_result={"pue": 1.3})
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V011"]) == 0

    def test_warns_when_pue_over_1_3(self, engine):
        """反例:PUE 1.45 超过合规阈值 1.3"""
        ctx = ValidationContext(pue_result={"pue": 1.45})
        issues = engine.validate(ctx)
        v011 = [i for i in issues if i.rule_id == "V011"]
        assert len(v011) == 1
        assert v011[0].severity == Severity.WARNING
        assert "1.3" in v011[0].message

    def test_skips_without_pue_result(self, engine):
        """正例:无 PUE 结果不校验"""
        ctx = ValidationContext(pue_result=None)
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V011"]) == 0


class TestV012LiquidCoolingInterface:
    """V012: 液冷 OCP 冷板标准接口校验 (V2.9.1 补缺)"""

    def test_passes_air_cooled(self, engine):
        """正例:风冷设备不触发 OCP 校验"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "cooling_method": "air"},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V012"]) == 0

    def test_passes_ocp_compatible_coolant(self, engine):
        """正例:冷板液冷 + OCP 兼容冷却液 (PG25)"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "cooling_method": "cold_plate", "coolant": "PG25"},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V012"]) == 0

    def test_warns_incompatible_coolant(self, engine):
        """反例:冷板液冷 + 不兼容冷却液"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "cooling_method": "cold_plate", "coolant": "FC-777"},
        ])
        issues = engine.validate(ctx)
        v012 = [i for i in issues if i.rule_id == "V012"]
        assert len(v012) == 1
        assert v012[0].severity == Severity.WARNING

    def test_skips_unknown_coolant(self, engine):
        """正例:冷板液冷但未指定冷却液 → 不告警(仅 INFO 层面容忍)"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "cooling_method": "cold_plate", "coolant": ""},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V012"]) == 0


class TestV013DomesticRatio:
    """V013: 信创比例校验 (V2.9.1 补缺)"""

    def test_passes_when_ratio_over_50(self, engine):
        """正例:国产设备占比 ≥50% 无提示"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "origin": "domestic"},
            {"name": "S2", "origin": "domestic"},
            {"name": "S3", "origin": "imported"},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V013"]) == 0

    def test_info_when_ratio_under_30(self, engine):
        """反例:国产占比 <30% → INFO"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "origin": "domestic"},
            {"name": "S2", "origin": "imported"},
            {"name": "S3", "origin": "imported"},
            {"name": "S4", "origin": "imported"},
        ])
        issues = engine.validate(ctx)
        v013 = [i for i in issues if i.rule_id == "V013"]
        assert len(v013) == 1
        assert v013[0].severity == Severity.INFO
        assert "25.0%" in v013[0].message

    def test_warning_when_ratio_between_30_50(self, engine):
        """反例:国产占比 30%~50% → WARNING"""
        ctx = ValidationContext(servers=[
            {"name": "S1", "origin": "domestic"},
            {"name": "S2", "origin": "domestic"},
            {"name": "S3", "origin": "imported"},
            {"name": "S4", "origin": "imported"},
            {"name": "S5", "origin": ""},  # 未标注计入总数
        ])
        issues = engine.validate(ctx)
        v013 = [i for i in issues if i.rule_id == "V013"]
        assert len(v013) == 1
        assert v013[0].severity == Severity.WARNING

    def test_skips_no_devices(self, engine):
        """正例:无设备不校验"""
        ctx = ValidationContext()
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V013"]) == 0


class TestV016ServerNicCapacity:
    """V016: 服务器网卡总数 vs Leaf 下行容量 (V2.9.3-T5)"""

    def test_passes_when_capacity_ok(self, engine):
        """正例:网卡需求 ≤ Leaf 容量"""
        ctx = ValidationContext(config={
            "num_servers": 100, "param_ports_per_server": 8,
            "param_leaf_count": 16, "param_dl": 64,
            "total_servers": 110, "storage_ports_per_server": 1,
            "storage_leaf_count": 4, "storage_dl": 40,
        })
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V016"]) == 0

    def test_errors_when_param_nic_exceeds(self, engine):
        """反例:参数网网卡总数超过 Leaf 容量 → ERROR"""
        ctx = ValidationContext(config={
            "num_servers": 100, "param_ports_per_server": 8,
            "param_leaf_count": 8, "param_dl": 32,  # 容量 256 < 需求 800
            "total_servers": 100, "storage_ports_per_server": 1,
            "storage_leaf_count": 4, "storage_dl": 40,
        })
        issues = engine.validate(ctx)
        v016 = [i for i in issues if i.rule_id == "V016"]
        assert len(v016) == 1
        assert v016[0].severity == Severity.ERROR
        assert "参数网" in v016[0].message

    def test_errors_when_storage_nic_exceeds(self, engine):
        """反例:存储网网卡总数超过 Leaf 容量 → ERROR"""
        ctx = ValidationContext(config={
            "num_servers": 100, "param_ports_per_server": 8,
            "param_leaf_count": 16, "param_dl": 64,
            "total_servers": 200, "storage_ports_per_server": 2,
            "storage_leaf_count": 4, "storage_dl": 20,  # 容量 80 < 需求 400
        })
        issues = engine.validate(ctx)
        v016 = [i for i in issues if i.rule_id == "V016"]
        assert len(v016) == 1
        assert "存储网" in v016[0].message


class TestV017OpticalModuleMatch:
    """V017: 光模块封装/距离匹配 (V2.9.3-T5)"""

    def test_passes_when_appropriate(self, engine):
        """正例:OOB 用网线, scale_up 用协议线缆"""
        ctx = ValidationContext(connections=[
            {"source": "S1", "target": "O1", "network_type": "oob",
             "cableType": "网线", "name": "S1->O1"},
            {"source": "GPU_0", "target": "GPU_1", "network_type": "scale_up",
             "cableType": "UALink-Cable", "name": "GPU_0->GPU_1"},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V017"]) == 0

    def test_warns_oob_with_fiber(self, engine):
        """反例:OOB 用 MPO 光纤 → WARNING"""
        ctx = ValidationContext(connections=[
            {"source": "S1", "target": "O1", "network_type": "oob",
             "cableType": "MPO", "name": "S1->O1"},
        ])
        issues = engine.validate(ctx)
        v017 = [i for i in issues if i.rule_id == "V017"]
        assert len(v017) == 1
        assert v017[0].severity == Severity.WARNING

    def test_warns_scale_up_wrong_cable(self, engine):
        """反例:Scale-Up 用非协议线缆 → WARNING"""
        ctx = ValidationContext(connections=[
            {"source": "GPU_0", "target": "GPU_1", "network_type": "scale_up",
             "cableType": "MPO", "name": "GPU_0->GPU_1"},
        ])
        issues = engine.validate(ctx)
        v017 = [i for i in issues if i.rule_id == "V017"]
        assert len(v017) == 1


class TestV018PodDomainScale:
    """V018: Pod/域规模合理性 (V2.9.3-T5)"""

    def test_passes_when_scales_ok(self, engine):
        """正例:Pod 与域规模均在协议范围内"""
        ctx = ValidationContext(config={
            "param_servers_per_pod": 256, "max_2tier": 512,
            "scale_up": {"protocol": "UALink", "num_gpus": 1024, "domain_size": 1024},
        })
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V018"]) == 0

    def test_warns_pod_exceeds(self, engine):
        """反例:Pod 服务器数超单 Pod 容量 → WARNING"""
        ctx = ValidationContext(config={
            "param_servers_per_pod": 600, "max_2tier": 512,
        })
        issues = engine.validate(ctx)
        v018 = [i for i in issues if i.rule_id == "V018"]
        assert len(v018) == 1
        assert v018[0].severity == Severity.WARNING

    def test_errors_scaleup_domain_exceeds(self, engine):
        """反例:Scale-Up 域规模超协议上限 (UB 384) → ERROR"""
        ctx = ValidationContext(config={
            "scale_up": {"protocol": "UB", "num_gpus": 768, "domain_size": 768},
        })
        issues = engine.validate(ctx)
        v018 = [i for i in issues if i.rule_id == "V018"]
        assert len(v018) == 1
        assert v018[0].severity == Severity.ERROR
        assert "UB" in v018[0].message


class TestV019TotalPowerSupply:
    """V019: 整机房功率 vs 供电容量 (V2.9.3-T5)"""

    def test_passes_when_within_supply(self, engine):
        """正例:总功率 ≤ 总供电容量"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "power_watts": 8000, "power_limit": 12000},
            {"name": "C2", "power_watts": 9000, "power_limit": 12000},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V019"]) == 0

    def test_errors_when_exceeds_supply(self, engine):
        """反例:总功率超过总供电容量 → ERROR"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "power_watts": 13000, "power_limit": 12000},
            {"name": "C2", "power_watts": 12000, "power_limit": 12000},
        ])
        issues = engine.validate(ctx)
        v019 = [i for i in issues if i.rule_id == "V019"]
        assert len(v019) == 1
        assert v019[0].severity == Severity.ERROR

    def test_skips_u_records(self, engine):
        """正例:U 位记录(无 power_watts)不参与统计"""
        ctx = ValidationContext(cabinets=[
            {"name": "C1", "device_name": "S1", "start_u": 1, "end_u": 2},
        ])
        issues = engine.validate(ctx)
        assert len([i for i in issues if i.rule_id == "V019"]) == 0
