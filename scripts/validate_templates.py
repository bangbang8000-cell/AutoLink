"""验证所有场景模板能被设计师正确解析"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from designer import NetworkDesignerV2

templates = [
    'SuperPOD-256', 'NVL72-单架', '国产-昇腾-256',
    'L20-推理-64', '液冷-H100-256', '大型-1024', '超大-2048',
]
base = os.path.join(os.path.dirname(__file__), '..', 'template')

for t in templates:
    ini = os.path.join(base, t, 'network_config.ini')
    if not os.path.exists(ini):
        print(f'[FAIL] {t}: 文件不存在')
        continue
    try:
        d = NetworkDesignerV2(ini)
        result = d.validate_topology()
        v = result['valid']
        errs = result['errors']
        conn_count = sum(len(s.connections) for s in d.servers) // 2
        print(f'[OK]   {t}: servers={d.num_servers}, '
              f'leaves={len(d.param_leaves)}, spines={len(d.param_spines)}, '
              f'cores={len(d.param_cores)}, conns={conn_count}, '
              f'valid={v}')
        if not v:
            print(f'       errors: {errs}')
    except Exception as e:
        print(f'[FAIL] {t}: {e}')
