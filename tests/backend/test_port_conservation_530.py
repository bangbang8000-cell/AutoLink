"""AutoLink v5.3.0（逐层端口守恒）— 业务网端口欠连缺陷回归

用例编号与 `docs/AL_5.3.0修复版本测试计划_v1.0_2026-09-19.md` §2 一一对应。

缺陷背景（PRD §1.2 / §1.3）：
    AL 的业务网「接入 → 汇聚」是 1:1 结构，但**框数按服务器数查表**（而非按端口需求
    推导），且汇聚被错误套用 Spine 的 2 倍收敛豁免。两者叠加 ⇒ 接入上联连接因汇聚端口
    不足被**静默丢弃、从未创建**，而自检只看「服务器覆盖」与「端口溢出」，都过得去。

    实测（修复前，全 23 套仓库自带模板）：
        **11 套欠连，缺口 23.8%–66.0%，且全部 `validation.valid == True`**。
        超大-2048：应连 1504 / 实收 512，缺口 992 条（66.0%）。

根因（PRD §1.4，三处同族「静默」+ 两处建模错误）：
    ① `topology.py:_connect_access_to_agg` 端口满时直接 `continue`，连异常都不抛；
    ② `topology.py` 四处 `except ValueError: print(警告); continue` —— 只进 stdout；
    ③ `designer.py` 自检把 '汇聚' 也一并 2 倍豁免；
    ④ `topology.py:calculate()` 已算出 `total_access_uplinks` 与 `total_agg_ports` 却不比较；
    ⑤ `validation.py` 22 条规则中**无逐层端口守恒**（V021 缺号）。

用例分层：
  - L1 `TestDroppedLinksStructure`：静默丢弃必须结构化可见（AL-G1）；
  - L2 `TestPortConservationContract`：契约段与配置键（AL-G4/G5/G7）；
  - L3 `TestV021Rule`：校验规则**双向留痕**（修复前 ERROR、修复后无 ERROR）；
  - L3 `TestRealTemplateConservation`：**全量模板端口守恒**——发现本缺陷的原始手法，
    必须固化为断言，否则同类「汇总与明细不一致」的缺陷会再次静默复发。
"""
import io
import math
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(_BACKEND))

from designer import NetworkDesignerV2  # noqa: E402
from validation import (  # noqa: E402
    Severity, ValidationContext, create_default_engine,
)

_TPL_DIR = Path(__file__).resolve().parents[2] / 'template'

# 修复前实测欠连的 11 套模板（PRD §1.2 表）——「修复前必红、修复后必绿」
# ⚠️ V5.3.1-531-b：接入上联口默认 8 → 6 后，上联需求整体按 **3/4** 缩放
#    （1504 → 1128 等），框数随之下降。下表为上联口 = 6 口径下的**实测值**。
_UNDERCONNECTED = [
    ('超大-2048', 1128),
    ('大型-1024', 564),
    ('ualink_1_0_1024', 564),
    ('uec_1_0_cluster', 564),
    ('DP3Tier-1024', 504),
    ('H100-512台-RoCE', 312),
    ('中型-512', 288),
    ('SuperPOD-256', 168),
    ('液冷-H100-256', 168),
    ('H100-256台-RoCE', 156),
    ('国产-昇腾-256', 156),
]


def _all_templates():
    if not _TPL_DIR.is_dir():
        return []
    return sorted([
        n for n in os.listdir(_TPL_DIR)
        if (_TPL_DIR / n).is_dir() and (_TPL_DIR / n / 'project_config.json').exists()
    ])


def _design(tpl):
    """静默设计（吞掉 designer 的 stdout 摘要）"""
    buf = io.StringIO()
    with redirect_stdout(buf):
        return NetworkDesignerV2(str(_TPL_DIR / tpl / 'project_config.json'))


def _validate(d):
    buf = io.StringIO()
    with redirect_stdout(buf):
        return d.validate_topology()


def _agg_ports_used(d):
    """汇聚侧实际建立的连接条数（每连接对象只在一端计数）"""
    return sum(1 for a in d.biz_agg for c in a.connections if c.a_device == a.name)


# ================================================================
#  L1 · 静默丢弃必须结构化可见（AL-G1）
# ================================================================

