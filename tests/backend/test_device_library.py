"""H1 AL 设备库测试：加载 + 规格自洽 + 命名规范 + 硬编码映射一致。"""
import dataclasses
import glob
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))

from aidc_planner import DEFAULTS
import device_defaults as dd
from validate_device_library import check_device_library
from device_library import get_device_library

_LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'template', 'device_library')

_VALID_SPEEDS = ('1G', '10G', '25G', '40G', '50G', '100G', '200G', '400G', '800G', '1600G')


def _switches():
    out = []
    for p in glob.glob(os.path.join(_LIB, 'switches', '*', '*.json')):
        out.append(json.load(io.open(p, encoding='utf-8')))
    return out


def test_load_no_dup():
    sw = _switches()
    ids = [d['id'] for d in sw]
    assert len(ids) == len(set(ids))
    assert len(sw) >= 40


def test_spec_self_consistent():
    for d in _switches():
        assert d['port_count'] > 0
        assert d['port_speed'] in _VALID_SPEEDS, f"{d['id']} 速率非法 {d['port_speed']}"
        assert d['model'] != 'S9850-64H'  # 硬错误已清
        assert 'S9820-8C 固定64' not in d.get('description', '')


def test_naming_prefix():
    for d in _switches():
        assert d.get('name_prefix'), f"{d['id']} 缺 name_prefix"


def test_id_prefix():
    for d in _switches():
        if d.get('vendor') == '锐捷':
            assert d['id'].startswith('ruijie_rg_'), d['id']


def test_defaults_reference_existing_ids():
    sw_ids = {d['id'] for d in _switches()}
    for group in (dd.ROCE_DEFAULTS, dd.BIZ_DEFAULTS, dd.OOB_DEFAULTS):
        for key, did in group.items():
            assert did in sw_ids, f'{key}={did} 不在设备库'


def test_roce_defaults_real_400g():
    assert dd.ROCE_DEFAULTS['param_leaf_switch'] == 'h3c_s9825_64d'
    assert dd.ROCE_DEFAULTS['param_spine_switch'] == 'h3c_s9827'
    assert dd.ROCE_DEFAULTS['param_core_switch'] == 'h3c_s9827'
    assert dd.ROCE_DEFAULTS['param_leaf_switch'] not in ('h3c_s9850_64h', 'h3c_s9820_64h', 'h3c_s9820_8c')


def test_aidc_planner_models_match_library():
    sw = {d['id']: d for d in _switches()}
    mapping = {
        'SPINE': 'h3c_s9827', 'LEAF': 'h3c_s9827',
        'STO_SPINE': 'h3c_s9825_128b', 'STO_LEAF': 'h3c_s9825_128b',
        'BIZ_AGG': 'h3c_s9850_32h', 'BIZ_ACCESS': 'h3c_s6850_56hf',
        'OOB_AGG': 'h3c_s6805_56hf_g', 'OOB_ACCESS': 'h3c_s5560x_54c_ei',
    }
    for role, did in mapping.items():
        dev = sw[did]
        expected = f"{dev['vendor']} {dev['model']}"
        assert DEFAULTS['device_models'][role] == expected, f'{role} 应 {expected}'


