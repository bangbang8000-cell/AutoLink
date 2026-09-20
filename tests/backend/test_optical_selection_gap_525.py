"""AutoLink v5.2.5（R0 止血）— 光模块选型缺陷回归

用例编号与 `docs/AL_5.2.5修复版本测试计划_v1.0_2026-09-18.md` §4 一一对应。

缺陷背景（PRD §1.2）：**两个独立根因**，都会造成"跨速率误配"——把与链路速率不符的
光模块装配上去，从而污染光模块总数与成本估算。

  根因一（AL-F8）：``_parse_speed('1.6T')`` 被解析为 **1**（原实现只取首个数字段），
      使设备库中 8 个 1.6T 光模块在速率维度上**等价于 1G 模块**，于是在**严格匹配路径**
      （并非降级路径）被 1G 带外网线链路选中。
  根因二（AL-F2）：候选为空时的降级分支**忽略速率**、改用"距离最近"，使 25G 业务链路
      被装配 100G / 400G 模块。

用例分层：
  - L1 `TestSpeedParsingBaseline` / `TestTwistedPairExemption` /
    `TestNoCrossSpeedFallback`：单点语义（含 mock 库构造边界）；
  - L3 `TestRealTemplateRegression`：**真实模板端到端归零**——这是发现本缺陷的原始手法
    （把 `reportData.modules` 的计数逐条**回填**到产生它的连接），必须固化为断言，
    否则同类"汇总与明细不一致"的缺陷会再次静默复发；
  - L2 `TestReportContract` / `TestExports`：契约增量与导出同步。
"""
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from models import Connection
from optical_selector import (
    _is_twisted_pair, _module_speed, _parse_speed, resolve_module_selection,
    select_module_for_connection, select_optical_module,
)

_TPL_DIR = Path(__file__).resolve().parents[2] / 'template'

# 用于端到端归零的模板（取"有 1.6T 误配且有同速降级"的代表，避免 CI 时间过长）
_TPL_REGRESSION = ['hygon_dcu_cluster', 'H100-128台-IB', 'H100-64台-RoCE']


def _mk_conn(speed='400G', cable_type='MPO', network_type='param',
             a_cabinet_name='C1', z_cabinet_name='C2', breakout=None):
    """构造一条用于选型的真实连接（机柜名带编号，使距离估算走真实分支）。"""
    return Connection(
        a_device='A', a_port='p1', a_module=speed,
        z_device='Z', z_port='p2', z_module=speed,
        cable_type=cable_type, description='',
        a_cabinet_name=a_cabinet_name, z_cabinet_name=z_cabinet_name,
        a_start_u=1, z_start_u=1,
        network_type=network_type, breakout=breakout,
    )


def _mock_module(mid, speed, distance_m, spec, fiber_type, price='中',
                 breakout=None, description=''):
    """构造一个 mock 光模块（字段与 device_library.LibraryDevice 对齐）。"""
    m = MagicMock()
    m.id = mid
    m.speed = speed
    m.distance_m = distance_m
    m.spec = spec
    m.form_factor = 'OSFP'
    m.fiber_type = fiber_type
    m.price_range = price
    m.description = description or mid
    m.vendors = []
    m.breakout = breakout
    m.power_watts = 0.0
    m.tech_route = ''
    return m


def _mock_library(modules):
    lib = MagicMock()
    lib.get_by_category.return_value = list(modules)
    return lib


def _unique_connections(designer):
    """按**方向敏感**去重键取唯一连接（与 exporter 口径一致；勿改为端点排序键）。"""
    seen = set()
    out = []
    for dev in designer.all_devices():
        for conn in getattr(dev, 'connections', []):
            if conn.a_device != dev.name:
                continue
            key = (conn.a_device, conn.z_device, conn.a_port)
            if key in seen:
                continue
            seen.add(key)
            out.append(conn)
    return out


def _expected_speed(conn):
    """链路期望速率：分裂链路取物理速率（breakout.input_speed），否则取逻辑速率。"""
    bk = conn.breakout if isinstance(getattr(conn, 'breakout', None), dict) else None
    if bk and bk.get('input_speed'):
        return _parse_speed(bk['input_speed'])
    return _parse_speed(conn.a_module)


@pytest.fixture(scope='module')
def designer():
    """hygon_dcu_cluster 设计产物（多组用例共用；建图有成本，故 module 级缓存）。"""
    from designer import NetworkDesignerV2
    return NetworkDesignerV2(str(_TPL_DIR / 'hygon_dcu_cluster' / 'project_config.json'))