class TestDroppedLinksStructure:
    """T-530-18 / T-530-19 / T-530-20：丢弃链路必须能被上层读到，而非只进 stdout。"""

    def test_underconnected_template_exposes_dropped_links(self):
        """超大-2048 修复后应无丢弃；用「缩小框规格」重建修复前场景验证结构可用。"""
        d = _design('超大-2048')
        info = d.biz_info
        assert 'dropped_links' in info, "biz_info 必须透出 dropped_links（AL-G1）"
        assert info['dropped_link_count'] == 0, "修复后不应再有丢弃"
        assert info['dropped_links'] == []

    def test_dropped_links_has_required_fields(self):
        """每条丢弃记录必须含 network_type / device / port / reason / count。"""
        from topology import AccessAggTopology
        d = _design('超大-2048')
        topo = AccessAggTopology(
            access_down_ports=48, access_up_ports=8, agg_down_ports=32,
            downlink_speed='25G', uplink_speed='100G',
            cable_server_access='光纤', cable_access_agg='光纤',
            network_name='业务', redundancy=True, downlink_limit=25)
        # 6 接入台 × 8 上联 = 48 条需求 > 1 台汇聚 32 口 ⇒ 必然产生 16 条丢弃
        topo.create_and_connect(d.servers, 6, 1)
        assert len(topo.dropped_links) == 1, (
            f'应合并为 1 条记录（同设备/同端口/同原因聚合），实得 {topo.dropped_links}')
        assert topo.dropped_links[0]['reason'] == '汇聚端口已满'
        assert topo.dropped_links[0]['count'] == 16, (
            f'48 需求 - 32 口 = 16 条丢弃，实得 {topo.dropped_links[0]["count"]}')
        for item in topo.dropped_links:
            assert set(item.keys()) == {'network_type', 'device', 'port', 'reason', 'count'}
            assert item['network_type'] in ('biz', 'oob')
            assert item['count'] >= 1
        assert topo.dropped_link_count > 0

    def test_no_drop_on_conserved_template(self):
        """T-530-20：守恒模板的 dropped_links 必须为空。"""
        for tpl in ('H100-64台-IB', '中型-512'):
            d = _design(tpl)
            assert d.biz_info['dropped_link_count'] == 0, f'{tpl} 不应有丢弃'
            assert d.biz_info['dropped_links'] == []


# ================================================================
#  L3 · 全量模板端口守恒（发现本缺陷的原始手法，必须固化）
# ================================================================

class TestRealTemplateConservation:
    """T-530-01~11 / T-530-14/15：修复前 11 套欠连必须全部补齐，其余 12 套零变化。"""

    @pytest.mark.parametrize('tpl,demand', _UNDERCONNECTED)
    def test_underconnected_templates_now_conserved(self, tpl, demand):
        """修复前实测欠连的 11 套：需求 == 实收，丢弃 == 0。"""
        d = _design(tpl)
        info = d.biz_info
        pc = info['port_conservation']
        assert pc['上联需求总数'] == demand, f'{tpl} 上联需求应恰为 {demand}'
        assert _agg_ports_used(d) == demand, (
            f'{tpl} 汇聚实收 {_agg_ports_used(d)} != 需求 {demand}（欠连未补齐）')
        assert info['dropped_link_count'] == 0, f'{tpl} 不应再有丢弃'
        assert pc['是否守恒'] is True

    def test_all_templates_conserved_and_valid(self):
        """全量扫描：任何有业务网的模板都必须守恒且 valid。"""
        checked = 0
        for tpl in _all_templates():
            d = _design(tpl)
            info = getattr(d, 'biz_info', None)
            if not info or 'num_access' not in info:
                continue          # 未启用业务网（如三合一融合网形态）
            checked += 1
            pc = info['port_conservation']
            assert pc['是否守恒'] is True, (
                f'{tpl}: 需求 {pc["上联需求总数"]} > 下行口 {pc["汇聚下行总口"]}')
            assert info['dropped_link_count'] == 0, f'{tpl} 仍有丢连'
            assert _validate(d)['valid'] is True, f'{tpl} 自检未通过'
        assert checked >= 20, f'应至少扫到 20 套有业务网的模板，实际 {checked}'

    def test_oob_layer_never_underconnected(self):
        """T-530-15（R3 钉子）：带外网走「盒式按需算台数」，任何模板都不得欠连。"""
        for tpl in _all_templates():
            d = _design(tpl)
            info = getattr(d, 'oob_info', None)
            if not info or 'num_access' not in info:
                continue
            pc = info['port_conservation']
            assert pc['是否守恒'] is True, f'{tpl} 带外网不守恒'
            assert info.get('dropped_link_count', 0) == 0, f'{tpl} 带外网有丢弃'

    def test_frames_derived_from_port_demand(self):
        """T-530-12 / T-530-13：框数必须等于 ceil(需求 / 单框口)，而非按服务器数查表。

        ⚠️ V5.3.1-531-b：上联口 8 → 6 后需求与框数同步下降（超大-2048：1504/47 → 1128/36）。
        """
        cases = [('超大-2048', 1128, 36), ('中型-512', 288, 9), ('大型-1024', 564, 18)]
        for tpl, demand, expect_frames in cases:
            d = _design(tpl)
            info = d.biz_info
            assert info['num_agg'] == expect_frames, (
                f'{tpl} 框数应为 ceil({demand}/32) = {expect_frames}，实际 {info["num_agg"]}')
            assert info['num_agg'] == math.ceil(demand / 32)