class TestLibraryReconciliation:
    """5.0.1-501-c: 设备库对账校验（scripts/validate_device_library.py）

    索引 ↔ 目录一致性 / id 唯一 / 字段完整 / 分类合法 / 可互灌。
    """

    def _copy_lib(self, tmp_path):
        target = tmp_path / 'lib'
        shutil.copytree(_LIB, target)
        return str(target)

    def test_builtin_library_passes(self):
        """内置设备库全量对账通过（索引↔目录一致、无死文件、id 唯一、字段完整、分类合法）"""
        assert check_device_library(_LIB) == []

    def test_dead_file_detected(self, tmp_path):
        """目录存在但索引未注册的文件 → 死文件"""
        lib = self._copy_lib(tmp_path)
        with open(os.path.join(lib, 'optical_modules', 'om_dead_test.json'), 'w', encoding='utf-8') as f:
            json.dump({'id': 'om_dead_test'}, f)
        problems = check_device_library(lib)
        assert any('死文件' in p for p in problems)

    def test_missing_registered_file_detected(self, tmp_path):
        """索引注册但目录文件缺失"""
        lib = self._copy_lib(tmp_path)
        os.remove(os.path.join(lib, 'switches', 'param', 'h3c_s9820_64h.json'))
        problems = check_device_library(lib)
        assert any('文件缺失' in p and 'h3c_s9820_64h' in p for p in problems)

    def test_switch_missing_port_speed(self, tmp_path):
        """交换机缺 port_speed → 字段不完整"""
        lib = self._copy_lib(tmp_path)
        p = os.path.join(lib, 'switches', 'param', 'h3c_s9820_64h.json')
        data = json.load(open(p, encoding='utf-8'))
        data.pop('port_speed', None)
        json.dump(data, open(p, 'w', encoding='utf-8'))
        problems = check_device_library(lib)
        assert any('port_speed' in p_ for p_ in problems)

    def test_optical_missing_form_factor(self, tmp_path):
        """光模块缺 form_factor → 字段不完整"""
        lib = self._copy_lib(tmp_path)
        p = os.path.join(lib, 'optical_modules', 'om_400g_osfp_dr4_500m.json')
        data = json.load(open(p, encoding='utf-8'))
        data.pop('form_factor', None)
        json.dump(data, open(p, 'w', encoding='utf-8'))
        problems = check_device_library(lib)
        assert any('form_factor' in p_ for p_ in problems)

    def test_duplicate_id_detected(self, tmp_path):
        """同一 id 跨分类重复注册"""
        lib = self._copy_lib(tmp_path)
        idx = json.load(open(os.path.join(lib, 'library_index.json'), encoding='utf-8'))
        for cat in idx['categories']:
            if cat['id'] == 'gpu_servers':
                cat['device_ids'].append('nvidia_dgx_h100')
        json.dump(idx, open(os.path.join(lib, 'library_index.json'), 'w', encoding='utf-8'))
        problems = check_device_library(lib)
        assert any('重复注册' in p for p in problems)

    def test_category_mismatch_detected(self, tmp_path):
        """设备 JSON 的 category 与索引分类不一致"""
        lib = self._copy_lib(tmp_path)
        p = os.path.join(lib, 'gpu_servers', 'nvidia_dgx_a100.json')
        data = json.load(open(p, encoding='utf-8'))
        data['category'] = 'switches_param'
        json.dump(data, open(p, 'w', encoding='utf-8'))
        problems = check_device_library(lib)
        assert any('category' in p_ for p_ in problems)

    def test_id_filename_mismatch_detected(self, tmp_path):
        """JSON id 字段与文件名不一致"""
        lib = self._copy_lib(tmp_path)
        p = os.path.join(lib, 'compute_servers', 'generic_2u_compute.json')
        data = json.load(open(p, encoding='utf-8'))
        data['id'] = 'renamed_2u'
        json.dump(data, open(p, 'w', encoding='utf-8'))
        problems = check_device_library(lib)
        assert any('id 字段' in p_ and 'renamed_2u' in p_ for p_ in problems)


class TestCloudSyncPortableContract:
    """5.0.4-504-c: 设备库云同步可移植契约（autolink-device-library v1）

    客户端上传/拉取载荷须能被 parsePortableLibrary 解析（MC 扁平 / AL bundle / {devices} 外壳）。
    此处校验内置设备库具备云同步归一化所需字段，并演示 AL v1 bundle 载荷结构。
    """

    def _flat_devices(self):
        lib = get_device_library()
        assert lib.devices, '设备库加载为空'
        return list(lib.devices.values())

    def test_builtin_cloud_sync_fields(self):
        """内置库全部设备具备云同步归一化必需字段（id/power_watts；非光模块须 model/vendor）"""
        devices = self._flat_devices()
        assert len(devices) >= 40
        for dev in devices:
            assert getattr(dev, 'id', None), '缺 id'
            assert getattr(dev, 'power_watts', None) is not None
            if getattr(dev, 'category', None) != 'optical_modules':
                assert getattr(dev, 'vendor', None), '缺 vendor'
                assert getattr(dev, 'model', None), '缺 model'

    def test_al_v1_bundle_payload_shape(self):
        """构建 AL autolink-device-library v1 bundle：format/schemaVersion/exportedAt/devices 完整"""
        devices = self._flat_devices()
        payload = {
            'format': 'autolink-device-library',
            'schemaVersion': 1,
            'exportedAt': '2026-09-04T00:00:00Z',
            'devices': [dataclasses.asdict(d) for d in devices],
        }
        assert payload['format'] == 'autolink-device-library'
        assert payload['schemaVersion'] == 1
        assert isinstance(payload['devices'], list)
        assert len(payload['devices']) == len(devices)
        # 每条设备可 JSON 序列化（云同步 IPC 载荷边界，平台 parsePortableLibrary 可解析）
        text = json.dumps(payload, ensure_ascii=False)
        assert 'autolink-device-library' in text
        assert '"schemaVersion": 1' in text

    def test_flat_array_shell_compat(self):
        """MC 扁平数组 / {devices} 外壳两种形状均含归一化必需字段（非光模块须 model/vendor）"""
        devices = self._flat_devices()
        flat = [dataclasses.asdict(d) for d in devices]
        for dev in flat:
            if dev.get('category') != 'optical_modules':
                assert dev.get('model') and dev.get('vendor')
        shell = {'devices': flat}
        assert len(shell['devices']) == len(flat)
