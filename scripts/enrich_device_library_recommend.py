"""523-e: 设备库推荐信息批量补充（幂等）

按规则为 template/device_library/ 下所有设备 JSON 补充:
  - recommended_scenario (服务器): 应用场景 training/inference/storage/compute
  - recommended_network  (交换机): 推荐组网 rail_optimized/dual_plane/zcube/independent/合分模式

规则:
  交换机 (switches_*):
    param: 200G -> ['rail_optimized']; port_count>=96 -> ['rail_optimized','dual_plane','zcube'];
           port_count>=48 -> ['rail_optimized','dual_plane']; 否则 ['rail_optimized']
    storage: ['independent']
    biz: ['independent','biz_oob_2in1','eth_3in1','inference_4in1']
    oob: ['independent','eth_3in1']
  服务器:
    gpu_servers: 按型号映射 training/inference
    storage_servers_*: ['storage']
    compute_servers: ['compute']
  光模块: 不补充 (无推荐字段语义)

幂等: 已存在值则跳过；仅补缺省。
用法: python scripts/enrich_device_library_recommend.py
"""
import json
import os

_LIB = os.path.join(os.path.dirname(__file__), '..', 'template', 'device_library')

_CATEGORY_DIRS = {
    'gpu_servers': 'gpu_servers',
    'compute_servers': 'compute_servers',
    'storage_servers_all_flash': 'storage_servers/all_flash',
    'storage_servers_hybrid_flash': 'storage_servers/hybrid_flash',
    'storage_servers_parallel_fs': 'storage_servers/parallel_fs',
    'switches_param': 'switches/param',
    'switches_storage': 'switches/storage',
    'switches_biz': 'switches/biz',
    'switches_oob': 'switches/oob',
    'optical_modules': 'optical_modules',
    'custom': 'custom',
}

# GPU 型号 → 应用场景（训练/推理识别，522-f 推理域推荐依赖）
_GPU_SCENARIO = {
    'ascend_910c': ['training'],
    'cambricon_mlu590_8u': ['training'],
    'fusionserver_v8_liquid': ['training'],
    'generic_4u_gpu': ['training', 'inference'],
    'h3c_r5500_g7': ['training', 'inference'],
    'huawei_atlas_800t_a2': ['training'],
    'huawei_atlas_900': ['training'],
    'hygon_k100_ai': ['training'],
    'inspur_nf5688m7': ['training', 'inference'],
    'nvidia_dgx_a100': ['training'],
    'nvidia_dgx_b200': ['training'],
    'nvidia_dgx_b300': ['training'],
    'nvidia_dgx_gb300_nvl72': ['training'],
    'nvidia_dgx_h100': ['training'],
    'nvidia_hgx_h200': ['training'],
    'nvidia_l20_8u': ['inference'],
    'nvidia_l40s_8u': ['inference'],
}


def _switch_network(cat: str, dev: dict) -> list:
    if cat == 'switches_param':
        speed = str(dev.get('port_speed') or '')
        if '200G' in speed:
            return ['rail_optimized']
        ports = int(dev.get('port_count') or 0)
        if ports >= 96:
            return ['rail_optimized', 'dual_plane', 'zcube']
        if ports >= 48:
            return ['rail_optimized', 'dual_plane']
        return ['rail_optimized']
    if cat == 'switches_storage':
        return ['independent']
    if cat == 'switches_biz':
        return ['independent', 'biz_oob_2in1', 'eth_3in1', 'inference_4in1']
    if cat == 'switches_oob':
        return ['independent', 'eth_3in1']
    return []


def _server_scenario(cat: str, did: str) -> list:
    if cat == 'gpu_servers':
        return _GPU_SCENARIO.get(did, ['training', 'inference'])
    if cat.startswith('storage_servers'):
        return ['storage']
    if cat == 'compute_servers':
        return ['compute']
    return []


def enrich() -> int:
    changed = 0
    skipped = 0
    index_path = os.path.join(_LIB, 'library_index.json')
    with open(index_path, encoding='utf-8') as f:
        index = json.load(f)

    for cat in index.get('categories', []):
        cid = cat.get('id') or ''
        cat_dir = os.path.join(_LIB, _CATEGORY_DIRS.get(cid, cid))
        for did in cat.get('device_ids', []):
            fp = os.path.join(cat_dir, f'{did}.json')
            if not os.path.isfile(fp):
                print(f'[skip] 缺文件 {cid}/{did}.json')
                continue
            with open(fp, encoding='utf-8') as f:
                dev = json.load(f)
            is_switch = cid in ('switches_param', 'switches_storage', 'switches_biz', 'switches_oob')
            is_server = cid.startswith('gpu_') or cid.startswith('storage_') or cid.startswith('compute_')
            if is_switch:
                if dev.get('recommended_network') is None:
                    dev['recommended_network'] = _switch_network(cid, dev)
                    changed += 1
                else:
                    skipped += 1
            elif is_server:
                if dev.get('recommended_scenario') is None:
                    dev['recommended_scenario'] = _server_scenario(cid, did)
                    changed += 1
                else:
                    skipped += 1
            else:
                skipped += 1
                continue
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(dev, f, ensure_ascii=False, indent=2)
                f.write('\n')
    print(f'补充 {changed} 个设备，跳过 {skipped} 个（已有值/不适用）')
    return 0


if __name__ == '__main__':
    raise SystemExit(enrich())
