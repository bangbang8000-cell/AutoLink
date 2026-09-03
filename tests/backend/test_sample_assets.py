"""49-d（示例资产与收官）：4 个示例模板门禁（F9-2 示例库自动化验收）

复用 scripts/validate_samples.py 的校验函数，以 pytest 形式兜住：
  - 示例发现：isSample=true 模板恰为 4 个（64/128 × IB/RoCE）
  - 全量校验：project_config / 设计可消费 / 机柜合规 / INI-JSON 等价 / plan 自包含回导 /
    room_layout / 导出往返一致（validate_sample 全绿）
  - 协议差异：IB 收敛比 < RoCE、参数网设备型号不同、param_protocol 正确
  - 从模板建样例项目往返：复制 5 件套 → 设计可渲染 → plan 回导 → zip 交付包回灌一致
"""
import json
import os
import shutil
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

import pytest  # noqa: E402

from aidc_planner import import_plan  # noqa: E402
from validate_samples import (  # noqa: E402
    PLAN_REQUIRED_SECTIONS,
    discover_samples,
    validate_sample,
)

BASE = os.path.join(os.path.dirname(__file__), '..', '..', 'template')

EXPECTED_SAMPLE_IDS = {'H100-64台-IB', 'H100-64台-RoCE', 'H100-128台-IB', 'H100-128台-RoCE'}


def _read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def test_discover_exactly_four_samples():
    """示例发现：isSample=true 模板恰为 4 个，ID 与规格一致"""
    samples = discover_samples()
    ids = {name for name, _ in samples}
    assert ids == EXPECTED_SAMPLE_IDS


@pytest.mark.parametrize('sample_id', sorted(EXPECTED_SAMPLE_IDS))
def test_sample_valid(sample_id):
    """单个示例全量校验（配置/设计/机柜/INI-JSON/plan/room/导出往返）"""
    tpl_dir = os.path.join(BASE, sample_id)
    assert os.path.isdir(tpl_dir)
    problems = validate_sample(sample_id, tpl_dir)
    assert not problems, '\n'.join(problems)


@pytest.mark.parametrize('sample_id', sorted(EXPECTED_SAMPLE_IDS))
def test_sample_plan_self_contained(sample_id):
    """plan.json 自包含（契约 v1.2 全段）+ 回导 ok"""
    plan = _read_json(os.path.join(BASE, sample_id, 'plan.json'))
    for sec in PLAN_REQUIRED_SECTIONS:
        assert sec in plan, f'缺少契约段 {sec}'
    assert str(plan['meta']['schema']).startswith('plan:table/')
    res = import_plan(plan)
    assert res['ok'] is True
    assert res['planHash'] == plan['meta']['planHash']


def test_ib_roce_differences_correct():
    """IB 与 RoCE 差异：收敛比（IB 无阻塞 < RoCE 收敛）+ 设备型号 + 协议"""
    by_proto = {}
    for sample_id, proto in (('H100-64台-IB', 'IB'), ('H100-64台-RoCE', 'RoCE'),
                             ('H100-128台-IB', 'IB'), ('H100-128台-RoCE', 'RoCE')):
        plan = _read_json(os.path.join(BASE, sample_id, 'plan.json'))
        assert plan['macro']['protocol'] == proto
        assert plan['macro']['gpuCount'] in (64, 128)
        by_proto.setdefault(proto, []).append(plan)
    ib_conv = by_proto['IB'][0]['macro']['convergence']
    roce_conv = by_proto['RoCE'][0]['macro']['convergence']
    assert ib_conv < roce_conv, 'IB 应为无阻塞（收敛比更小）'
    ib_model = by_proto['IB'][0]['macro']['deviceModels']['LEAF']
    roce_model = by_proto['RoCE'][0]['macro']['deviceModels']['LEAF']
    assert ib_model != roce_model
    # 5.0.1-501-a: IB 参数网 Leaf 为 NVIDIA Quantum-2（MQM9700），RoCE Leaf 为 H3C S9825-64D
    assert 'Quantum' in ib_model
    assert 'S9825' in roce_model or 'S9827' in roce_model


@pytest.mark.parametrize('sample_id', sorted(EXPECTED_SAMPLE_IDS))
def test_plan_device_models_match_device_refs(sample_id):
    """5.0.1-501-a: plan.macro.deviceModels 与 project_config.device_refs 解析型号严格一致"""
    from device_library import get_device_library
    from validate_samples import ROLE_DEVICE_REF
    lib = get_device_library()
    plan = _read_json(os.path.join(BASE, sample_id, 'plan.json'))
    config = _read_json(os.path.join(BASE, sample_id, 'project_config.json'))
    for role, ref_key in ROLE_DEVICE_REF.items():
        ref = config['device_refs'][ref_key]
        dev = lib.resolve_ref(ref)
        assert dev is not None, f'{sample_id}: {ref_key} 无法解析'
        expected = f"{dev.vendor} {dev.model}".strip()
        assert plan['macro']['deviceModels'][role] == expected, \
            f'{sample_id}: plan {role}={plan["macro"]["deviceModels"][role]!r} != {expected!r}'


def test_room_layout_gpu_capacity():
    """机房矩阵 gpu 分区格数 ≥ GPU 服务器数（矩阵定稿容量）"""
    for sample_id in EXPECTED_SAMPLE_IDS:
        layout = _read_json(os.path.join(BASE, sample_id, 'room_layout.json'))
        config = _read_json(os.path.join(BASE, sample_id, 'project_config.json'))
        gpu_cells = sum(1 for c in layout['cells'] if c.get('type') == 'gpu')
        assert gpu_cells >= config['topology']['num_gpu_servers'], sample_id


def test_template_create_project_roundtrip():
    """从模板建样例项目往返：复制 5 件套 → 设计可渲染 → plan 回导 → zip 交付包回灌一致"""
    sample_id = 'H100-64台-RoCE'
    tpl_dir = os.path.join(BASE, sample_id)
    with tempfile.TemporaryDirectory() as tmp:
        proj = os.path.join(tmp, '项目')
        os.makedirs(proj)
        for fname in ('project_config.json', 'network_config.ini', 'plan.json',
                      'room_layout.json', 'template.json'):
            shutil.copyfile(os.path.join(tpl_dir, fname), os.path.join(proj, fname))

        # 设计可渲染
        from designer import NetworkDesignerV2
        d = NetworkDesignerV2(os.path.join(proj, 'project_config.json'))
        assert d.validate_topology()['valid'] is True
        assert len(d.servers) == 80

        # plan 回导
        plan = _read_json(os.path.join(proj, 'plan.json'))
        res = import_plan(plan)
        assert res['ok'] is True

        # zip 交付包回灌一致（同端往返）
        from aidc_planner import export_plan
        zip_path = export_plan({
            'gpu_count': plan['macro']['gpuCount'],
            'protocol': plan['macro']['protocol'],
            'convergence': plan['macro']['convergence'],
            'device_models': plan['macro']['deviceModels'],
            'project_id': plan['meta']['projectId'],
            'project_name': plan['meta'].get('projectName', sample_id),
        }, os.path.join(proj, 'pkg'), 'zip')
        with zipfile.ZipFile(zip_path) as zf:
            rt = json.loads(zf.read('plan.json').decode('utf-8'))
        rt_res = import_plan(rt)
        assert rt_res['ok'] is True
        assert rt_res['planHash'] == rt['meta']['planHash'] == plan['meta']['planHash']
