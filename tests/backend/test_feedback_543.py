# -*- coding: utf-8 -*-
"""V5.4.3-W1: 用户反馈修复单（2026-09-22）R1~R5 专项测试

对应《AutoLink修复单-20260922.md》与《AL_5.4.3版本PRD_v1.0》：
  R1（P0）Leaf↔Spine 静默断链 —— ports_per_spine=0 必须 error（D3），不得静默生成
          零连接拓扑；validate_topology() 增加互联段零连接判据；存储网同构处同修。
  R2（P0）param_spine_downlink_limit=72 有毒配置值 —— 注解去「Q3400 配 72」；
          显式配置生效时联动校验 spine_count ≤ uplink_avail（V023 扩展）。
  R3（P0）双校验路径 —— validate_templates 消费 V 规则集（门禁脚本侧，另有覆盖）；
          validate_topology 零连接判据使 design 自检不再误判「通过」。
  R4（P0）设备库 port_count 单位混算 —— calc_spine_count 同单位断言；等效口口径
          （param_equivalent_mode）下 param_dl 不受 switch_ports//2 钳制；
          Q3400 设备库带 effective_port_unit 字段。
  R5（更正）旧口径文案清理 —— topology.py/validation.py/config_schema.py 不再含
          「Spine=Leaf」「144 口 Q3400」「Q3400 配 72」等 09-20 旧口径表述。

决策基线（2026-09-22 向导问卷）：D1=B300/800G → Leaf144/Spine72（等效口口径）；
D2=双口径并存；D3=断链 error 不产文件。
"""
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(_BACKEND))

from designer import NetworkDesignerV2      # noqa: E402
from topology import calc_spine_count       # noqa: E402
from validation import (                    # noqa: E402
    ValidationContext, create_default_engine,
)

_TPL_DIR = Path(__file__).resolve().parents[2] / 'template'
_BASE_TPL = 'H100-128台'


# ----------------------------------------------------------------------
# 助手
# ----------------------------------------------------------------------
def _base_cfg(tpl=_BASE_TPL):
    return json.loads((_TPL_DIR / tpl / 'project_config.json').read_text(encoding='utf-8'))


def _design(cfg, tmp_path, name='project_config.json', expect_error=False):
    """静默设计。expect_error=True 时断言抛 ValueError（R1/D3 断链 error）。"""
    p = Path(tmp_path) / name
    p.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    buf = io.StringIO()
    with redirect_stdout(buf):
        if expect_error:
            with pytest.raises(ValueError, match='断链'):
                NetworkDesignerV2(str(p))
            return None
        return NetworkDesignerV2(str(p))


def _ls_conn_count(leaves, spines):
    """Leaf↔Spine 互联段连接数（双向去重计数，与 validate_topology 同口径）"""
    spine_names = {s.name for s in spines}
    return sum(1 for lf in leaves for c in lf.connections
               if (c.a_device == lf.name and c.z_device in spine_names)
               or (c.z_device == lf.name and c.a_device in spine_names))


# ----------------------------------------------------------------------
# R4：calc_spine_count 单位断言（修复单 R4 期望修复 #2）
# ----------------------------------------------------------------------
class TestCalcSpineCountUnitAssertion:
    """calc_spine_count：两个口数参数不同物理单位时拒绝（防 662 台跑飞值）"""

    def test_mixed_units_rejected(self):
        """800G 口径上行 ÷ 1.6T 口径下联 → ValueError（修复单实测 662 台场景）"""
        with pytest.raises(ValueError, match='单位混算'):
            calc_spine_count(400, 119, 72,
                             leaf_uplink_unit='800G-equiv',
                             spine_downlink_unit='1.6T-physical')

    def test_same_units_ok(self):
        """同单位正常反推：144 Leaf × 36 物理 1.6T 上行 ÷ 72 物理 1.6T 下联 = 72"""
        assert calc_spine_count(144, 36, 72,
                                leaf_uplink_unit='1.6T-physical',
                                spine_downlink_unit='1.6T-physical') == 72

    def test_units_optional_backward_compatible(self):
        """不带单位参数时行为与 5.4.2 完全一致（零回归）"""
        assert calc_spine_count(72, 72, 72) == 72
        assert calc_spine_count(64, 32, 64) == 32
        assert calc_spine_count(72) == 36


