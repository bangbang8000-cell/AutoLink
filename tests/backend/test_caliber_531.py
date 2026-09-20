"""AutoLink v5.3.1（数值口径校准）—— 三项口径改动的回归守卫

对应大师 2026-09-19 拍板的三项口径（需求方反馈 P1-11 §八-2 / §10.2）：

  531-a 接入**分组粒度** `classify` 必须真的是「按服务器类别分别取整」；
  531-b 接入**上联口**默认 8 → 6（MLAG 对中 2 口作 peer-link，北向实际 6 口）；
  531-c 业务接入 / 汇聚交换机**不占用 GPU 机柜**（本就落独立网络柜，固化为断言）。

⚠️ 531-a 是「跨模块口径耦合」（designer 算组数 → topology 建链）。按 AL-G11 血训
   （同族事故已 2 次：`需求上联总数` / `上联需求总数` 字序颠倒导致 `.get(..., 0)` 恒读 0；
   以及 `topology.calculate()` 同族），守卫必须是**生产者→消费者端到端**用例 ——
   只测单侧函数会漏，因为手搓配置可以绕过生产者。

⚠️ 531-a 的历史教训（5.3.0 空开关）：原实现 `floor + 余数+1` 与 `merge` **数学恒等**，
   ⇒ 开关扫出 0 差异、从未生效，且**不会报任何错**。
   `TestClassifyGranularity531A::test_classify_is_not_dead_switch` 即钉死此回归。

⚠️ 531-b 的反向耦合（勿踩）：`designer.biz_access_ports = port_count − biz_access_uplinks`
   ⇒ 上联口 8→6 会让接入**下联口** 40→42。当前 23 套模板的 `biz_downlink_limit` 全为 25，
   `servers_per_access = min(access_ports, 25) = 25` 不变 ⇒ 对 golden **零影响**。
   但若将来某模板把 `biz_downlink_limit` 提到 >40，上联口的改动会**泄漏进分组粒度**，
   届时 golden 差异将无法用「Δ = −4 × 接入台数」归因。
"""
import io
import json
import math
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(_BACKEND))

from designer import NetworkDesignerV2      # noqa: E402
from topology import AccessAggTopology      # noqa: E402

_TPL_DIR = Path(__file__).resolve().parents[2] / 'template'
_BASE_TPL = 'H100-128台'

# 需求方 §10.2 的精确案例：GPU 1250 / 存储 70 / 通算 60，每组 45 台
_CASE_GPU, _CASE_STORAGE, _CASE_COMPUTE = 1250, 70, 60
_CASE_SPA = 45
_CASE_TOTAL = _CASE_GPU + _CASE_STORAGE + _CASE_COMPUTE          # 1380
_CASE_MERGE_GROUPS = math.ceil(_CASE_TOTAL / _CASE_SPA)          # 31
_CASE_CLASSIFY_GROUPS = (math.ceil(_CASE_GPU / _CASE_SPA)
                         + math.ceil(_CASE_STORAGE / _CASE_SPA)
                         + math.ceil(_CASE_COMPUTE / _CASE_SPA))  # 28 + 2 + 2 = 32


# ----------------------------------------------------------------------
# 助手
# ----------------------------------------------------------------------
def _base_cfg(tpl=_BASE_TPL):
    return json.loads((_TPL_DIR / tpl / 'project_config.json').read_text(encoding='utf-8'))


def _design(cfg, tmp_path, name='project_config.json'):
    """静默设计（吞掉 designer 的 stdout 摘要）"""
    p = Path(tmp_path) / name
    p.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    buf = io.StringIO()
    with redirect_stdout(buf):
        return NetworkDesignerV2(str(p))


def _case_cfg(granularity):
    """需求方 §10.2 案例：GPU 1250 / 存储 70 / 通算 60 @ 每组 45 台"""
    cfg = _base_cfg()
    cfg['topology'].update({
        'num_gpu_servers': _CASE_GPU,
        'num_all_flash_storage': _CASE_STORAGE,
        'num_hybrid_flash_storage': 0,
        'num_compute_servers': _CASE_COMPUTE,
        'biz_downlink_limit': _CASE_SPA,
        'biz_group_granularity': granularity,
    })
    return cfg


def _topo(access_down_ports=48, access_up_ports=6, agg_down_ports=32,
          downlink_limit=_CASE_SPA):
    return AccessAggTopology(
        access_down_ports=access_down_ports,
        access_up_ports=access_up_ports,
        agg_down_ports=agg_down_ports,
        downlink_speed='25G', uplink_speed='100G',
        cable_server_access='光纤', cable_access_agg='光纤',
        network_name='业务', redundancy=True, downlink_limit=downlink_limit,
    )