@pytest.fixture(scope='module')
def report(designer):
    """hygon_dcu_cluster 的 reportData（契约用例共用同一次生成结果）。"""
    from exporter import generate_report_data
    return generate_report_data(designer)


# ============================================================
# L1 · 速率解析基准（根因一 / AL-F8）
# ============================================================
class TestSpeedParsingBaseline:
    """AL-F8：`_parse_speed` 必须与设备库/其余三处 `_parse_speed_gbps` 口径一致。"""

    @pytest.mark.parametrize('raw,expected', [
        ('1.6T', 1600),
        ('1.6Tbps', 1600),
        ('1600G', 1600),
        ('800G', 800),
        ('400G', 400),
        ('200G', 200),
        ('100G', 100),
        ('25G', 25),
        ('10G', 10),
        ('1G', 1),
        ('', 0),
        (None, 0),
        ('invalid', 0),
    ])
    def test_parse_speed_baseline(self, raw, expected):
        assert _parse_speed(raw) == expected

    @pytest.mark.parametrize('raw', ['1.6T', '1600G', '800G', '400G', '200G', '100G', '25G'])
    def test_consistent_with_exporter_parser(self, raw):
        """与 `exporter._parse_speed_gbps` 同口径（T/TB = ×1000），避免同仓四处各说各话。"""
        from exporter import _parse_speed_gbps
        assert _parse_speed(raw) == int(_parse_speed_gbps(raw))

    def test_library_1_6t_modules_are_1600_not_1(self):
        """设备库中 8 个 1.6T 档位的解析速率必须是 1600。

        这条是根因一的核心断言：原实现下它们是 **1**，因而与 1G 链路"速率相符"。
        """
        from device_library import get_device_library
        lib = get_device_library()
        modules_16t = [m for m in lib.get_by_category('optical_modules')
                       if '1600g' in (getattr(m, 'id', '') or '')]
        assert modules_16t, '设备库应含 1.6T 档位（8 个）'
        for m in modules_16t:
            assert _module_speed(m) == 1600, f'{m.id} 被判为 {_module_speed(m)} Gbps'

    def test_1_6t_never_matches_1g_link(self):
        """1G 链路不得选中 1.6T 档位（T-525-08 的最小样例）。"""
        assert select_optical_module('1G', 10.0, '光纤') is None

    # V5.3.2 回归（T7.4）：本地定制新增 10G 档位（om_10g_sfp_sr_300m，
    # 5090 推理模板业务网 10G 用）⇒ 10G 从"无档位"清单移除，断言 1G/25G 仍无
    @pytest.mark.parametrize('speed', ['1G', '25G'])
    def test_no_module_for_low_speed_without_degrading(self, speed):
        """库内无该速率档位时返回 None——**不得**用其他速率的模块顶上。"""
        assert select_optical_module(speed, 10.0, '光纤') is None

    def test_10g_has_local_module(self):
        """本地定制：10G 档位存在（om_10g_sfp_sr_300m），业务网 10G 可选型。"""
        m = select_optical_module('10G', 10.0, '光纤')
        assert m is not None, '本地定制 10G 模块应可选型'


# ============================================================
# L1 · 双绞线豁免（AL-F1）
# ============================================================
class TestTwistedPairExemption:
    """AL-F1：双绞线（网线）链路无需光模块 → not_applicable。"""

    @pytest.mark.parametrize('cable', [
        '网线', '双绞线', 'CAT5', 'CAT5E', 'CAT6', 'CAT6A 屏蔽', 'UTP', 'UTP-6', 'STP', '网线/双绞线',
    ])
    def test_is_twisted_pair_positive(self, cable):
        assert _is_twisted_pair(cable) is True

    @pytest.mark.parametrize('cable', ['DAC', '铜缆', '光纤', 'MPO', 'AOC', '', None])
    def test_is_twisted_pair_negative(self, cable):
        """DAC / 铜缆**不**豁免：设备库内有 `om_*_dac_3m` 正规档位（决策 DP-525-02）。"""
        assert _is_twisted_pair(cable) is False

    @pytest.mark.parametrize('cable', ['网线', 'CAT6'])
    @pytest.mark.parametrize('speed', ['1G', '10G', '100G'])
    def test_na_never_selects_module(self, speed, cable):
        """豁免**不依赖速率**，且必须在速率匹配之前完成（否则会混入 unmatched）。"""
        conn = _mk_conn(speed=speed, cable_type=cable, network_type='oob')
        outcome = resolve_module_selection(conn)
        assert outcome.status == 'not_applicable'
        assert outcome.selection is None
        assert select_module_for_connection(conn) is None

    def test_dac_still_selects_copper_module(self):
        """DAC 链路正常选型（同柜 3m → 铜缆档）。"""
        conn = _mk_conn(speed='800G', cable_type='DAC',
                        a_cabinet_name='C1', z_cabinet_name='C1')
        outcome = resolve_module_selection(conn)
        assert outcome.status == 'matched'
        assert 'dac' in outcome.selection.module_id


