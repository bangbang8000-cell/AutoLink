"""
AutoLink v2.7.1 T3 — estimation.py PUE/收敛比/密度测试

覆盖:
  - estimate_pue: 风冷/冷板/浸没三种散热,温度边界,自然冷,负载率
  - calc_convergence_ratio: 四种网络类型,收敛比上下限
  - estimate_cabinet_power_density: 5 档密度分类
"""
import pytest
from estimation import (
    PUEInput, PUEResult, estimate_pue,
    ConvergenceResult, calc_convergence_ratio,
    estimate_cabinet_power_density,
)


class TestEstimatePUE:
    """PUE 估算测试"""

    def test_air_cooling_baseline(self):
        """风冷 25℃ 无自然冷基准:cooling_pue ≈ 1.33 (V2.7.4-T5: 默认冷通道隔离 -0.02)"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", outdoor_temp_c=25, has_free_cooling=False))
        assert result.cooling_pue == pytest.approx(1.33, abs=0.01)

    def test_cold_plate_baseline(self):
        """冷板 25℃ 无自然冷基准:cooling_pue ≈ 1.16 (V2.7.4-T5: 默认冷通道隔离 -0.02)"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="cold_plate", outdoor_temp_c=25, has_free_cooling=False))
        assert result.cooling_pue == pytest.approx(1.16, abs=0.01)

    def test_immersion_baseline(self):
        """浸没 25℃ 无自然冷基准:cooling_pue ≈ 1.06 (V2.7.4-T5: 默认冷通道隔离 -0.02)"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="immersion", outdoor_temp_c=25, has_free_cooling=False))
        assert result.cooling_pue == pytest.approx(1.06, abs=0.01)

    def test_temperature_effect_air(self):
        """风冷温度系数:35℃ 比 25℃ 高 0.08"""
        r25 = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", outdoor_temp_c=25))
        r35 = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", outdoor_temp_c=35))
        assert r35.cooling_pue > r25.cooling_pue
        assert r35.cooling_pue - r25.cooling_pue == pytest.approx(0.08, abs=0.01)

    def test_free_cooling_reduces_pue(self):
        """自然冷降低 PUE"""
        r_no = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", has_free_cooling=False))
        r_yes = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", has_free_cooling=True))
        assert r_yes.cooling_pue < r_no.cooling_pue

    def test_low_load_penalty(self):
        """低负载(<0.5)时 PUE 有惩罚"""
        r_normal = estimate_pue(PUEInput(it_power_kw=100, load_factor=0.8))
        r_low = estimate_pue(PUEInput(it_power_kw=100, load_factor=0.3))
        assert r_low.cooling_pue > r_normal.cooling_pue

    def test_total_pue_composition(self):
        """综合 PUE = cooling_pue + (pd_pue - 1) + (other_pue - 1)"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air"))
        expected = result.cooling_pue + (result.power_distribution_pue - 1) + (result.other_pue - 1)
        assert result.pue == pytest.approx(expected, abs=0.01)

    def test_meets_target_true(self):
        """PUE < 1.25 满足目标"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="immersion", outdoor_temp_c=15))
        assert result.meets_target is True

    def test_meets_target_false(self):
        """PUE > 1.25 不满足目标"""
        result = estimate_pue(PUEInput(it_power_kw=100, cooling_method="air", outdoor_temp_c=35, has_free_cooling=False))
        assert result.meets_target is False

    def test_ups_loss(self):
        """UPS 损耗 = it_power * (1 - efficiency) * redundancy_factor (V2.7.4-T5: N+1 默认 1.02x)"""
        result = estimate_pue(PUEInput(it_power_kw=1000, ups_efficiency=0.96))
        # 1000 * 0.04 * 1.02 (N+1) = 40.8
        assert result.ups_loss_kw == pytest.approx(40.8, abs=0.1)

    def test_high_power_recommends_cold_plate(self):
        """>5MW 风冷建议升级冷板"""
        result = estimate_pue(PUEInput(it_power_kw=6000, cooling_method="air"))
        assert "冷板" in result.recommendation or "cold_plate" in result.recommendation

    def test_zero_power(self):
        """0 kW 边界"""
        result = estimate_pue(PUEInput(it_power_kw=0))
        assert result.total_power_kw == 0


class TestCalcConvergenceRatio:
    """收敛比计算测试"""

    def test_param_network_1to1(self):
        """参数网 1:1 无阻塞"""
        result = calc_convergence_ratio("param", leaf_downlink_ports=32, leaf_uplink_ports=32, port_speed_gbps=400)
        assert result.convergence_ratio == 1.0
        assert result.meets_target is True
        assert result.is_blocking is False

    def test_param_network_oversubscribed(self):
        """参数网 2:1 超目标"""
        result = calc_convergence_ratio("param", leaf_downlink_ports=48, leaf_uplink_ports=16, port_speed_gbps=400)
        assert result.convergence_ratio == 3.0
        assert result.meets_target is False

    def test_storage_network_target_2(self):
        """存储网目标 2:1"""
        result = calc_convergence_ratio("storage", leaf_downlink_ports=40, leaf_uplink_ports=20, port_speed_gbps=200)
        assert result.target_ratio == 2.0
        assert result.convergence_ratio == 2.0
        assert result.meets_target is True

    def test_biz_network_target_4(self):
        """业务网目标 4:1"""
        result = calc_convergence_ratio("biz", leaf_downlink_ports=48, leaf_uplink_ports=8, port_speed_gbps=25)
        assert result.target_ratio == 4.0
        assert result.convergence_ratio == 6.0
        assert result.meets_target is False

    def test_oob_network_target_8(self):
        """OOB 网目标 8:1"""
        result = calc_convergence_ratio("oob", leaf_downlink_ports=48, leaf_uplink_ports=6, port_speed_gbps=1)
        assert result.target_ratio == 8.0
        assert result.convergence_ratio == 8.0
        assert result.meets_target is True

    def test_zero_uplink(self):
        """上行 0 时收敛比 inf"""
        result = calc_convergence_ratio("param", leaf_downlink_ports=32, leaf_uplink_ports=0, port_speed_gbps=400)
        assert result.convergence_ratio == float('inf')

    def test_multiple_leaves(self):
        """多 Leaf 带宽倍增"""
        r1 = calc_convergence_ratio("param", 32, 32, 400, num_leaves=1)
        r4 = calc_convergence_ratio("param", 32, 32, 400, num_leaves=4)
        assert r4.downlink_bw_gbps == 4 * r1.downlink_bw_gbps
        assert r4.convergence_ratio == r1.convergence_ratio  # 比例不变

    def test_unknown_network_default_target(self):
        """未知网络类型默认 4.0"""
        result = calc_convergence_ratio("unknown", 32, 8, 100)
        assert result.target_ratio == 4.0


class TestEstimateCabinetPowerDensity:
    """机柜功率密度测试"""

    def test_low_density(self):
        """低密度 ≤5kW"""
        result = estimate_cabinet_power_density(total_power_kw=40, num_cabinets=10)
        assert result["power_per_cabinet_w"] == 4000
        assert result["density_level"] == "低密度"
        assert result["recommended_cooling"] == "air"

    def test_medium_density(self):
        """中密度 5-15kW"""
        result = estimate_cabinet_power_density(total_power_kw=100, num_cabinets=10)
        assert result["power_per_cabinet_w"] == 10000
        assert result["density_level"] == "中密度"

    def test_high_density(self):
        """高密度 15-30kW → 冷板"""
        result = estimate_cabinet_power_density(total_power_kw=200, num_cabinets=10)
        assert result["power_per_cabinet_w"] == 20000
        assert result["density_level"] == "高密度"
        assert result["recommended_cooling"] == "cold_plate"

    def test_ultra_high_density(self):
        """超高密度 30-60kW → 冷板"""
        result = estimate_cabinet_power_density(total_power_kw=400, num_cabinets=10)
        assert result["power_per_cabinet_w"] == 40000
        assert result["density_level"] == "超高密度"
        assert result["recommended_cooling"] == "cold_plate"

    def test_extreme_density(self):
        """极限密度 >60kW → 浸没"""
        result = estimate_cabinet_power_density(total_power_kw=700, num_cabinets=10)
        assert result["power_per_cabinet_w"] == 70000
        assert result["density_level"] == "极限密度"
        assert result["recommended_cooling"] == "immersion"

    def test_zero_cabinets_error(self):
        """0 机柜返回 error"""
        result = estimate_cabinet_power_density(total_power_kw=100, num_cabinets=0)
        assert "error" in result
