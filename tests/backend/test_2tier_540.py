"""AutoLink v5.4.0（6 场景内容建设 · FR-A1）—— 二层容量判据校正专项

对应 PRD §3.1 / 开发计划 W1.1 / 测试计划 T-6S-A01~A06：

  判据：二层最大台数 = k²/(2p)，二层最大卡数 = k²/2（厂商口径，裁定 1）。
  旧实现 k²/(4p) 把 leaf 台数当成 k/2 ⇒ 「二层最大」场景被误判为三层（P-1）。

血训引用：
  - 行为变更纪律（PRD §8）：golden 同批重生成 + 逐条归因，不得「重生成即正确」；
  - L3 零副作用：既有模板中**预期翻转**的 5 套（见 A06 清单）判二层属修复行为，
    其余模板判定必须不变。
"""
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(_BACKEND))

from topology import calc_max_2tier, FatTreeTopology  # noqa: E402


def _is_3tier(k, p, n):
    """直接走 calculate_hierarchy（不依赖 designer 全流程）。"""
    topo = FatTreeTopology(ports_per_server=p, switch_ports=k,
                           network_speed='400G', cable_type_config={})
    is_3tier, *_ = topo.calculate_hierarchy(n)
    return is_3tier


class TestMax2tierFormula540A:
    """A01：六场景 max_2tier 逐套计算（与 PRD §3.1 表一致）。"""

    def test_expected_values(self):
        cases = [  # (场景, k, p, 期望台数)
            ('① QM9700 k=64', 64, 8, 256),
            ('② Q3400 k=288', 288, 8, 5184),
            ('③ X400 k=128', 128, 8, 1024),
            ('④ QM9700 同①', 64, 8, 256),
            ('⑤ X400 同③', 128, 8, 1024),
            ('⑥ Q3400-144 k=144', 144, 8, 1296),
        ]
        for name, k, p, expected in cases:
            assert calc_max_2tier(k, p) == expected, f'{name}: 期望 {expected}'


class TestBoundaryExactlyUpperLimit540A:
    """A02/A03/A04：恰在上限（==）必须判二层 —— 旧公式在边界处翻转的核心回归。"""

    def test_2048_cards_qm9700_two_tier(self):
        """④ 256 台（2048 卡）== QM9700 上限 256 ⇒ 二层。"""
        assert _is_3tier(64, 8, 256) is False

    def test_8192_cards_x400_two_tier(self):
        """⑤ 1024 台（8192 卡）== X400 上限 1024 ⇒ 二层。"""
        assert _is_3tier(128, 8, 1024) is False

    def test_10000_cards_q3400_144_two_tier(self):
        """⑥ 1250 台（10000 卡）≤ 1296 ⇒ 二层（旧公式 648 会误判三层）。"""
        assert _is_3tier(144, 8, 1250) is False

    def test_one_over_upper_limit_is_three_tier(self):
        """边界反例：上限 +1 台必须判三层（证明 == 判定不是恒二层）。"""
        assert _is_3tier(64, 8, 257) is True
        assert _is_3tier(128, 8, 1025) is True


class TestExistingTemplatesZeroUnintendedChange540A:
    """A05/A06：既有模板零副作用（L3）—— 仅预期翻转的 5 套变化，其余不变。

    实测（2026-09-20，公式校正后全仓扫描）：23 套模板中 5 套判定翻转，
    全部为厂商口径下的**预期修复**（非误伤）：
      - 4 套 n=256、k=64（== 新上限 256）：H100-256台-RoCE / SuperPOD-256 /
        国产-昇腾-256 / 液冷-H100-256 —— 旧公式把「恰在上限」误判三层；
      - 1 套 DP3Tier-1024（n=1024、k=144，新上限 1296）：旧公式 648 误判三层。
    PRD §3.1「既有模板无一落在被翻转区间」的注记不成立（最大 2048 台为真，
    但 n=256 恰落新上限）；§8 行为变更管理（golden 同批重生成 + 逐条归因）正确预判。
    """

    EXPECTED_FLIPPED = {
        'DP3Tier-1024', 'H100-256台-RoCE', 'SuperPOD-256',
        '国产-昇腾-256', '液冷-H100-256',
        # V5.4.0-640-m（W6.2）：6 场景新模板 3 套恰落/低于新上限 ⇒ 预期翻二层
        #（PRD §3.1 场景④⑤⑥「二层最大」：2048 卡 k=64 == 256、8192 卡 k=128 == 1024、
        #  B300 万卡 k=144，1250 台 ≤ 1296）
        '二层最大-2048卡-QM9700-IB', '二层最大-8192卡-X400-RoCE', '万卡-B300-Q3400-二层-IB',
    }
    _TPL = Path(__file__).resolve().parents[2] / 'template'

    def _scan_templates(self):
        import json
        out = {}
        for d in self._TPL.iterdir():
            pc = d / 'project_config.json'
            if not pc.exists():
                continue
            try:
                t = json.loads(pc.read_text(encoding='utf-8'))['topology']
            except Exception:
                continue
            n = t.get('num_gpu_servers', 0)
            k = t.get('param_switch_ports', 0)
            p = t.get('param_ports_per_server', 8)
            if not k or not n:
                continue
            out[d.name] = (n, k, p)
        return out

    def test_flipped_templates_become_two_tier(self):
        """预期翻转的 5 套必须判二层（修复行为）。"""
        scanned = self._scan_templates()
        missing = self.EXPECTED_FLIPPED - set(scanned)
        assert not missing, f'模板缺失: {missing}'
        for name in sorted(self.EXPECTED_FLIPPED):
            n, k, p = scanned[name]
            assert _is_3tier(k, p, n) is False, \
                f'{name}（n={n}, k={k}）应判二层（预期翻转）'

    def test_other_templates_unchanged(self):
        """其余模板判定必须与校正前一致（L3 零副作用）。

        校正前判定 = n > k²/(4p)（三层）；校正后不得出现额外翻转。
        此处校验：非预期清单中的模板，校正后仍按「n > k²/(4p)」的三层语义判定
        —— 即校正后判二层者必须 == 校正前判二层者（除预期翻转清单外）。
        """
        scanned = self._scan_templates()
        for name, (n, k, p) in scanned.items():
            old_3tier = n > (k ** 2) // (4 * p)
            new_3tier = _is_3tier(k, p, n)
            if name in self.EXPECTED_FLIPPED:
                assert new_3tier is False, f'{name} 应判二层'
            else:
                assert new_3tier == old_3tier, \
                    f'{name}: 非预期翻转（old={old_3tier}, new={new_3tier}）'

    def test_super_large_still_three_tier(self):
        """超大-2048（n=2048 > 256）必须仍判三层 —— 证明未把三层误压成二层。"""
        assert _is_3tier(64, 8, 2048) is True
