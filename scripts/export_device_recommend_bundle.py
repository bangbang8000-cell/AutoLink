"""MC 5.2.1（522-a）：从 AL 设备库导出推荐字段 bundle（MC 同步用）。

输出 JSON bundle（schema=al.device-recommend/1），供 MC import_device_recommend 灌入
recommended_scenario/recommended_network 字段（MC 端无这些字段的设备自动补齐）。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))

from device_library import get_device_library  # noqa: E402


def main(out_path: str) -> None:
    lib = get_device_library()
    devices = lib.get_all()
    bundle = {
        'schema': 'al.device-recommend/1',
        'kind': 'device-recommend',
        'count': len(devices),
        'devices': [],
    }
    for d in devices:
        rec = {}
        if getattr(d, 'recommended_scenario', None):
            rec['recommended_scenario'] = list(d.recommended_scenario)
        if getattr(d, 'recommended_network', None):
            rec['recommended_network'] = list(d.recommended_network)
        if rec:
            bundle['devices'].append({'id': d.id, **rec})
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
    print(f'exported {len(bundle["devices"])} recommendations -> {out_path}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'device_recommend_bundle.json')
