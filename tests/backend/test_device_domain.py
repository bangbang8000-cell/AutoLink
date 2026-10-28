"""B1-02 / FR-A04：柜型判定改读结构化字段 domain。

后端在对象创建时写入设备域（gpu / compute / storage / network），拓扑输出节点透出
`domain`，前端 `toCabinetType` 只读该字段，中文 group 串降级为兜底。
"""
import json

from project_config import create_default_config
from designer import NetworkDesignerV2
from engine import handle_design


def _write(tmp_path, cfg, name='project_config.json'):
    path = tmp_path / name
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return path


def _base_cfg(name='bk_domain', gpu=2, allflash=1, hybrid=1, compute=1):
    cfg = create_default_config(name)
    cfg['topology'].update({
        'num_gpu_servers': gpu,
        'num_all_flash_storage': allflash,
        'num_hybrid_flash_storage': hybrid,
        'num_compute_servers': compute,
        'param_protocol': 'RoCE',
        'param_speed': '400G',
        'param_ports_per_server': 8,
        'param_switch_ports': 64,
        'storage_ports_per_server': 1,
        'storage_switch_ports': 64,
        'storage_downlink_limit': 32,
        'storage_speed': '200G',
    })
    return cfg


def test_designer_servers_carry_domain(tmp_path):
    d = NetworkDesignerV2(str(_write(tmp_path, _base_cfg())))
    by_name = {s.name: s for s in d.servers}
    assert by_name['GPU服务器_1'].domain == 'gpu'
    assert by_name['GPU服务器_2'].domain == 'gpu'
    assert by_name['存储服务器_1'].domain == 'storage'
    assert by_name['存储服务器_2'].domain == 'storage'
    assert by_name['通算服务器_1'].domain == 'compute'
    # 交换机不标注设备域（由拓扑输出统一归 network）
    assert all(sw.domain == '' for sw in d.all_switches())


def test_engine_nodes_carry_domain(tmp_path):
    path = _write(tmp_path, _base_cfg())
    res = handle_design({'configFile': str(path)})
    nodes = res['topology']['nodes']
    by_id = {n['id']: n for n in nodes}

    assert by_id['GPU服务器_1']['domain'] == 'gpu'
    assert by_id['存储服务器_1']['domain'] == 'storage'
    assert by_id['通算服务器_1']['domain'] == 'compute'
    for node in nodes:
        if node['type'] == 'server':
            assert node['domain'] in ('gpu', 'compute', 'storage')
        elif node['type'] == 'scaleup_gpu':
            assert node['domain'] == 'gpu'
        else:
            assert node['domain'] == 'network'


def test_gpu_pool_branch_carries_domain(tmp_path):
    cfg = _base_cfg(gpu=0)
    cfg['clusters'] = [{
        'cluster_id': 'c1',
        'role': 'P',
        'gpu_pools': [{'pool_id': 'A', 'count': 2}],
    }]
    d = NetworkDesignerV2(str(_write(tmp_path, cfg)))
    gpu_pool_servers = [s for s in d.servers if s.name.startswith('GPU服务器_A_')]
    assert len(gpu_pool_servers) == 2
    assert all(s.domain == 'gpu' for s in gpu_pool_servers)