# ----------------------------------------------------------------------
# R1：断链 error（参数网 / 存储网）+ validate_topology 零连接判据
# ----------------------------------------------------------------------
class TestR1BrokenLinkError:
    """R1/D3：ports_per_spine=0 必须 error，不产出拓扑文件"""

    def test_param_broken_scale_striped_connected(self, tmp_path):
        """R1+W1.1：均匀分配不可行（spine > uplink_avail）但总上行充足 → 条带化连通，
        不静默断链也不误报（toxic 小 limit 把 Spine 推到 864 台，仍全连通）"""
        cfg = _base_cfg()
        cfg['topology'].update({
            'param_switch_ports': 144,
            'param_downlink_limit': 72,        # 上行可用 72
            # R2 实测路径：显式 limit 反推 Spine 台数跑飞（calc_spine_count=864）
            # ⇒ 均匀分配 ports_per_spine=0 ⇒ 条带化子集指派（连通），不得静默断链
            'param_spine_downlink_limit': 2,
        })
        d = _design(cfg, tmp_path)
        n = _ls_conn_count(d.param_leaves, d.param_spines)
        assert n == d.param_leaf_count * (144 - 72), '条带化后每 Leaf 应有 uplink_avail 条上行'
        # 每台 Spine 至少 1 条下联（无零下联 Spine）
        hosted = {}
        for lf in d.param_leaves:
            for c in lf.connections:
                if c.a_device == lf.name and c.z_device in {s.name for s in d.param_spines}:
                    hosted[c.z_device] = hosted.get(c.z_device, 0) + 1
        assert len(hosted) == len(d.param_spines)
        assert all(v >= 1 for v in hosted.values())

    def test_storage_broken_link_raises(self, tmp_path):
        """存储网同构处（修复单 R1「勿漏」第二处）：storage 断链 → ValueError"""
        cfg = _base_cfg()
        cfg['topology'].update({
            'storage_switch_ports': 64,
            'storage_downlink_limit': 40,     # 上行可用 24
        })
        # 存储 spine 台数由层级推导；构造 leaf 巨多 / spine 更多的场景：
        # 大规模服务器 + 小下行口 ⇒ leaf 膨胀 ⇒ spine=leaf//2 超过上行可用口
        cfg['topology'].update({'num_gpu_servers': 4096})
        try:
            d = _design(cfg, tmp_path)
        except ValueError as e:
            assert '存储网' in str(e) or '参数网' in str(e)
            return
        # 若未抛错，则该规模下 spine ≤ uplink_avail，属合法拓扑——校验零连接判据兜底
        v = d.validate_topology()
        assert v['valid'], f"出现非法静默拓扑: {v['errors']}"

    def test_validate_topology_zero_link_flagged(self, tmp_path):
        """零连接判据：人为构造 Leaf↔Spine 0 条的 designer → validate_topology 失败"""
        cfg = _base_cfg()
        d = _design(cfg, tmp_path)
        assert d.param_leaves and d.param_spines
        # 清空参数网 Leaf↔Spine 连接，模拟 R1 断链产物
        spine_names = {s.name for s in d.param_spines}
        for lf in d.param_leaves:
            lf.connections = [c for c in lf.connections
                              if not (c.z_device in spine_names or c.a_device in spine_names)]
        for sp in d.param_spines:
            sp.connections = [c for c in sp.connections
                              if not (c.z_device in {lf.name for lf in d.param_leaves}
                                      or c.a_device in {lf.name for lf in d.param_leaves})]
        buf = io.StringIO()
        with redirect_stdout(buf):
            v = d.validate_topology()
        assert not v['valid']
        assert any('Leaf↔Spine 连接数为 0' in e for e in v['errors'])


# ----------------------------------------------------------------------
# R2：有毒配置值治理 + V023 联动校验
# ----------------------------------------------------------------------
class TestR2ToxicConfigValue:
    """R2：注解去推荐值；显式 limit 生效时联动校验 spine_count ≤ uplink_avail"""

    def test_schema_annotation_no_toxic_recommendation(self):
        """config_schema 的 param_spine_downlink_limit 注解（运行时读取）不得再推荐「Q3400 配 72」

        注意：源码注释中允许出现旧值引注（说明为何更正）；本断言钉的是**生效注解**。
        """
        sys.path.insert(0, str(_BACKEND))
        import config_schema as cs
        fld = next(f for f in cs.PROJECT_FIELDS if f['key'] == 'param_spine_downlink_limit')
        assert 'Q3400 配 72' not in fld['description']
        assert '留空' in fld['description']

    def test_explicit_limit_no_silent_zero_link(self, tmp_path):
        """R2 终验：有毒配置值（显式 limit 反推 Spine 跑飞）不得产出零链路拓扑——
        条带化接线后必须连通（R2 联动校验语义由连通性保证取代，见开发计划变更说明）"""
        engine = create_default_engine()
        cfg = _base_cfg()
        cfg['topology'].update({
            'param_switch_ports': 144,
            'param_downlink_limit': 72,
            'param_spine_downlink_limit': 2,
        })
        d = _design(cfg, tmp_path)
        assert _ls_conn_count(d.param_leaves, d.param_spines) > 0
        # V023 承载口径回归：等效场景在引擎层不再因 leaf 台数本身误报
        ctx = ValidationContext(config={
            'param_leaf_count': 400, 'param_spine_count': 200,
            'param_core_count': 0, 'param_switch_ports': 144,
        })
        issues = [i for i in engine.validate(ctx) if i.rule_id == 'V023'
                  and i.severity.value == 'error']
        assert issues == []

    def test_default_limit_no_false_positive(self):
        """缺省（自动 Leaf/2）路径不触发联动校验（零回归）"""
        engine = create_default_engine()
        ctx = ValidationContext(config={
            'param_leaf_count': 64, 'param_spine_count': 32,
            'param_core_count': 0, 'param_switch_ports': 128,
        })
        issues = [i for i in engine.validate(ctx) if i.rule_id == 'V023'
                  and i.severity.value == 'error']
        assert issues == []