# ============================================================
# L1 · 降级不跨速率（AL-F2）
# ============================================================
class TestNoCrossSpeedFallback:
    """AL-F2：T2 降级只放宽光纤类型，速率恒为硬约束。"""

    def test_no_speed_match_returns_none(self):
        """**语义反转**：旧断言期望"降级后仍能返回一个模块"（`is not None`）。

        该旧断言把缺陷行为固化成了期望值；本版本改为断言返回 ``None``。
        """
        lib = _mock_library([_mock_module('800G-SR8', '800G', 100, 'SR8', 'MMF')])
        assert select_optical_module('999G', 50.0, '', library=lib) is None

    def test_t2_relax_fiber_within_same_speed(self):
        """T2：800G 分裂链路在 MMF 偏好下 T1 为空 → 同速率内放宽光纤，选 800G 档。"""
        lib = _mock_library([
            _mock_module('800G-2x400G-FR4', '800G', 2000, '2xFR4', 'SMF', '极高',
                         breakout={'input_speed': '800G', 'output_speed': '400G', 'count': 2}),
            _mock_module('999G-SR4', '999G', 100, 'SR4', 'MMF'),
        ])
        sel = select_optical_module('800G', 50.0, 'MPO', 'MMF',
                                    library=lib, require_breakout=True)
        assert sel is not None
        assert sel.module_id == '800G-2x400G-FR4'
        assert '光纤放宽' in sel.match_reason, 'T2 降级必须留痕，否则无法追溯'
        assert '999G' not in sel.module_id

    def test_no_relax_marker_on_strict_match(self):
        """T1 严格命中时不得出现降级标记。"""
        lib = _mock_library([_mock_module('800G-SR8', '800G', 100, 'SR8', 'MMF')])
        sel = select_optical_module('800G', 50.0, 'MPO', 'MMF', library=lib)
        assert sel is not None
        assert '光纤放宽' not in sel.match_reason

    def test_distance_never_relaxed(self):
        """距离下限不放宽：宁可报未匹配，也不装配物理上不可达的模块。"""
        lib = _mock_library([_mock_module('400G-DR4', '400G', 500, 'DR4', 'SMF')])
        assert select_optical_module('400G', 900.0, 'MPO', library=lib) is None

    def test_unmatched_reason_missing_speed(self):
        lib = _mock_library([_mock_module('400G-SR4', '400G', 100, 'SR4', 'MMF')])
        outcome = resolve_module_selection(_mk_conn(speed='25G', cable_type='光纤'), lib)
        assert outcome.status == 'unmatched'
        assert '无 25G 档位' in outcome.reason

    def test_unmatched_reason_distance(self):
        """同速档位存在但距离不够 → 原因必须指出"需求 x m / 最长档位 y m"。"""
        lib = _mock_library([_mock_module('400G-DAC', '400G', 3, 'DAC', 'copper')])
        conn = _mk_conn(speed='400G', cable_type='MPO',
                        a_cabinet_name='C1', z_cabinet_name='C11')  # 跨排 50m
        outcome = resolve_module_selection(conn, lib)
        assert outcome.status == 'unmatched'
        assert '距离超出' in outcome.reason

    def test_unmatched_reason_breakout_missing(self):
        """分裂链路无同速分裂档位 → 原因必须区别于"完全缺档"。"""
        lib = _mock_library([_mock_module('800G-SR8', '800G', 100, 'SR8', 'MMF')])
        conn = _mk_conn(speed='800G', cable_type='MPO',
                        breakout={'input_speed': '800G', 'output_speed': '400G', 'count': 2})
        outcome = resolve_module_selection(conn, lib)
        assert outcome.status == 'unmatched'
        assert '分裂档位' in outcome.reason


