"""
AutoLink v2.7.1 T4 — optical_selector.py 光模块选型测试

覆盖:
  - _parse_speed / _extract_cabinet_number / _estimate_distance / _get_preferred_spec
  - select_optical_module: 速率匹配 + 距离分级
  - select_module_for_connection
  - estimate_module_cost: 4 档价格区间
"""
import pytest
from unittest.mock import MagicMock, patch
from optical_selector import (
    OpticalSelection,
    _parse_speed, _extract_cabinet_number, _estimate_distance,
    _get_preferred_spec, select_optical_module, select_module_for_connection,
    estimate_module_cost, PRICE_RANGE_MAP,
)


class TestParseSpeed:
    """速率字符串解析"""

    @pytest.mark.parametrize("input_str,expected", [
        ("400G", 400),
        ("800G", 800),
        ("1600G", 1600),
        ("100G", 100),
        ("", 0),
        ("invalid", 0),
        (None, 0),
    ])
    def test_parse(self, input_str, expected):
        assert _parse_speed(input_str) == expected


class TestExtractCabinetNumber:
    """机柜编号提取"""

    @pytest.mark.parametrize("input_str,expected", [
        ("机柜01", 1),
        ("Cabinet-A3", 3),
        ("Rack-12", 12),
        ("C7", 7),
        ("NoNumber", None),
        ("", None),
        (None, None),
    ])
    def test_extract(self, input_str, expected):
        assert _extract_cabinet_number(input_str) == expected


class TestEstimateDistance:
    """距离估算"""

    def test_same_cabinet(self):
        """同柜 3m"""
        assert _estimate_distance("C1", "C1", None, None) == 3.0

    def test_adjacent_cabinets(self):
        """邻柜 5m"""
        assert _estimate_distance("C1", "C2", None, None) == 5.0

    def test_same_area(self):
        """同区 10m (差 3)"""
        assert _estimate_distance("C1", "C4", None, None) == 10.0

    def test_cross_area(self):
        """跨区 20m (差 6)"""
        assert _estimate_distance("C1", "C7", None, None) == 20.0

    def test_cross_row(self):
        """跨排 50m (差 10)"""
        assert _estimate_distance("C1", "C11", None, None) == 50.0

    def test_empty_cabinets(self):
        """无机柜名默认 10m"""
        assert _estimate_distance("", "", None, None) == 10.0

    def test_no_number_in_name(self):
        """机柜名无数字默认 10m"""
        assert _estimate_distance("RackA", "RackB", None, None) == 10.0


class TestGetPreferredSpec:
    """规格推荐"""

    def test_dac_short_distance(self):
        """≤3m 推荐 DAC"""
        assert _get_preferred_spec(2.0, "") == "DAC"

    def test_dac_explicit(self):
        """显式 DAC"""
        assert _get_preferred_spec(10.0, "DAC") == "DAC"

    def test_aoc_explicit(self):
        """显式 AOC"""
        assert _get_preferred_spec(10.0, "AOC") == "AOC"

    def test_sr4_short_fiber(self):
        """≤30m 光纤推荐 SR4"""
        assert _get_preferred_spec(25.0, "MPO") == "SR4"

    def test_sr8_medium_fiber(self):
        """31-100m 推荐 SR8"""
        assert _get_preferred_spec(50.0, "MPO") == "SR8"

    def test_dr4_medium_long(self):
        """101-500m 推荐 DR4"""
        assert _get_preferred_spec(300.0, "MPO") == "DR4"

    def test_fr4_long(self):
        """501-2000m 推荐 FR4"""
        assert _get_preferred_spec(1000.0, "MPO") == "FR4"

    def test_lr4_very_long(self):
        """>2km 推荐 LR4"""
        assert _get_preferred_spec(5000.0, "MPO") == "LR4"


