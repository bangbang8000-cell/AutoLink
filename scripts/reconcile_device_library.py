#!/usr/bin/env python3
"""AL ↔ MC 设备库对账与拷贝（V5.4.0-640-l / W2.6，PRD §2.3-④ / NFR-3）

AL 设备库（template/device_library/，多目录 + library_index.json）为**权威**；
MC 设备库（backend/intent/device_library.json，单文件数组）为消费方。

对账口径（型号名 / 端口数 / 速率 / 厂商 → 模板族映射的判据）：
  1. **MC 不得出现 AL 不存在的型号**（MC-only 即红：无权威来源）；
  2. 共有型号的 port_count / port_speed / vendor 必须一致（漂移即红）；
  3. 6 场景关键型号必须已在 MC（W2.6 预置清单，S6 样例依赖）。

用法：
  python scripts/reconcile_device_library.py              # 只对账（差异 → 退出码 1）
  python scripts/reconcile_device_library.py --sync       # 先按清单拷贝 AL→MC 再对账
  python scripts/reconcile_device_library.py --mc-path <mc device_library.json>

--sync 写入 MC 设备库后，MC 侧需另行渲染门禁（validate_samples 等）复核格式。
CI 落地见 W7.4（双端设备库对账进 CI）。
"""
import argparse
import json
import os
import sys

KEY_MODELS = [  # 6 场景关键型号（W2.6 / W4.3 扩容目标，S6 样例依赖）
    'inspur_x400_128_400g',              # 场景③⑤（RoCE 参数/存储）
    'nvidia_mqm9700_64_400g_ib',         # 场景①④ 参数网
    'nvidia_mqm9700_64_400g_ib_storage', # 场景①②④⑥ IB 存储网（同型复用）
    'nvidia_q3400_144_800g_ib',          # 场景②⑥
    'nvidia_dgx_b300',                   # 场景⑥
    'nvidia_hgx_h200',                   # 场景①-⑤
    'generic_all_flash',                 # 全闪存储服务器
    'generic_hybrid_flash',              # 混闪存储服务器
    'generic_2u_compute',                # 通算服务器
]

AL_INDEX = os.path.join(os.path.dirname(__file__), '..', 'template', 'device_library', 'library_index.json')
DEFAULT_MC = os.path.join(os.path.dirname(__file__), '..', '..', 'MagicCommander-Client',
                          'backend', 'intent', 'device_library.json')

# AL 档案 → MC 条目字段映射（MC 单文件数组格式）
_MC_FIELDS = ('id', 'vendor', 'model', 'port_count', 'port_speed', 'port_type',
              'protocol', 'applicable_networks', 'description', 'recommended_network')


def _protocol_of(al_dev: dict) -> str:
    """按家族推断 MC protocol 字段（小写）。AL 档案无显式 protocol。"""
    did = (al_dev.get('id') or '')
    desc = (al_dev.get('description') or '') + ' ' + ' '.join(al_dev.get('tags') or [])
    if 'InfiniBand' in desc or did.endswith('_ib') or 'IB' in desc:
        return 'ib'
    return 'roce'


def _to_mc_entry(al_dev: dict) -> dict:
    entry = {}
    for f in _MC_FIELDS:
        if f == 'protocol':
            entry[f] = _protocol_of(al_dev)
        elif f == 'applicable_networks':
            entry[f] = list(al_dev.get(f, ['param']))
        elif f == 'recommended_network':
            entry[f] = list(al_dev.get(f, []))
        elif f == 'description':
            entry[f] = al_dev.get(f, '')
        else:
            entry[f] = al_dev.get(f)
    return entry


def load_al_devices(index_path=AL_INDEX):
    with open(index_path, encoding='utf-8') as f:
        index = json.load(f)
    base = os.path.dirname(index_path)
    out = {}
    for cat in index.get('categories', []):
        directory = cat.get('directory') or cat.get('id', '')
        for did in cat.get('device_ids', []):
            path = os.path.join(base, directory, f'{did}.json')
            if not os.path.isfile(path):
                continue
            with open(path, encoding='utf-8') as f2:
                dev = json.load(f2)
            out[did] = dev
    return out


def load_mc_devices(mc_path):
    with open(mc_path, encoding='utf-8') as f:
        data = json.load(f)
    return {d.get('id'): d for d in data if isinstance(d, dict) and d.get('id')}, data


def reconcile(al_devices, mc_devices, mc_path, sync=False):
    problems = []
    # 1. MC-only
    for did in sorted(set(mc_devices) - set(al_devices)):
        problems.append(f'MC-only（AL 无权威来源）: {did}')
    # 2. 共有型号字段一致性
    for did in sorted(set(mc_devices) & set(al_devices)):
        m, a = mc_devices[did], al_devices[did]
        for f in ('port_count', 'port_speed', 'vendor'):
            mv, av = m.get(f), a.get(f)
            if mv is not None and av is not None and str(mv) != str(av):
                problems.append(f'字段漂移 {did}.{f}: MC={mv} AL={av}')
    # 3. 6 场景关键型号（--sync 后重新评估）
    missing = [k for k in KEY_MODELS if k not in mc_devices]
    for k in missing:
        problems.append(f'关键型号缺失（6 场景依赖）: {k}')
    return problems


def sync_key_models(al_devices, mc_data, mc_path):
    existing = {d.get('id') for d in mc_data if isinstance(d, dict)}
    added = []
    for k in KEY_MODELS:
        if k in existing or k not in al_devices:
            continue
        mc_data.append(_to_mc_entry(al_devices[k]))
        added.append(k)
    if added:
        with open(mc_path, 'w', encoding='utf-8') as f:
            json.dump(mc_data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'--sync: 已从 AL 拷贝 {len(added)} 个关键型号 → MC: {", ".join(added)}')
    else:
        print('--sync: 无新增（关键型号已在 MC 或 AL 缺失）')
    return added


def main():
    ap = argparse.ArgumentParser(description='AL↔MC 设备库对账')
    ap.add_argument('--sync', action='store_true', help='先按 6 场景清单从 AL 拷贝到 MC')
    ap.add_argument('--mc-path', default=DEFAULT_MC)
    ap.add_argument('--al-index', default=AL_INDEX)
    args = ap.parse_args()

    al = load_al_devices(args.al_index)
    mc_map, mc_data = load_mc_devices(args.mc_path)
    print(f'AL 权威设备数: {len(al)}；MC 设备数: {len(mc_map)}')

    if args.sync:
        sync_key_models(al, mc_data, args.mc_path)
        mc_map, mc_data = load_mc_devices(args.mc_path)

    problems = reconcile(al, mc_map, args.mc_path, sync=args.sync)
    if problems:
        print(f'对账未通过（{len(problems)} 项）：')
        for p in problems:
            print(f'  - {p}')
        sys.exit(1)
    print('AL↔MC 设备库对账通过：无 MC-only、无字段漂移、6 场景关键型号齐备')


if __name__ == '__main__':
    main()
