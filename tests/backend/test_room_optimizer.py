"""V3.1.4-T8-1: 机房智能落位优化器测试（room_optimizer.py）

覆盖：输入解析（counts/cabinets/中文键）/ 约束满足（占位/类型域/功率上限/位置不足）/
算法（225 柜 ≤5s、全部放置、保留手动）/ 目标评分 / action 注册（room:optimize）。
"""
import time

import pytest

from cli import execute
from room import (
    RoomMatrix, RoomConstraints, ROOM_TYPE_GPU, ROOM_TYPE_NETWORK,
    ROOM_TYPE_STORAGE, ROOM_TYPE_COMBINED, PLACEHOLDER_AC, PLACEHOLDER_PILLAR,
)
from room_optimizer import (
    optimize, parse_items, parse_objectives, parse_matrix, DEFAULT_OBJECTIVES,
    HIGH_POWER_THRESHOLD_W,
)


def make_matrix(rows=('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
                      'K', 'L', 'M', 'N', 'O'), cols=None) -> RoomMatrix:
    cols = cols or list(range(1, 16))
    return RoomMatrix(rows=list(rows), cols=cols, name='机房A')


class TestParseItems:
    def test_counts_mode(self):
        items, issues = parse_items({'counts': {'gpu': 120, 'network': 60, 'storage': 45}})
        assert not issues
        assert len(items) == 225
        from collections import Counter
        cnt = Counter(i.type for i in items)
        assert cnt[ROOM_TYPE_GPU] == 120
        assert cnt[ROOM_TYPE_NETWORK] == 60
        assert cnt[ROOM_TYPE_STORAGE] == 45

    def test_counts_chinese_keys(self):
        items, _ = parse_items({'counts': {'GPU': 2, '网络': 3, '存储': 4}})
        from collections import Counter
        cnt = Counter(i.type for i in items)
        assert cnt[ROOM_TYPE_GPU] == 2
        assert cnt[ROOM_TYPE_NETWORK] == 3
        assert cnt[ROOM_TYPE_STORAGE] == 4

    def test_cabinets_mode_prefers(self):
        items, _ = parse_items({
            'counts': {'gpu': 10},
            'cabinets': [{'id': 1, 'type': 'gpu', 'power_watts': 30000},
                         {'id': 2, 'type': 'storage', 'power_watts': 5000}],
        })
        assert len(items) == 2
        assert items[0].cabinet_id == 1
        assert items[1].type == ROOM_TYPE_STORAGE

    def test_missing_input(self):
        items, issues = parse_items({})
        assert not items
        assert any('counts' in i for i in issues)

    def test_negative_count(self):
        items, issues = parse_items({'counts': {'gpu': -3}})
        assert not items
        assert any('为负' in i for i in issues)


class TestParseObjectives:
    def test_defaults(self):
        assert parse_objectives({}) == DEFAULT_OBJECTIVES

    def test_override_and_invalid(self):
        obj = parse_objectives({'objectives': {'power_balance': 2.5, 'bogus': 9}})
        assert obj['power_balance'] == 2.5
        assert 'bogus' not in obj
        assert obj['network_locality'] == 1.0

    def test_invalid_value_fallback(self):
        obj = parse_objectives({'objectives': {'thermal_zones': 'abc'}})
        assert obj['thermal_zones'] == 1.0


class TestParseMatrix:
    def test_from_dict(self):
        m = make_matrix()
        matrix, issues = parse_matrix({'matrix': m.to_dict()})
        assert matrix is not None and not issues

    def test_missing(self):
        matrix, issues = parse_matrix({})
        assert matrix is None
        assert any('矩阵' in i for i in issues)


