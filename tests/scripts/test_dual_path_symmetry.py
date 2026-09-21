# -*- coding: utf-8 -*-
"""V5.3.3-T7.0（AL-G14）· 双路径对称 AST 探针 单测

覆盖：正常双路径 / 单路径接线缺失（A）/ 散落赋值（B）/ 无默认值（C）/ 豁免 / 边界
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
from check_dual_path_symmetry import analyze  # noqa: E402

GOOD_SRC = '''\
class NetworkDesignerV2:
    """模拟：JSON 与 INI 双路径共用唯一初始化入口。"""

    def _init_biz_caliber_switches(self, get, has=None):
        self.biz_agg_oversubscription = float(get('biz_agg_oversubscription', 1.0))
        self.biz_group_granularity = str(get('biz_group_granularity', 'merge'))

    def _init_from_project_config(self, topo):
        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)

    def _load_common_ini_config(self):
        self._init_biz_caliber_switches(
            lambda k, d=None: self.config.get('DEFAULT', k, fallback=d))
'''


def test_ok_dual_path():
    res = analyze(GOOD_SRC)
    assert res['ok'], res['errors']
    assert res['report']['json_hit'] is True
    assert res['report']['ini_hit'] is True
    assert sorted(res['report']['caliber_keys']) == [
        'biz_agg_oversubscription', 'biz_group_granularity']


def test_ini_missing_call():
    """A：INI 路径不调用唯一入口 ⇒ 阻断（5.3.0 血训复刻）。"""
    src = GOOD_SRC.replace(
        "        self._init_biz_caliber_switches(\n"
        "            lambda k, d=None: self.config.get('DEFAULT', k, fallback=d))\n",
        '        pass\n')
    res = analyze(src)
    assert not res['ok']
    assert any(e.startswith('A.调用点覆盖') and 'INI' in e for e in res['errors'])


def test_json_missing_call():
    """A：JSON 路径不调用唯一入口 ⇒ 阻断。"""
    src = GOOD_SRC.replace(
        "        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)\n",
        '        pass\n')
    res = analyze(src)
    assert not res['ok']
    assert any(e.startswith('A.调用点覆盖') and 'JSON' in e for e in res['errors'])


def test_scattered_assign():
    """B：口径开关键在 entry 外（JSON 路径内）散落赋值 ⇒ 阻断（5.3.1 血训复刻）。"""
    src = GOOD_SRC.replace(
        "        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)",
        "        self.biz_group_granularity = 'merge'  # 散落赋值（模拟 5.3.1）\n"
        "        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)")
    res = analyze(src)
    assert not res['ok']
    assert any('B.散落赋值' in e and 'biz_group_granularity' in e for e in res['errors'])
    assert res['report']['scattered_assigns'][0]['methods'] == ['_init_from_project_config']
    assert res['report']['scattered_assigns'][0]['json_covered'] is True
    assert res['report']['scattered_assigns'][0]['ini_covered'] is False


def test_no_default():
    """C：entry 内 get 无默认值 ⇒ 阻断（配置缺失即 AttributeError 血训源）。"""
    src = GOOD_SRC.replace(
        "        self.biz_group_granularity = str(get('biz_group_granularity', 'merge'))",
        "        self.biz_group_granularity = str(get('biz_group_granularity'))")
    res = analyze(src)
    assert not res['ok']
    assert any('C.默认值' in e and 'biz_group_granularity' in e for e in res['errors'])


def test_allow_exempts():
    """豁免：人工判定安全的候选键放行。"""
    src = GOOD_SRC.replace(
        "        self.biz_group_granularity = str(get('biz_group_granularity'))",
        "        self.biz_group_granularity = str(get('biz_group_granularity'))")
    res = analyze(src, allow=('biz_group_granularity',))
    assert res['ok'], res['errors']


def test_entry_missing():
    """entry 方法不存在 ⇒ 阻断。"""
    src = GOOD_SRC.replace('def _init_biz_caliber_switches', 'def _renamed_entry')
    res = analyze(src)
    assert not res['ok']
    assert any('未找到唯一初始化入口' in e for e in res['errors'])


def test_parse_error():
    """非法源码 ⇒ 阻断（报告解析失败）。"""
    res = analyze('class X:\n  def broken(:\n')
    assert not res['ok']
    assert any('解析失败' in e for e in res['errors'])


def test_ini_any_one_of_paths_counts():
    """INI 两条方法命中其一即算覆盖（_load_common_config 兜底场景）。"""
    src = GOOD_SRC.replace(
        "    def _load_common_ini_config(self):\n"
        "        self._init_biz_caliber_switches(\n"
        "            lambda k, d=None: self.config.get('DEFAULT', k, fallback=d))",
        "    def _load_common_config(self):\n"
        "        self._init_biz_caliber_switches(\n"
        "            lambda k, d=None: self.config.get('DEFAULT', k, fallback=d))")
    res = analyze(src)
    assert res['ok'], res['errors']
    assert res['report']['ini_hit'] is True


HAS_SRC = '''\
class NetworkDesignerV2:
    def _init_biz_caliber_switches(self, get, has=None):
        self.biz_agg_oversubscription = float(get('biz_agg_oversubscription', 1.0))
        self._biz_frames_map_explicit = bool(has('biz_chassis_frames_map')) if has else False

    def _init_from_project_config(self, topo):
        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)

    def _load_common_ini_config(self):
        self._init_biz_caliber_switches(
            lambda k, d=None: self.config.get('DEFAULT', k, fallback=d))
'''


def test_has_key_is_detected_as_caliber_key():
    """has 键（_biz_frames_map_explicit 的判定源）也计入口径开关键。"""
    res = analyze(HAS_SRC)
    assert res['ok'], res['errors']
    assert 'biz_chassis_frames_map' in res['report']['has_keys']
    assert 'biz_chassis_frames_map' in res['report']['caliber_keys']


def test_has_key_scattered_assign():
    """B：has 判定源的属性在 entry 外散落赋值 ⇒ 阻断（5.3.1 漏第 4 项血训复刻）。"""
    src = HAS_SRC.replace(
        "        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)",
        "        self._biz_frames_map_explicit = True  # 散落赋值（模拟 5.3.1）\n"
        "        self._init_biz_caliber_switches(topo.get, lambda k: k in topo)")
    res = analyze(src)
    assert not res['ok']
    assert any('B.散落赋值' in e and '_biz_frames_map_explicit' in e for e in res['errors'])


def test_real_designer_passes_probe():
    """守护：仓库真实 designer.py 必须持续通过探针（防未来引入漂移源）。"""
    root = os.path.join(os.path.dirname(__file__), '..', '..')
    src_path = os.path.join(root, 'backend', 'designer.py')
    if not os.path.exists(src_path):
        pytest.skip('仓库根 backend/designer.py 不存在')
    with open(src_path, 'r', encoding='utf-8') as fh:
        res = analyze(fh.read())
    assert res['ok'], res['errors']
    # 真实代码的关键不变量：四口径开关齐备、JSON/INI 双路径均命中
    r = res['report']
    assert r['json_hit'] is True
    assert r['ini_hit'] is True
    assert {'biz_agg_oversubscription', 'biz_agg_chassis_spec',
            'biz_group_granularity', 'biz_chassis_frames_map'} <= set(r['caliber_keys'])
    assert not r['no_default_keys']


def test_real_designer_symmetric_override_recorded():
    """守护：biz_agg_chassis_ports 的向后兼容覆盖必须被记为对称（非不对称散落）。"""
    root = os.path.join(os.path.dirname(__file__), '..', '..')
    src_path = os.path.join(root, 'backend', 'designer.py')
    if not os.path.exists(src_path):
        pytest.skip('仓库根 backend/designer.py 不存在')
    with open(src_path, 'r', encoding='utf-8') as fh:
        res = analyze(fh.read())
    attrs = {s['attr'] for s in res['report']['scattered_symmetric']}
    assert 'biz_agg_chassis_ports' in attrs, \
        'biz_agg_chassis_ports 向后兼容覆盖应记为对称信息'
    assert not any(s['attr'] == 'biz_agg_chassis_ports'
                   for s in res['report']['scattered_assigns'])