class TestSelectOpticalModule:
    """光模块选型"""

    @pytest.fixture
    def mock_library(self):
        """模拟设备库"""
        lib = MagicMock()
        m1 = MagicMock()
        m1.id = "400G-SR4"
        m1.speed = "400G"
        m1.distance_m = 100
        m1.spec = "SR4"
        m1.form_factor = "QSFP-DD"
        m1.fiber_type = "MMF"
        m1.price_range = "中"
        m1.description = "400G SR4 100m"
        m1.vendors = ["VendorA", "VendorB"]

        m2 = MagicMock()
        m2.id = "400G-DR4"
        m2.speed = "400G"
        m2.distance_m = 500
        m2.spec = "DR4"
        m2.form_factor = "QSFP-DD"
        m2.fiber_type = "SMF"
        m2.price_range = "高"
        m2.description = "400G DR4 500m"
        m2.vendors = ["VendorC"]

        m3 = MagicMock()
        m3.id = "800G-SR8"
        m3.speed = "800G"
        m3.distance_m = 100
        m3.spec = "SR8"
        m3.form_factor = "OSFP"
        m3.fiber_type = "MMF"
        m3.price_range = "高"
        m3.description = "800G SR8"
        m3.vendors = []

        # V3.0.2-T2-11: 1 分 2 分裂线缆（800G 物理口 → 2×400G 逻辑口）
        m4 = MagicMock()
        m4.id = "800G-2x400G-FR4"
        m4.speed = "800G"
        m4.distance_m = 2000
        m4.spec = "2xFR4"
        m4.form_factor = "OSFP"
        m4.fiber_type = "SMF"
        m4.price_range = "极高"
        m4.description = "800G 2x400G FR4"
        m4.vendors = ["VendorA"]
        m4.breakout = {"input_speed": "800G", "output_speed": "400G", "count": 2}

        lib.get_by_category.return_value = [m1, m2, m3, m4]
        return lib

    def test_select_400g_sr4_short(self, mock_library):
        """400G 25m 选 SR4"""
        result = select_optical_module("400G", 25.0, "MPO", library=mock_library)
        assert result is not None
        assert result.module_id == "400G-SR4"
        assert "400G" in result.match_reason

    def test_select_400g_dr4_medium(self, mock_library):
        """400G 300m 选 DR4(距离足够中选最近的)"""
        result = select_optical_module("400G", 300.0, "MPO", library=mock_library)
        assert result is not None
        assert result.module_id == "400G-DR4"

    def test_select_800g(self, mock_library):
        """800G 选 SR8"""
        result = select_optical_module("800G", 50.0, "MPO", library=mock_library)
        assert result is not None
        assert result.module_id == "800G-SR8"

    def test_no_speed_match_fallback(self, mock_library):
        """速率不匹配时降级选距离足够的"""
        result = select_optical_module("999G", 50.0, "", library=mock_library)
        # 降级:忽略速率,选距离足够的
        assert result is not None

    def test_invalid_speed(self, mock_library):
        """无效速率返回 None"""
        result = select_optical_module("", 10.0, "", library=mock_library)
        assert result is None

    def test_empty_library(self):
        """空设备库返回 None"""
        lib = MagicMock()
        lib.get_by_category.return_value = []
        result = select_optical_module("400G", 10.0, "", library=lib)
        assert result is None

    def test_select_breakout_2x400g(self, mock_library):
        """V3.0.2-T2-11: 800G 长距选中 1 分 2 分裂线缆并携带标注"""
        result = select_optical_module("800G", 1500.0, "MPO", "SMF", library=mock_library)
        assert result is not None
        assert result.module_id == "800G-2x400G-FR4"
        assert result.breakout == {"input_speed": "800G", "output_speed": "400G", "count": 2}
        assert "1分2" in result.match_reason

    def test_select_breakout_input_speed_priority(self):
        """V3.0.2-T2-11: 分裂线缆按 input_speed 匹配物理速率（优先于 speed 字段）"""
        lib = MagicMock()
        m = MagicMock()
        m.id = "2x200G-CABLE"
        m.speed = "400G"  # speed 字段与 input_speed 不一致时,以 input_speed 为准
        m.distance_m = 3
        m.spec = "DAC"
        m.form_factor = "QSFP-DD"
        m.fiber_type = "copper"
        m.price_range = "中"
        m.description = "400G 2x200G DAC"
        m.vendors = ["VendorA"]
        m.breakout = {"input_speed": "400G", "output_speed": "200G", "count": 2}
        lib.get_by_category.return_value = [m]

        result = select_optical_module("400G", 2.0, "DAC", library=lib)
        assert result is not None
        assert result.module_id == "2x200G-CABLE"
        assert result.breakout is not None
        assert result.breakout["count"] == 2

    def test_normal_module_no_breakout(self, mock_library):
        """V3.0.2-T2-11: 常规模块返回结果 breakout 为 None"""
        result = select_optical_module("400G", 25.0, "MPO", library=mock_library)
        assert result is not None
        assert result.breakout is None


class TestSelectModuleForConnection:
    """连接级光模块选型"""

    def test_select_for_connection(self):
        """为连接选型"""
        conn = MagicMock()
        conn.a_module = "400G"
        conn.a_cabinet_name = "C1"
        conn.z_cabinet_name = "C2"
        conn.a_start_u = 1
        conn.z_start_u = 2
        conn.cable_type = "MPO"

        with patch("optical_selector.select_optical_module") as mock_select:
            mock_select.return_value = MagicMock(spec=OpticalSelection)
            result = select_module_for_connection(conn)
            assert result is not None
            # 验证调用了 select_optical_module,距离为邻柜 5m
            call_args = mock_select.call_args
            assert call_args[0][0] == "400G"
            assert call_args[0][1] == 5.0


class TestEstimateModuleCost:
    """价格估算"""

    @pytest.mark.parametrize("price_range,expected_range", [
        ("低", (500, 2000)),
        ("中", (2000, 8000)),
        ("高", (8000, 30000)),
        ("极高", (30000, 100000)),
        ("未知", (1000, 5000)),  # 默认
    ])
    def test_cost_estimate(self, price_range, expected_range):
        result = estimate_module_cost(price_range)
        assert result == expected_range

    def test_price_range_map_completeness(self):
        """价格区间映射完整"""
        assert len(PRICE_RANGE_MAP) == 4
        for key, (low, high) in PRICE_RANGE_MAP.items():
            assert low < high
            assert low > 0