# ================================================================
#  L2 · 契约段与配置键（AL-G4 / G5 / G7）
# ================================================================

class TestPortConservationContract:
    """T-530-21~26 / T-530-32~37：契约段、默认值与可配项。"""

    def test_default_oversubscription_is_strict(self):
        """T-530-21：不配置时收敛比必须为 1.0（严格守恒，裁定 D2 默认 100%）。"""
        d = _design('中型-512')
        assert d.biz_agg_oversubscription == 1.0
        assert d.biz_info['port_conservation']['是否守恒'] is True

    def test_default_chassis_spec_is_32(self):
        """T-530-24：缺省框规格 32；非法值回退 32。"""
        d = _design('中型-512')
        assert d.biz_agg_chassis_spec == 32

    def test_contract_section_registered(self):
        """T-530-32 / T-530-34：段已注册，schema_version 保持 2（纯增量）。"""
        from exporter import (
            REPORT_DATA_SCHEMA_VERSION, _REPORT_KEY_MAP, _REPORT_SECTIONS,
            generate_report_data,
        )
        assert 'port_conservation' in _REPORT_SECTIONS
        assert REPORT_DATA_SCHEMA_VERSION == 2
        # 关键键已英文化（data 子树）
        for zh in ('上联需求总数', '汇聚下行总口', '是否守恒', '丢弃链路数', '收敛比'):
            assert zh in _REPORT_KEY_MAP, f'{zh} 未登记英文化映射'

    def test_report_data_exposes_section_in_both_subtrees(self):
        """T-530-33：data 与 legacy_data 必须含同段，且 data 侧键已英文化。"""
        from exporter import generate_report_data
        d = _design('中型-512')
        buf = io.StringIO()
        with redirect_stdout(buf):
            r = generate_report_data(d)
        assert 'port_conservation' in r
        assert 'port_conservation' in r['data']
        assert 'port_conservation' in r['legacy_data']
        biz = r['data']['port_conservation']['layers']['biz']
        assert 'uplink_demand_total' in biz and 'conserved' in biz

    def test_golden_network_counts_expose_biz_layer(self):
        """T-530-35：golden 的 network_connections.biz 必须覆盖接入→汇聚双向连接。

        去重键方向敏感（MEMORY 约定 6）：每条接入上联在 A/Z 两端各存一个连接对象，
        但 `_connections()` 只按 (a_device, z_device, a_port) 收集，故
        `network_connections['biz']` 不含汇聚侧的镜像条目 —— 用它反推守恒时
        必须按「接入侧上行条数」计，不能按总数。
        """
        import json
        golden_dir = Path(__file__).resolve().parents[1] / 'backend' / 'golden'
        gf = golden_dir / '超大-2048.json'
        if not gf.exists():
            pytest.skip('golden 未生成')
        data = json.loads(gf.read_text(encoding='utf-8'))
        counts = data.get('counts') or {}
        assert counts.get('biz_access', 0) == 188
        assert counts.get('biz_agg', 0) == 36, (
            '上联口 = 6 口径下，超大-2048 的汇聚框数应为 36'
            f'（按端口需求 ceil(1128/32) 推导），实际 {counts.get("biz_agg")}')
        assert data.get('valid') is True


# ================================================================
#  L3 · V021 校验规则（双向留痕）
# ================================================================