class TestConstraints:
    def test_placeholder_skipped(self):
        m = make_matrix()
        m.set_placeholder('A1', PLACEHOLDER_AC)
        m.set_placeholder('B3', PLACEHOLDER_PILLAR)
        res = optimize({'matrix': m.to_dict(), 'counts': {'gpu': 100}, 'time_budget_s': 1})
        assert res['success'] is True
        positions = {p['position'] for p in res['placements']}
        assert 'A1' not in positions and 'B3' not in positions

    def test_type_domain_respected(self):
        m = make_matrix()
        # 只标记 GPU 类型格子
        for pos in m.cells:
            m.set_type(pos, ROOM_TYPE_GPU)
        res = optimize({'matrix': m.to_dict(), 'counts': {'storage': 10}})
        assert res['success'] is True
        assert res['stats']['placed'] == 0  # 无 storage 可用格
        assert any('未放置' in i for i in res['issues'])

    def test_combined_accepts_any(self):
        m = make_matrix()
        for pos in m.cells:
            m.set_type(pos, ROOM_TYPE_COMBINED)
        res = optimize({'matrix': m.to_dict(), 'counts': {'storage': 10, 'gpu': 5}})
        assert res['stats']['placed'] == 15

    def test_power_limit_rejects_over(self):
        m = make_matrix()
        res = optimize({'matrix': m.to_dict(),
                        'cabinets': [{'id': 1, 'type': 'gpu', 'power_watts': 999999}]})
        assert res['success'] is True
        assert res['stats']['placed'] == 0
        assert any('功率' in i for i in res['issues'])

    def test_insufficient_slots(self):
        m = make_matrix(rows=('A', 'B'), cols=[1, 2])  # 4 格
        res = optimize({'matrix': m.to_dict(), 'counts': {'gpu': 10}})
        assert res['success'] is True
        assert res['stats']['placed'] == 4
        assert res['stats']['unplaced'] == 6
        assert any('可用位置不足' in i for i in res['issues'])


class TestPlacement:
    def test_counts_full_placement_225(self):
        m = make_matrix()
        start = time.monotonic()
        res = optimize({'matrix': m.to_dict(),
                        'counts': {'gpu': 120, 'network': 60, 'storage': 45},
                        'time_budget_s': 5})
        elapsed = time.monotonic() - start
        assert res['success'] is True
        assert res['stats']['placed'] == 225
        assert res['stats']['unplaced'] == 0
        # 性能：225 柜 ≤5s
        assert elapsed < 5.0, f"elapsed={elapsed:.2f}s"

    def test_cabinets_placement(self):
        m = make_matrix(rows=('A', 'B', 'C', 'D', 'E'), cols=list(range(1, 11)))
        cabinets = [
            {'id': i, 'type': 'gpu', 'power_watts': 6000 if i % 2 else 3000}
            for i in range(1, 26)
        ]
        res = optimize({'matrix': m.to_dict(), 'cabinets': cabinets})
        assert res['stats']['placed'] == 25
        ids = [p['cabinetId'] for p in res['placements']]
        assert sorted(ids) == list(range(1, 26))

    def test_keep_manual_placement_by_default(self):
        m = make_matrix(rows=('A', 'B', 'C'), cols=[1, 2, 3])
        m.place_cabinet('B2', 1)  # 手动放置
        res = optimize({'matrix': m.to_dict(), 'counts': {'gpu': 8}})
        assert res['success'] is True
        # 保留手动：B2 不被占用，放置 8 个在其余 8 格
        assert res['stats']['placed'] == 8
        assert all(p['position'] != 'B2' for p in res['placements'])

    def test_reset_existing_clears(self):
        m = make_matrix(rows=('A', 'B', 'C'), cols=[1, 2, 3])
        m.place_cabinet('B2', 1)
        res = optimize({'matrix': m.to_dict(), 'counts': {'gpu': 9}, 'reset_existing': True})
        assert res['stats']['placed'] == 9  # 清空后 9 格全用

    def test_scores_shape_and_range(self):
        m = make_matrix()
        res = optimize({'matrix': m.to_dict(),
                        'counts': {'gpu': 120, 'network': 60, 'storage': 45},
                        'time_budget_s': 2})
        scores = res['scores']
        assert set(DEFAULT_OBJECTIVES) <= set(scores)
        assert 'total' in scores
        for k, v in scores.items():
            assert 0.0 <= v <= 1.0, f"{k}={v}"
        assert scores['total'] > 0

    def test_network_locality_meaningful(self):
        """网络柜存在时 network_locality 为有效评分（非中性 1.0 也允许，但结构完整）"""
        m = make_matrix()
        res = optimize({'matrix': m.to_dict(), 'counts': {'network': 60}})
        assert 'network_locality' in res['scores']


class TestAction:
    def test_room_optimize_registered(self):
        m = make_matrix(rows=('A', 'B', 'C', 'D', 'E'), cols=list(range(1, 11)))
        res = execute('room:optimize', {
            'matrix': m.to_dict(),
            'counts': {'gpu': 30, 'network': 20},
            'time_budget_s': 2,
        })
        assert res['success'] is True
        assert res['stats']['placed'] == 50
        assert res['stats']['elapsed_ms'] is not None