# ============================================================
# L3 · 真实模板端到端归零（M1 / M2）
# ============================================================
class TestRealTemplateRegression:
    """把"汇总→明细回填"固化为断言：库里声明的模块速率必须等于链路速率。"""

    @pytest.mark.parametrize('tpl', _TPL_REGRESSION)
    def test_library_declared_speed_equals_link_speed(self, tpl):
        """**M1**：逐条回填校验，0 例外。

        只看 `module_id` 会漏；这里查**设备库声明的 `speed` 字段**，才是权威口径
        （正是它被 `_parse_speed` 误读为 1，才导致了根因一）。
        """
        from designer import NetworkDesignerV2
        from device_library import get_device_library

        designer = NetworkDesignerV2(str(_TPL_DIR / tpl / 'project_config.json'))
        lib = get_device_library()
        checked = 0
        for conn in _unique_connections(designer):
            outcome = resolve_module_selection(conn)
            if outcome.selection is None:
                continue
            dev = lib.get(outcome.selection.module_id)
            declared = _parse_speed(getattr(dev, 'speed', '') or '')
            expected = _expected_speed(conn)
            assert declared == expected, (
                f'{tpl}: 连接 {conn.a_device}->{conn.z_device}({conn.a_port}) '
                f'速率 {conn.a_module} 却选中 {outcome.selection.module_id}'
                f'（库内声明 {declared} Gbps，期望 {expected}）'
            )
            checked += 1
        assert checked > 0, f'{tpl} 未产生任何匹配，测试失去意义'

    @pytest.mark.parametrize('tpl', _TPL_REGRESSION)
    def test_no_1_6t_anywhere(self, tpl):
        """**M2**：1.6T 计数归零（基线上 hygon=160 / H100-128台-IB=324）。"""
        from designer import NetworkDesignerV2
        designer = NetworkDesignerV2(str(_TPL_DIR / tpl / 'project_config.json'))
        hits = [c for c in _unique_connections(designer)
                if (o := resolve_module_selection(c)).selection is not None
                and '1600g' in o.selection.module_id]
        assert hits == [], f'{tpl} 仍存在 1.6T 误配：{len(hits)} 条'

    def test_hygon_oob_copper_is_not_applicable(self):
        """hygon 的 1G 带外网线链路（基线 160 条）必须全部归入 not_applicable。"""
        from designer import NetworkDesignerV2
        designer = NetworkDesignerV2(str(_TPL_DIR / 'hygon_dcu_cluster' / 'project_config.json'))
        copper = [c for c in _unique_connections(designer)
                  if _is_twisted_pair(c.cable_type)]
        assert copper, 'hygon 应含双绞线（网线）链路'
        for conn in copper:
            assert resolve_module_selection(conn).status == 'not_applicable'
        assert len(copper) >= 160

    def test_dp3tier_breakout_links_are_covered(self):
        """DP3Tier 参数网 800G 分裂链路（基线 32,768 条**无模块**）应被 T2 承接。

        该模板体量大（12.7 万条连接），只做一次全量三态统计、不做逐条库查询。
        """
        import collections
        from designer import NetworkDesignerV2
        designer = NetworkDesignerV2(str(_TPL_DIR / 'DP3Tier-1024' / 'project_config.json'))
        stats = collections.Counter()
        unmatched_nets = collections.Counter()
        relaxed = 0
        for conn in _unique_connections(designer):
            outcome = resolve_module_selection(conn)
            stats[outcome.status] += 1
            if outcome.status == 'unmatched':
                unmatched_nets[conn.network_type or ''] += 1
            if outcome.selection is not None and '光纤放宽' in (outcome.reason or ''):
                relaxed += 1
        # 参数网（800G 分裂）不得再有"无模块"——基线上这类链路有 32,768 条被漏计
        assert 'param' not in unmatched_nets, f'参数网仍有未匹配：{dict(unmatched_nets)}'
        assert relaxed >= 32768, f'经 T2 同速降级承接的链路数不足：{relaxed}'
        # 未匹配只应来自库内**确实缺档**的低速率网络（25G 业务 / 10G 带外）
        assert set(unmatched_nets) <= {'biz', 'oob'}, dict(unmatched_nets)


