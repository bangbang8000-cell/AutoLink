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

    def test_default_engine_has_13_rules(self, engine):
        """默认引擎含 13 条规则 (V001-V013, V2.7.5 新增 V013)"""
        assert engine.get_rule_count() == 13

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
