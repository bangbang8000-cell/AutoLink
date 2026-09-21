# -*- coding: utf-8 -*-
"""V5.4.2-542: Q3400 二层口径核查 —— V023 / calc_spine_count 专项测试

覆盖（对应《AutoLink改进建议-Q3400二层口径核查-20260920.md》Q2/Q3）：
  - calc_spine_count：经典 1:1 Clos（k=64）→ k/2 兼容；Q3400（72×72/72）→ 72
  - V023：二层参数网 leaf 超 Spine 单台下联口上限 → ERROR
  - V023：三层（param_core_count>0）不误伤（1024 GPU leaf=256>32 仍无 V023）
  - V023：万卡-B300-Q3400 模板参数（leaf=400 > 72）必报 ERROR
  - V023：spine_downlink_limit 参数化（param_spine_downlink_limit 可覆盖）
"""
import pytest

from topology import calc_spine_count, calc_max_2tier
from validation import (
    ValidationContext, create_default_engine, Severity,
)


# ---------- calc_spine_count（Q3 统一公式） ----------

class TestCalcSpineCount542:
    """Q3：Spine 台数统一容量反推公式"""

    def test_classic_1to1_clos_no_regression(self):
        """经典 1:1 Clos（leaf=k、uplink=k/2、Spine 全口 k 下联）→ k/2，与旧 //2 一致"""
        assert calc_spine_count(64, 32, 64) == 32
        assert calc_spine_count(64) == 32
        assert calc_spine_count(128, 64, 128) == 64

    def test_q3400_72_spines(self):
        """Q3400 终版：72 Leaf × 72 上行 ÷ 72 下联 = 72 台 Spine（旧 //2=36 少算一半）"""
        assert calc_spine_count(72, 72, 72) == 72

    def test_capacity_ceil(self):
        """容量不足时向上取整：57 Leaf × 32 上行 ÷ 64 下联 = ceil(28.5) = 29"""
        assert calc_spine_count(57, 32, 64) == 29

    def test_zero_protection(self):
        """非法/缺省输入回退 max(1, leaf//2)，不抛错"""
        assert calc_spine_count(0) == 1
        assert calc_spine_count(3) == 1
        assert calc_spine_count(5, 0, 64) == 2


# ---------- V023（Q2 Leaf ≤ Spine 下联上限） ----------

def _ctx(leaf=0, spine=0, core=0, sw=64, limit=None):
    cfg = {
        'param_leaf_count': leaf,
        'param_spine_count': spine,
        'param_core_count': core,
        'param_switch_ports': sw,
    }
    if limit is not None:
        cfg['param_spine_downlink_limit'] = limit
    return ValidationContext(config=cfg)


class TestV023ParamLeafSpineCapacity:
    """V023：参数网 Leaf 台数 ≤ Spine 单台下联口上限（Q3400 二层口径）"""

    def test_q3400_leaf_over_72_errors(self):
        """万卡-B300-Q3400（leaf=400、spine=200、sw=144）必须报 ERROR（反馈 P0 核心）"""
        engine = create_default_engine()
        issues = [i for i in engine.validate(_ctx(leaf=400, spine=200, core=0, sw=144))
                  if i.rule_id == 'V023']
        assert len(issues) == 1
        assert issues[0].severity == Severity.ERROR
        assert '400' in issues[0].message
        assert '72' in issues[0].message

    def test_leaf_at_limit_passes(self):
        """恰在上限（leaf=72=144//2）不报"""
        engine = create_default_engine()
        issues = [i for i in engine.validate(_ctx(leaf=72, spine=72, core=0, sw=144))
                  if i.rule_id == 'V023']
        assert issues == []

    def test_three_tier_skipped(self):
        """三层（core>0）不适用全二部口径：1024 GPU leaf=256>32 不得误报（test_manage 依赖）"""
        engine = create_default_engine()
        issues = [i for i in engine.validate(_ctx(leaf=256, spine=256, core=128, sw=64))
                  if i.rule_id == 'V023']
        assert issues == []

    def test_limit_parametrizable(self):
        """上限参数化：param_spine_downlink_limit=100 时 leaf=90 合法、leaf=110 报错"""
        engine = create_default_engine()
        ok = [i for i in engine.validate(_ctx(leaf=90, spine=45, core=0, sw=144, limit=100))
              if i.rule_id == 'V023']
        assert ok == []
        bad = [i for i in engine.validate(_ctx(leaf=110, spine=55, core=0, sw=144, limit=100))
               if i.rule_id == 'V023']
        assert len(bad) == 1

    def test_missing_param_network_no_issue(self):
        """无参数网数据（leaf=0）不报（空输入保护）"""
        engine = create_default_engine()
        issues = [i for i in engine.validate(_ctx()) if i.rule_id == 'V023']
        assert issues == []