# ============================================================
# L2 · reportData 契约（AL-F3 / AL-F4）
# ============================================================
class TestReportContract:
    """契约增量：段存在、三分类守恒、双子树一致、既有段无删。"""

    def test_three_way_conservation(self, report):
        """**M3**：三分类互斥且完备。"""
        ms = report['module_selection']
        assert (ms['匹配链路数'] + ms['无需光模块链路数'] + ms['未匹配链路数']
                == ms['链路总数'] > 0)

    def test_ledger_agrees_with_module_summary(self, report):
        """台账的"匹配数"必须等于型号汇总的计数之和（否则又是一次汇总/明细不一致）。"""
        assert report['module_selection']['匹配链路数'] == \
            sum(m['count'] for m in report['modules'].values())

    def test_unmatched_detail_sums_to_counter(self, report):
        ms = report['module_selection']
        if not ms['未匹配明细截断数']:
            assert sum(d['条数'] for d in ms['未匹配明细']) == ms['未匹配链路数']
        for detail in ms['未匹配明细']:
            assert detail['原因'], '未匹配明细必须给出原因，不得只有计数'
            assert detail['速率'] and detail['条数'] > 0

    def test_cost_caliber_guard(self, report):
        """**M4**：成本口径护栏 + 既有键名不变（向后兼容）。"""
        cost = report['cost']
        assert cost['可用于报价'] is False
        assert cost['口径'] and cost['价格来源'] == 'device_library.price_range'
        assert cost['未匹配链路数'] == report['module_selection']['未匹配链路数']
        for key in ('光模块总数', '光模块估价低(元)', '光模块估价高(元)', '光模块估价区间'):
            assert key in cost, f'既有键 {key} 不得改名或删除'
        assert cost['光模块总数'] == sum(m['count'] for m in report['modules'].values())

    def test_dual_subtree_and_schema_version(self, report):
        """`data` 子树键已英文化；`legacy_data` 同段；`schema_version` 未 bump（纯增量）。"""
        assert report['schema_version'] == 2
        assert 'module_selection' in report['legacy_data']
        assert 'module_selection' in report['data']
        eng = report['data']['module_selection']
        assert eng['matched_count'] == report['module_selection']['匹配链路数']
        assert eng['unmatched_count'] == report['module_selection']['未匹配链路数']
        assert 'note' in eng
        assert isinstance(eng['unmatched_details'], list)
        assert report['data']['cost']['quotable'] is False

    def test_no_existing_section_removed(self, report):
        """**T-525-19**：原有 10 段一个都不能少。"""
        for name in ('overview', 'architecture', 'power', 'validation', 'modules',
                     'cost', 'racks', 'devices', 'convergence', 'generated_at'):
            assert name in report, f'既有段 {name} 丢失'
        assert 'legacy_data' in report['deprecations']


# ============================================================
# L2 · 导出同步（AL-F6）
# ============================================================
class TestExports:
    """布线指导表与 BOM 必须能区分"无需光模块"与"未匹配"。"""

    def test_cabling_guide_has_selection_status(self, designer, tmp_path):
        from exporter import export_cabling_guide
        df = export_cabling_guide(designer, str(tmp_path / 'cabling.xlsx'))
        assert '选型状态' in df.columns
        assert '选型说明' in df.columns
        values = set(df['选型状态'].unique())
        assert {'已匹配', '无需光模块', '未匹配'} <= values, values
        # 未匹配行必须有说明；已匹配行不必有
        unmatched_rows = df[df['选型状态'] == '未匹配']
        assert (unmatched_rows['选型说明'].astype(str) != '').all()

    def test_bom_unmatched_row_keeps_total_consistent(self, designer, tmp_path):
        """BOM 的光模块行合计必须与 reportData 台账对得上（否则"数量对不上"仍无解）。"""
        from exporter import export_bom, generate_report_data
        df = export_bom(designer, str(tmp_path / 'bom.xlsx'))
        modules = df[df['类别'] == '光模块']
        unmatched = modules[modules['设备名称'] == '未匹配（需人工确认）']
        assert len(unmatched) == 1, '未匹配链路必须显式成行，不得静默跳过'

        ledger = generate_report_data(designer)['module_selection']
        matched_rows = modules[modules['设备名称'] != '未匹配（需人工确认）']
        assert int(matched_rows['数量'].sum()) == ledger['匹配链路数']
        assert int(unmatched['数量'].iloc[0]) == ledger['未匹配链路数']
        assert os.path.exists(tmp_path / 'bom.xlsx')

    def test_cabling_header_matches_e009_contract(self, designer, tmp_path):
        """⚠️ 新增列必须同步更新 E009 表头契约（否则 CI step 18 直接红）。

        本用例是**这次踩坑的直接固化**：AL-F6 给布线指导表加了 `选型状态` /
        `选型说明` 两列，但 `validation_engine/export_check.py` 的
        `_HEADER_CONTRACTS['cablingGuide']` 与
        `tests/backend/test_validation_export.py::_CABLING_HEADERS` 两处硬编码
        表头**都未同步** ⇒ `test_sample_assets` 报
        `E009: 导出表头与契约不一致：布线指导表_*.xlsx`。

        因此：**改布线表列定义时，必须同时改这两处**；本用例把"exporter 实际列"
        与"E009 契约"钉在一起，防止再次漂移。
        """
        from exporter import export_cabling_guide
        from validation_engine.export_check import _HEADER_CONTRACTS

        df = export_cabling_guide(designer, str(tmp_path / 'cabling.xlsx'))
        actual = [c for c in df.columns]
        contract = _HEADER_CONTRACTS['cablingGuide']['headers']
        assert actual == contract, (
            f'布线指导表列与 E009 契约不一致\n'
            f'  实际: {actual}\n  契约: {contract}\n'
            f'（改列定义须同步 export_check._HEADER_CONTRACTS 与 '
            f'test_validation_export._CABLING_HEADERS）'
        )

    def test_cabling_status_column_semantics(self, designer, tmp_path):
        """`not_applicable` 必须渲染为「无需光模块」，与 `unmatched` 明确区分。"""
        from exporter import export_cabling_guide
        df = export_cabling_guide(designer, str(tmp_path / 'cabling2.xlsx'))
        assert {'已匹配', '无需光模块', '未匹配'} <= set(df['选型状态'].unique())
        # 「无需光模块」行不得带未匹配原因（否则两类被混在一起）
        na = df[df['选型状态'] == '无需光模块']
        assert (na['选型说明'].astype(str) == '双绞线链路（网线）无需光模块').all()



