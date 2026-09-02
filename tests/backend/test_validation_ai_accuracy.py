"""4.5 D-4 AI 规划器准确性校验测试（F5-4：建议声称值 vs 后端真实计算）"""
from types import SimpleNamespace

import pytest

from validation_engine import (
    check_suggestion_accuracy, check_optimization_suggestions,
    check_ai_plan_claims, designer_convergence,
)


class StubDesigner:
    """与 NetworkDesignerV2 属性对齐的最小桩（确定性，不依赖模板）"""
    param_dl = 32
    param_switch_ports = 64
    param_leaf_count = 8
    param_speed = '400G'
    storage_dl = 16
    storage_switch_ports = 48
    storage_leaf_count = 4
    storage_speed = '200G'


DESIGNER = StubDesigner()

CONFIG = {
    'topology': {
        'param_downlink_limit': 32,
        'param_switch_ports': 64,
        'storage_downlink_limit': 16,
        'storage_switch_ports': 48,
    },
    'rack_config': {'cooling_method': 'air'},
}


def _sug(category='convergence', title='参数网收敛比优化', description='', patch=None,
         impact=''):
    return {'category': category, 'categoryLabel': '收敛比', 'title': title,
            'description': description, 'patch': patch or {'topology': {'param_downlink_limit': 16}},
            'impact': impact}


class TestDesignerConvergence:
    def test_param_ratio_matches_stub(self):
        r = designer_convergence(DESIGNER, 'param')
        assert r['downlink'] == 32
        assert r['uplink'] == 32
        assert abs(r['convergence_ratio'] - 1.0) < 1e-9

    def test_storage_ratio(self):
        r = designer_convergence(DESIGNER, 'storage')
        assert abs(r['convergence_ratio'] - (16 / 32)) < 1e-9

    def test_unknown_net_returns_none(self):
        assert designer_convergence(DESIGNER, 'biz') is None


class TestSuggestionAccuracy:
    """A001 当前收敛比声称 / A002 应用后声称 / A003 patch 可落地"""

    def test_accurate_current_claim_passes(self):
        sug = _sug(description='参数网收敛比 1.0:1 超过目标 1:1，建议降低 Leaf 下联端口数')
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        assert issues == []

    def test_drifted_current_claim_a001(self):
        sug = _sug(description='参数网收敛比 2.0:1 超过目标 1:1，建议降低 Leaf 下联端口数')
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        a001 = [i for i in issues if i.rule_id == 'A001']
        assert len(a001) == 1
        assert a001[0].severity == 'error'

    def test_accurate_impact_claim_passes(self):
        # patch: param_downlink_limit=16 → 新收敛比 = 16/(64-16) ≈ 0.3:1
        sug = _sug(description='参数网收敛比 1.0:1 超过目标 1:1',
                   patch={'topology': {'param_downlink_limit': 16}},
                   impact='参数网收敛比降至约 0.3:1，缓解上行拥塞')
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        assert issues == []

    def test_drifted_impact_claim_a002(self):
        sug = _sug(description='参数网收敛比 1.0:1 超过目标 1:1',
                   patch={'topology': {'param_downlink_limit': 16}},
                   impact='参数网收敛比降至约 2.0:1，缓解上行拥塞')
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        a002 = [i for i in issues if i.rule_id == 'A002']
        assert len(a002) == 1
        assert a002[0].severity == 'warning'

    def test_storage_patch_targeted(self):
        sug = _sug(description='存储网收敛比 0.5:1 超过目标 2:1',
                   patch={'topology': {'storage_downlink_limit': 8}},
                   impact='存储网收敛比降至约 0.2:1')
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        assert issues == []

    def test_patch_missing_section_a003(self):
        sug = _sug(description='参数网收敛比 1.0:1',
                   patch={'bad_section': {'x': 1}})
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        a003 = [i for i in issues if i.rule_id == 'A003']
        assert len(a003) == 1
        assert a003[0].severity == 'error'

    def test_patch_missing_key_a003(self):
        sug = _sug(description='参数网收敛比 1.0:1',
                   patch={'topology': {'param_bogus_key': 1}})
        issues = check_suggestion_accuracy(sug, DESIGNER, CONFIG)
        a003 = [i for i in issues if i.rule_id == 'A003']
        assert len(a003) == 1

    def test_without_designer_only_patch_checked(self):
        sug = _sug(description='参数网收敛比 1.0:1', patch={'topology': {'param_downlink_limit': 16}})
        issues = check_suggestion_accuracy(sug, None, CONFIG)
        assert issues == []


class TestCheckAiPlanClaims:
    """A010 通用声称校验"""

    def test_matching_claims_pass(self):
        issues = check_ai_plan_claims({'param': 1.0, 'storage': 2.0},
                                      {'param': 1.0, 'storage': 2.0})
        assert issues == []

    def test_drifted_claim_a010(self):
        issues = check_ai_plan_claims({'param': 1.0, 'storage': 3.5},
                                      {'param': 1.0, 'storage': 2.0})
        a010 = [i for i in issues if i.rule_id == 'A010']
        assert len(a010) == 1
        assert 'storage' in a010[0].location
        assert a010[0].severity == 'error'

    def test_invalid_claim(self):
        issues = check_ai_plan_claims({'param': 'abc'}, {'param': 1.0})
        assert any(i.rule_id == 'A010' for i in issues)

    def test_none_safe(self):
        assert check_ai_plan_claims(None, {'param': 1.0}) == []


class TestCheckOptimizationSuggestions:
    """批量建议校验"""

    def test_batch_accurate(self):
        s = [_sug(description='参数网收敛比 1.0:1 超过目标 1:1',
                  patch={'topology': {'param_downlink_limit': 16}},
                  impact='参数网收敛比降至约 0.3:1')]
        assert check_optimization_suggestions(s, DESIGNER, CONFIG) == []

    def test_batch_flags_drift(self):
        s = [_sug(description='参数网收敛比 2.0:1 超过目标 1:1'),
             _sug(description='参数网收敛比 1.0:1', patch={'bad': {'x': 1}})]
        issues = check_optimization_suggestions(s, DESIGNER, CONFIG)
        ids = {i.rule_id for i in issues}
        assert 'A001' in ids
        assert 'A003' in ids