# ----------------------------------------------------------------------
# R4/D1+D2：等效口口径（param_equivalent_mode）
# ----------------------------------------------------------------------
class TestEquivalentMode:
    """等效口口径：clamp 放宽 + Leaf/Spine 推导 + 拓扑连通"""

    def _equiv_cfg(self):
        cfg = _base_cfg('万卡-B300-Q3400-二层-IB')
        return cfg

    def test_official_template_leaf144_spine72(self, tmp_path):
        """D1 终版：官方模板重建后 Leaf 144 / Spine 72（B300/800G，2:1 收敛）"""
        d = _design(self._equiv_cfg(), tmp_path)
        assert d.param_leaf_count == 144, f"Leaf {d.param_leaf_count} != 144"
        assert d.param_spine_count == 72, f"Spine {d.param_spine_count} != 72"

    def test_official_template_connected(self, tmp_path):
        """R1 反向断言：重建后参数网 Leaf↔Spine 必须连通（>0 条）"""
        d = _design(self._equiv_cfg(), tmp_path)
        n = _ls_conn_count(d.param_leaves, d.param_spines)
        assert n > 0, '等效口口径模板 Leaf↔Spine 仍为 0 条'
        # 每台 Spine 下联 = Leaf×uplink/Spine = 144×36/72 = 72（物理口全用满）
        assert n == 144 * 36

    def test_clamp_bypassed_in_equiv_mode(self, tmp_path):
        """等效口口径下 param_dl 不受 switch_ports//2 钳制（R4 修复核心）"""
        d = _design(self._equiv_cfg(), tmp_path)
        assert d.param_equivalent_mode is True
        assert d.param_dl == 72, f"param_dl={d.param_dl}，应取配置值 72（> 144//2 钳制不存在）"

    def test_v023_equiv_capacity_limit(self):
        """V023 等效口上限 = Spine×物理下联/物理上联（72×72/36=144），Leaf=144 恰好通过"""
        engine = create_default_engine()
        ctx = ValidationContext(config={
            'param_leaf_count': 144, 'param_spine_count': 72,
            'param_core_count': 0, 'param_switch_ports': 144,
            'param_equivalent_mode': True, 'param_uplink_physical_ports': 36,
        })
        issues = [i for i in engine.validate(ctx) if i.rule_id == 'V023'
                  and i.severity.value == 'error']
        assert issues == []
        # Leaf 145 超限 → ERROR
        ctx2 = ValidationContext(config={
            'param_leaf_count': 145, 'param_spine_count': 72,
            'param_core_count': 0, 'param_switch_ports': 144,
            'param_equivalent_mode': True, 'param_uplink_physical_ports': 36,
        })
        issues2 = [i for i in engine.validate(ctx2) if i.rule_id == 'V023'
                   and i.severity.value == 'error']
        assert issues2, '等效口口径下 Leaf 超上限未触发 V023'

    def test_device_library_effective_port_unit(self):
        """R4 期望修复 #1：Q3400 设备库带 effective_port_unit 单位字段"""
        dev = json.loads((_TPL_DIR / 'device_library' / 'switches' / 'param'
                          / 'nvidia_q3400_144_800g_ib.json').read_text(encoding='utf-8'))
        assert dev.get('effective_port_unit') == '800G-equivalent'
        assert dev.get('physical_ports') == 72
        assert dev.get('logical_port_count') == 144


# ----------------------------------------------------------------------
# R5：旧口径文案清理（4 处）——钉**生效文案**（运行时产出），非源码历史引注
# ----------------------------------------------------------------------
class TestR5StaleCaliberText:
    """R5：生效层的旧口径表述已清理（V023 消息/建议、calc_spine_count 口径）"""

    def test_v023_recommendation_no_stale_text(self):
        """V023 的 recommendation 不得再推荐「144 口 Q3400」（Q3400 实为 72×1.6T）"""
        engine = create_default_engine()
        ctx = ValidationContext(config={
            'param_leaf_count': 1200, 'param_spine_count': 200,
            'param_core_count': 0, 'param_switch_ports': 144,
        })
        issues = [i for i in engine.validate(ctx) if i.rule_id == 'V023']
        assert issues, '预期 V023 触发'
        for i in issues:
            assert '144 口 Q3400' not in i.recommendation
            assert '取决于 Leaf 计数口径' in i.message

    def test_calc_spine_count_corrected_example(self):
        """更正后的口径示例：Leaf 72 × 物理 1.6T 上行 36 ÷ 物理下联 72 = 36 台（方案 02）"""
        assert calc_spine_count(72, 36, 72,
                                leaf_uplink_unit='physical',
                                spine_downlink_unit='physical') == 36

    def test_designer_topo_docstring_positive_marker(self):
        """topology.calc_spine_count docstring 含更正声明（同物理单位）"""
        doc = __import__('topology').calc_spine_count.__doc__ or ''
        assert '同一物理单位' in doc