# ============================================================
# L2 · 文档诚实性（AL-F7 / T-525-14）
# ============================================================
class TestChangelogCorrection:
    """5.2.2 的 CHANGELOG 过度宣称必须被**更正**，且**历史原文不得删除**。

    这不是"文档洁癖"：522-M3 宣称的四项能力（`doctor` 依赖自检 / `pod_sizing` /
    `param_counts` / 重依赖下沉）在代码中**完全不存在**，属"文档超前于实现"。
    若不更正，下游会按"已有依赖治理与冷启动优化"预估部署成本，形成期望落差。
    """

    _ROOT = Path(__file__).resolve().parents[2]

    @staticmethod
    def _section_522(text: str) -> str:
        start = text.index('## [5.2.2]')
        end = text.index('## [5.2.0]')
        return text[start:end]

    def test_correction_block_exists(self):
        text = (self._ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
        section = self._section_522(text)
        assert '更正（2026-09-18）' in section, '5.2.2 段必须含更正标注块'

    @pytest.mark.parametrize('claim', ['doctor', 'pod_sizing', 'param_counts', '重依赖下沉'])
    def test_each_overclaim_is_marked_unimplemented(self, claim):
        text = (self._ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
        section = self._section_522(text)
        # 该宣称必须出现，且同一行须给出"未实现"判语
        hits = [ln for ln in section.splitlines() if claim in ln]
        assert hits, f'更正块必须逐条列出 {claim}'
        assert any('未实现' in ln for ln in hits), f'{claim} 未给出"未实现"实际状态'

    @pytest.mark.parametrize('claim', ['doctor', 'pod_sizing', 'param_counts', '重依赖下沉'])
    def test_claim_really_absent_from_code(self, claim):
        """交叉验证：文档说"未实现"，代码里就真的搜不到（防止更正本身也失真）。"""
        backend = self._ROOT / 'backend'
        found = [
            p for p in backend.rglob('*.py')
            if claim in p.read_text(encoding='utf-8', errors='ignore')
        ]
        assert not found, f'{claim} 竟然存在于 {found[:3]}，更正块结论需重核'

    def test_original_milestone_text_preserved(self):
        """历史条目原文必须保留（只许新增，不许改写历史）。"""
        text = (self._ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
        section = self._section_522(text)
        for original in (
            '**522-M3 引擎正确性与性能**',
            '`doctor` 依赖自检',
            '`pod_sizing` / `param_counts` 参数化',
            '**522-M1 对外契约止血**',
        ):
            assert original in section, f'历史原文被删改：{original}'

    def test_selfcheck_is_real_and_not_overclaimed(self):
        """对照组：`selfcheck` 确实有实现，更正块不得把已交付项也一并否掉。"""
        manager = self._ROOT / 'backend' / 'autolink_hub' / 'mcp_server' / 'manager.py'
        assert 'def selfcheck' in manager.read_text(encoding='utf-8')