class TestV021Rule:
    """T-530-27~31：修复前报 ERROR、修复后放行、配置缺失报 WARNING。"""

    def _v21(self, cfg):
        engine = create_default_engine()
        buf = io.StringIO()
        with redirect_stdout(buf):
            issues = engine.validate(ValidationContext(config=cfg))
        return [i for i in issues if i.rule_id == 'V021']

    def test_rule_registered(self):
        """T-530-29：V021 已注册，且不与既有冲突。"""
        engine = create_default_engine()
        ids = [r[0] for r in engine._rules]
        assert 'V021' in ids
        assert len(ids) == len(set(ids)), '规则 ID 不得重复'
        assert len(ids) == 23, f'应为 21 条既有 + V021 + V023 = 23，实际 {len(ids)}'

    def test_before_fix_state_reports_error(self):
        """T-530-27：修复前状态（16 框 / 512 口 / 丢 992 条）必须报 ERROR。"""
        cfg = {'port_conservation': {'layers': {'biz': {
            '上联需求总数': 1504, '汇聚下行总口': 512,
            '收敛比': 1.0, '丢弃链路数': 992}}}}
        issues = self._v21(cfg)
        assert len(issues) == 2, f'应报「不守恒」与「有丢弃」两条，实际 {len(issues)}'
        assert all(i.severity == Severity.ERROR for i in issues)
        joined = ' '.join(i.message for i in issues)
        assert '1504' in joined and '992' in joined

    def test_after_fix_state_passes(self):
        """T-530-28：修复后状态（47 框 / 1504 口）必须无 ERROR。"""
        cfg = {'port_conservation': {'layers': {'biz': {
            '上联需求总数': 1504, '汇聚下行总口': 1504,
            '收敛比': 1.0, '丢弃链路数': 0}}}}
        assert self._v21(cfg) == []

    def test_missing_config_warns_not_silent(self):
        """T-530-30：配置缺失必须报 WARNING —— 绝不静默通过（同族「静默」教训）。"""
        issues = self._v21({})
        assert len(issues) == 1
        assert issues[0].severity == Severity.WARNING

    def test_oversubscription_threshold_overridable(self):
        """T-530-31：收敛比 2.0 时按比例放行（裁定 D2「阈值可覆盖」）。"""
        cfg = {'port_conservation': {'layers': {'biz': {
            '上联需求总数': 768, '汇聚下行总口': 512,
            '收敛比': 2.0, '丢弃链路数': 0}}}}
        assert self._v21(cfg) == [], '收敛比 2.0 下 768 <= 512×2 应放行'