def _server_facing_links(d):
    """接入交换机上「面向服务器」的连接条数（排除接入↔汇聚的上联记录）"""
    server_names = {s.name for s in d.servers}
    return sum(1 for sw in d.biz_access for c in sw.connections
               if c.a_device in server_names or c.z_device in server_names)


# ----------------------------------------------------------------------
# 531-b 接入上联口默认 6
# ----------------------------------------------------------------------
class TestUplinkDefault531B:
    """531-b：`biz_access_uplinks` 默认 8 → 6（NIC 口径，见 CHANGELOG 5.3.1）。"""

    def test_json_default_is_six(self, tmp_path):
        """未显式配置时（JSON 项目）默认 6。"""
        d = _design(_base_cfg(), tmp_path)
        assert d.biz_access_uplinks == 6, (
            '接入上联口默认应为 6（MLAG 对中 2 口作 peer-link，北向实际上联 6 口）')

    def test_ini_default_is_six(self, tmp_path):
        """INI 项目未显式配置时同样默认 6。"""
        ini = Path(tmp_path) / 'network_config.ini'
        ini.write_text(
            '[DEFAULT]\n'
            'num_servers = 50\n'
            'param_switch_ports = 64\n'
            'param_ports_per_server = 8\n'
            'param_speed = 400G\n'
            'storage_ports_per_server = 1\n'
            'storage_switch_ports = 48\n'
            'storage_speed = 200G\n'
            'oob_enabled = False\n'
            'biz_enabled = True\n',
            encoding='utf-8')
        buf = io.StringIO()
        with redirect_stdout(buf):
            d = NetworkDesignerV2(str(ini))
        assert d.biz_access_uplinks == 6

    def test_ini_explicit_value_still_wins(self, tmp_path):
        """显式配置优先 —— 存量项目（INI）给了 8 就仍按 8 算，不静默改客户口径。"""
        ini = Path(tmp_path) / 'network_config.ini'
        ini.write_text(
            '[DEFAULT]\n'
            'num_servers = 50\n'
            'param_switch_ports = 64\n'
            'param_ports_per_server = 8\n'
            'param_speed = 400G\n'
            'storage_ports_per_server = 1\n'
            'storage_switch_ports = 48\n'
            'storage_speed = 200G\n'
            'oob_enabled = False\n'
            'biz_enabled = True\n'
            'biz_access_ports = 48\n'
            'biz_access_uplinks = 8\n',
            encoding='utf-8')
        buf = io.StringIO()
        with redirect_stdout(buf):
            d = NetworkDesignerV2(str(ini))
        assert d.biz_access_uplinks == 8, 'INI 显式值必须优先于默认值'
        # ⚠️ 双路径语义**不对称**（既有行为，非本版引入）：
        #    INI  → `biz_access_ports` 取 ini 值**原样**（此处 48，即下联口数）；
        #    JSON → `biz_access_ports = 档案 port_count − biz_access_uplinks`（本案 48−6=42）。
        #    本断言钉住 INI 侧的既有语义，避免将来被「顺手统一」而静默改动存量 INI 项目。
        assert d.biz_access_ports == 48

    def test_requirement_matches_built_access_count(self, tmp_path):
        """端到端：契约里的「上联需求总数」必须等于 **按同一上联口数** 建出的需求。

        这是防「口径脱钩」的核心断言 —— 若建链用 6 口而契约按 8 口报数（或反之），
        校验会读到自相矛盾的两个数字，正是 5.3.0 那类缺陷的形状。
        """
        d = _design(_base_cfg(), tmp_path)
        pc = d.biz_info['port_conservation']
        expected = len(d.biz_access) * d.biz_access_uplinks
        assert pc['上联需求总数'] == expected
        assert d.biz_info['total_access_uplinks'] == expected

    def test_json_explicit_value_is_honored(self, tmp_path):
        """V5.3.1-531-b2：JSON 项目同样可配。

        此前 `biz_access_uplinks` 在 JSON 路径**被完全忽略**（写 4/8 都是默认值），
        是四条口径键（收敛比 / 框规格 / 分组粒度 / 上联口）里唯一不可配的一条。
        """
        cfg = _base_cfg()
        cfg['topology']['biz_access_uplinks'] = 8
        d = _design(cfg, tmp_path)
        assert d.biz_access_uplinks == 8, 'JSON 项目的显式配置必须被读取'
        # JSON 路径语义：下联口 + 上联口 == 交换机档案总口数（48）
        assert d.biz_access_ports + d.biz_access_uplinks == 48

    def test_access_ports_split_matches_profile(self, tmp_path):
        """反向耦合守卫：JSON 路径下联口 = 档案总口数 − 上联口（= 42 + 6 = 48）。"""
        d = _design(_base_cfg(), tmp_path)
        assert d.biz_access_uplinks == 6
        assert d.biz_access_ports == 42
        assert d.biz_access_ports + d.biz_access_uplinks == 48

    @pytest.mark.parametrize('bad', [0, -3, 'abc', None, ''])
    def test_json_invalid_uplink_falls_back_to_six(self, tmp_path, bad):
        """非法值一律回退默认 6，绝不静默变成 0 口（0 上联 ⇒ 组内不接汇聚）。"""
        cfg = _base_cfg()
        cfg['topology']['biz_access_uplinks'] = bad
        d = _design(cfg, tmp_path)
        assert d.biz_access_uplinks == 6