class TestV021EndToEnd:
    """T-530-46~48（新增）：V021 必须**真的读到**生产者写下的数值。

    ⚠️ 本类存在的理由（真实踩过的坑）：
    此前 engine 读 `需求上联总数`、生产者写 `上联需求总数`（**字序颠倒**），
    二者都是合法字符串，`.get(..., 0)` 于是**恒读 0** ⇒
    校验静默放行、契约层 0/0 —— 而上述 TestV021Rule 全部用例**照样全绿**，
    因为它们手搓 cfg，绕过了「生产者→消费者」这一环。
    ⇒ 凡「键名跨模块耦合」处，必须有**端到端**用例（开发计划 §6-R7）。
    """

    @staticmethod
    def _v21(cfg):
        from validation import create_default_engine, ValidationContext, Severity
        engine = create_default_engine()
        buf = io.StringIO()
        with redirect_stdout(buf):
            issues = engine.validate(ValidationContext(config=cfg))
        return [i for i in issues if i.rule_id == 'V021']

    def test_layers_read_real_numbers_from_designer(self):
        """T-530-46：真实模板跑出的 layers 数值必须非 0，且与 info 逐字一致。"""
        from engine import _build_port_conservation
        d = _design('超大-2048')
        pc = _build_port_conservation(d)
        assert pc is not None
        biz = pc['layers']['biz']
        # 与生产者（topology.calculate）逐字对齐（上联口 = 6 口径）
        assert biz['上联需求总数'] == d.biz_info['port_conservation']['上联需求总数'] == 1128
        assert biz['汇聚下行总口'] == d.biz_info['port_conservation']['汇聚下行总口'] == 1152
        # OOB 层同验（正是此前被读成 0 的那一层）
        oob = pc['layers']['oob']
        assert oob['上联需求总数'] == d.oob_info['port_conservation']['上联需求总数'] > 0, (
            'OOB 层需求读成 0 ⇒ 键名又写错了（应为「上联需求总数」）')
        assert oob['余量百分比'] > 0 or oob['余量百分比'] == 0.0

    def test_contract_matches_producer_all_templates(self):
        """T-530-47：全量模板扫描 —— 契约层数值一律等于生产者数值（不得有 0 假值）。"""
        from engine import _build_port_conservation
        checked = 0
        for tpl in _all_templates():
            d = _design(tpl)
            pc = _build_port_conservation(d)
            if not pc:
                continue
            for key, attr in (('biz', 'biz_info'), ('oob', 'oob_info')):
                if key not in pc['layers']:
                    continue
                info = getattr(d, attr) or {}
                src = info.get('port_conservation') or {}
                got = pc['layers'][key]['上联需求总数']
                exp = int(src.get('上联需求总数', 0) or 0)
                assert got == exp, (
                    f'{tpl}/{key}: 契约 {got} != 生产者 {exp}（键名不符会恒读 0）')
                assert exp > 0, f'{tpl}/{key}: 生产者需求为 {exp}，不该是 0'
            checked += 1
        assert checked >= 20, f'至少应覆盖 20 套含端口层的模板，实际 {checked}'

    def test_v021_fires_on_unconserved_real_config(self):
        """T-530-48：把真实配置改成「不守恒」后，V021 必须报 ERROR（非静默）。"""
        from engine import _build_port_conservation
        d = _design('超大-2048')
        pc = _build_port_conservation(d)
        # 构造成修复前的样子：框数不足 → 512 口，需求 1128
        pc['layers']['biz']['汇聚下行总口'] = 512
        issues = self._v21({'port_conservation': pc})
        assert len(issues) == 1, f'应报「biz 网不守恒」一条，实际 {len(issues)}'
        assert issues[0].severity == Severity.ERROR
        joined = issues[0].message
        assert '1128' in joined and '512' in joined and '616' in joined, (
            f'报错信息须点明需求/容量/缺口三个数，实际：{joined}')

    def test_v021_reports_both_when_dropped_nonzero(self):
        """T-530-48b：不守恒 **且** 丢弃非零 时须报两条（缺口 + 丢弃各一条）。"""
        from engine import _build_port_conservation
        d = _design('超大-2048')
        pc = _build_port_conservation(d)
        pc['layers']['biz']['汇聚下行总口'] = 512
        pc['layers']['biz']['丢弃链路数'] = 616     # 模拟修复前（需求 1128 − 容量 512）
        issues = self._v21({'port_conservation': pc})
        assert len(issues) == 2, f'应报不守恒 + 有丢弃两条，实际 {len(issues)}'
        assert all(i.severity == Severity.ERROR for i in issues)


# ================================================================
#  L1 · 行为等价（S1 不得改变连接结果）
# ================================================================

class TestS1BehaviorEquivalence:
    """T-530-17：S1 只改可观测性；未欠连模板的连接数必须与基线一致。

    ⚠️ 本类**不能**断言 golden 全等 —— S2 有意改变了 11 套模板的拓扑（补齐欠连），
    故 golden 已同批重生成。此处只钉「**原本就守恒的模板不受 S2 影响**」这一不变量。
    """

    def test_conserved_templates_unaffected_by_s2(self):
        """原本正常的模板：三个网层的连接数不得因本次修复而变化。"""
        import json
        golden_dir = Path(__file__).resolve().parents[1] / 'backend' / 'golden'
        if not golden_dir.is_dir():
            pytest.skip('golden 目录不存在')
        # 抽样：原本就守恒、且不在 11 套修复名单中的模板
        for tpl in ('H100-64台-IB', 'L20-推理-64', 'NVL72-单架'):
            gf = golden_dir / f'{tpl}.json'
            if not gf.exists():
                continue
            expected = json.loads(gf.read_text(encoding='utf-8'))
            d = _design(tpl)
            info = d.biz_info
            exp_counts = expected.get('counts') or {}
            assert len(d.biz_access) == exp_counts.get('biz_access'), f'{tpl} 业务接入台数变化'
            assert info['num_agg'] == exp_counts.get('biz_agg'), f'{tpl} 业务汇聚台数变化'
            assert info['port_conservation']['是否守恒'] is True, f'{tpl} 应守恒'
            assert info['dropped_link_count'] == 0, f'{tpl} 不应有丢弃'