# ----------------------------------------------------------------------
# 531-a 分组粒度「按类别分别取整」
# ----------------------------------------------------------------------
class TestClassifyGranularity531A:
    """531-a：`biz_group_granularity=classify` = Σ_类别 ceil(该类别台数 / 每组台数)。"""

    def test_topology_matches_customer_case(self):
        """需求方 §10.2 精确案例：1380 台 @45 ⇒ merge 31 组，classify 32 组。"""
        cats = [('gpu', _CASE_GPU), ('storage', _CASE_STORAGE), ('compute', _CASE_COMPUTE)]

        merge = _topo().calculate(_CASE_TOTAL, {'enabled': True, 'frames': 99}, None)
        classify = _topo().calculate(_CASE_TOTAL, {'enabled': True, 'frames': 99}, cats)

        assert merge['servers_per_access'] == _CASE_SPA
        assert classify['servers_per_access'] == _CASE_SPA

        assert merge['num_access'] // 2 == _CASE_MERGE_GROUPS == 31
        assert classify['num_access'] // 2 == _CASE_CLASSIFY_GROUPS == 32

        # MLAG ⇒ 接入台数 = 组数 × 2
        assert merge['num_access'] == 62
        assert classify['num_access'] == 64

        # 验收口径自洽：64 × 6 = 384 = 2 × 192（8 槽 6 板）
        assert classify['total_access_uplinks'] == 64 * 6 == 384

    def test_classify_is_not_dead_switch(self):
        """**空开关回归守卫**：classify 必须与 merge 有可观测差异。

        5.3.0 把 classify 实现成 `floor + 余数+1`，与 `ceil` 数学恒等 ⇒ 扫出 0 差异、
        开关空转且不报错。此断言一旦回退到恒等实现立即变红。
        """
        cats = [('gpu', _CASE_GPU), ('storage', _CASE_STORAGE), ('compute', _CASE_COMPUTE)]
        merge = _topo().calculate(_CASE_TOTAL, None, None)
        classify = _topo().calculate(_CASE_TOTAL, None, cats)
        assert classify['num_access'] > merge['num_access'], (
            'classify 与 merge 结果相同 ⇒ 开关又变回空转（5.3.0 缺陷复发）')

    @pytest.mark.parametrize('granularity,expected', [('merge', 66), ('classify', 68)])
    def test_designer_end_to_end_matches_topology(self, tmp_path, granularity, expected):
        """**跨模块端到端**：designer 算出的组数与 topology 建链口径必须逐位一致。

        （expected 由 designer 的**生效** servers_per_access 决定 —— 本案为 42，
          因为 `biz_access_ports = 档案总口数(48) − 上联口(6)` = 42；故 33 组 / 34 组。
          这里刻意用生效值断言，避免与档案漂移耦合。）
        """
        d = _design(_case_cfg(granularity), tmp_path)
        spa = d.biz_info['servers_per_access']
        cats = d._biz_server_category_counts()
        topo = _topo(downlink_limit=spa)

        sent = cats if granularity == 'classify' else None
        designer_groups = d._biz_num_access_groups(d.total_servers, spa)
        topology_groups = topo._num_access_groups(d.total_servers, spa, sent)

        assert designer_groups == topology_groups, (
            f'{granularity}: designer 组数 {designer_groups} != topology 组数 {topology_groups}')
        assert d.biz_info['num_access'] == designer_groups * 2 == expected

    def test_classify_design_has_no_dropped_links(self, tmp_path):
        """classify 口径下建链必须完整：无静默丢弃、逐层守恒、每台接入都真的接了服务器。"""
        d = _design(_case_cfg('classify'), tmp_path)
        info = d.biz_info

        assert info['dropped_link_count'] == 0
        assert info['port_conservation']['是否守恒'] is True
        assert all(sw.connections for sw in d.biz_access), '存在建了却空转的接入交换机'
        # MLAG 双上联 ⇒ 服务器侧连接数 = 2 × 总台数
        assert _server_facing_links(d) == 2 * d.total_servers

    def test_categories_map_to_contiguous_group_ranges(self):
        """按类别分别取整 ⇒ 各类别占据**连续**的组号段，不与邻类混组。"""
        topo = _topo()
        servers = list(range(_CASE_TOTAL))          # 只需长度
        cats = [('gpu', _CASE_GPU), ('storage', _CASE_STORAGE), ('compute', _CASE_COMPUTE)]
        idx = topo._server_group_indices(servers, cats, _CASE_SPA)

        assert len(idx) == _CASE_TOTAL
        gpu_idx = idx[:_CASE_GPU]
        sto_idx = idx[_CASE_GPU:_CASE_GPU + _CASE_STORAGE]
        com_idx = idx[_CASE_GPU + _CASE_STORAGE:]

        assert (min(gpu_idx), max(gpu_idx)) == (0, 27)          # 28 组
        assert set(sto_idx) == {28, 29}                         # 2 组
        assert set(com_idx) == {30, 31}                         # 2 组
        assert len(set(idx)) == _CASE_CLASSIFY_GROUPS == 32
        # 类别间不得混组
        assert max(gpu_idx) < min(sto_idx) < max(sto_idx) < min(com_idx)

    def test_group_indices_fall_back_when_category_sum_mismatch(self):
        """类别台数之和 ≠ 服务器总数 ⇒ **回退按位切分**（宁可保持历史行为也不静默错配）。"""
        topo = _topo()
        idx = topo._server_group_indices(list(range(100)), [('gpu', 60)], 45)
        assert idx == [i // 45 for i in range(100)]

    def test_group_indices_default_is_by_index(self):
        """默认（无类别）必须与历史按位切分**逐位相同**。"""
        topo = _topo()
        n = 500
        assert topo._server_group_indices(list(range(n)), None, 45) == [i // 45 for i in range(n)]

    def test_invalid_granularity_falls_back_to_merge(self, tmp_path):
        """非法粒度值回退 merge（不抛异常、不静默变成 classify）。"""
        cfg = _case_cfg('merge')
        cfg['topology']['biz_group_granularity'] = 'nonsense'
        d = _design(cfg, tmp_path)
        assert d.biz_group_granularity == 'merge'
        assert d.biz_info['num_access'] == 66


# ----------------------------------------------------------------------
# 531-c 业务交换机不进 GPU 机柜
# ----------------------------------------------------------------------
class TestBizSwitchCabinet531C:
    """531-c：业务接入 / 汇聚交换机落**独立网络柜**，不得占用 GPU 机柜。"""

    def test_biz_switches_never_share_gpu_cabinet(self, tmp_path):
        d = _design(_base_cfg(), tmp_path)
        gpu_cabinets = {s.cabinet_name for s in d.servers[:d.num_servers]}

        offenders = [sw.name for sw in (list(d.biz_access) + list(d.biz_agg))
                     if sw.cabinet_name in gpu_cabinets]
        assert not offenders, f'业务交换机侵占了 GPU 机柜: {offenders[:5]}'

    def test_biz_switches_are_in_network_cabinets(self, tmp_path):
        d = _design(_base_cfg(), tmp_path)
        by_name = {c.name: c for c in (getattr(d, '_rack_cabinets', []) or [])}

        names = {sw.cabinet_name for sw in (list(d.biz_access) + list(d.biz_agg))}
        assert names, '业务交换机未入任何机柜'
        for n in names:
            cab = by_name.get(n)
            assert cab is not None, f'机柜 {n} 不在 _rack_cabinets 中'
            assert cab.type == 'network', f'机柜 {n} 类型为 {cab.type!r}，应为 network'

    def test_network_cabinet_hosts_only_network_devices(self, tmp_path):
        """网络柜内不得混入服务器（否则即「业务汇聚进 GPU 机柜」的等价缺陷）。"""
        d = _design(_base_cfg(), tmp_path)
        server_names = {s.name for s in d.servers}
        biz_cabinet_names = {sw.cabinet_name for sw in (list(d.biz_access) + list(d.biz_agg))}

        for cab in (getattr(d, '_rack_cabinets', []) or []):
            if cab.name not in biz_cabinet_names:
                continue
            for slot in cab.devices:
                assert slot.name not in server_names, (
                    f'服务器 {slot.name} 混入业务网络柜 {cab.name}')
                assert slot.device_type == 'network'


# ----------------------------------------------------------------------
# 531-d 口径开关「双路径全覆盖」守卫（AL-G11）
# ----------------------------------------------------------------------
# 枚举，**不是**照抄常量 —— 新增口径开关必须同时加进这里，否则守卫失效。
_CALIBER_SWITCHES = (
    'biz_agg_oversubscription',   # 汇聚收敛比
    'biz_agg_chassis_spec',       # 单框下行口规格
    'biz_group_granularity',      # 分组粒度
    '_biz_frames_map_explicit',   # 框数映射表是否被显式配置
)


def _ini_cfg(tmp_path, extra=''):
    ini = Path(tmp_path) / 'network_config.ini'
    ini.write_text(
        '[DEFAULT]\n'
        'num_servers = 50\n'
        'param_switch_ports = 64\n'
        'param_ports_per_server = 8\n'
        'param_speed = 400G\n'
        'storage_ports_per_server = 1\n'
        'storage_switch_ports = 48\n'
        'storage_speed = 200G\n'
        'oob_enabled = False\n'
        'biz_enabled = True\n' + extra,
        encoding='utf-8')
    return ini


class TestCaliberSwitchCoverage531D:
    """531-d：`_init_biz_caliber_switches` 必须是「数值口径」开关的**唯一**初始化入口。

    血训两连：
      - 5.3.0 只在 JSON 路径赋值 ⇒ INI 路径下这些属性**根本不存在**；当时因开关
        「只赋值、无人读」而未暴露，直到 5.3.1 把 category_counts 接进建链才炸出
        AttributeError。
      - 5.3.1 修了前三项，却**漏掉第 4 项** `_biz_frames_map_explicit` ⇒ CI 的
        `validate_templates.py`（会跑 INI 模板）当场全红，而本地「门禁四连 + 后端
        单测」全绿也没逮到 —— 因为两者都没跑 INI 模板这条路径。

    ⇒ 本类用**枚举**把「漏项」钉死：新增口径开关若不接线，这里立刻红。
    """

    def test_ini_path_exposes_all_caliber_switches(self, tmp_path):
        buf = io.StringIO()
        with redirect_stdout(buf):
            d = NetworkDesignerV2(str(_ini_cfg(tmp_path)))
        missing = [n for n in _CALIBER_SWITCHES if not hasattr(d, n)]
        assert not missing, f'INI 路径缺少口径开关: {missing}'

    def test_json_path_exposes_all_caliber_switches(self, tmp_path):
        d = _design(_base_cfg(), tmp_path)
        missing = [n for n in _CALIBER_SWITCHES if not hasattr(d, n)]
        assert not missing, f'JSON 路径缺少口径开关: {missing}'

    def test_ini_design_completes_and_builds_biz_layer(self, tmp_path):
        """端到端：INI 路径必须真能跑完业务网设计，而非只差在属性读取那一刻。"""
        buf = io.StringIO()
        with redirect_stdout(buf):
            d = NetworkDesignerV2(str(_ini_cfg(tmp_path)))
        assert list(d.biz_access), 'INI 路径未建出业务接入层'
        assert list(d.biz_agg), 'INI 路径未建出业务汇聚层'

    def test_frames_map_explicit_flag_semantics(self, tmp_path):
        """`_biz_frames_map_explicit`：JSON 显式配了才 True；INI 无此键恒 False。"""
        d_plain = _design(_base_cfg(), tmp_path)
        assert d_plain._biz_frames_map_explicit is False, (
            '未配置框数映射表时不应标记为「显式」')

        cfg = _base_cfg()
        cfg['topology']['biz_chassis_frames_map'] = [[512, 4], [1024, 8], [999999, 16]]
        d_exp = _design(cfg, tmp_path, name='explicit_project_config.json')
        assert d_exp._biz_frames_map_explicit is True, (
            '项目显式配置框数映射表时必须标记为「显式」')

        buf = io.StringIO()
        with redirect_stdout(buf):
            d_ini = NetworkDesignerV2(str(_ini_cfg(tmp_path)))
        assert d_ini._biz_frames_map_explicit is False, (
            'INI 旧格式不支持覆盖框数映射表，应恒为 False（走端口需求推导）')
