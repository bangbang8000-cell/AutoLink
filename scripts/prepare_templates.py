"""V2.9.4-T2: 批量生成/校验模板 project_config.json

从每个模板目录的 network_config.ini 生成 project_config.json（规模/选型/机柜），
支持按模板语义覆盖 GPU 服务器选型；已存在 JSON 默认不覆盖（--force 覆盖）。

用法:
  python scripts/prepare_templates.py            # 生成缺失的 project_config.json
  python scripts/prepare_templates.py --force    # 重新生成全部
  python scripts/prepare_templates.py --check    # 仅校验，不写文件（dry-run）
"""
import sys
import os
import json
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from migration import ini_to_project_config
from project_config import validate_config
from device_library import get_device_library

BASE = os.path.join(os.path.dirname(__file__), '..', 'template')

# 模板语义 → GPU 服务器选型（INI 无 GPU 型号字段，按模板名/场景人工维护）
GPU_SERVER_BY_TEMPLATE = {
    'H100-100台': 'nvidia_dgx_h100',
    'H100-128台': 'nvidia_dgx_h100',
    'L20-推理-64': 'nvidia_l20_8u',
    'NVL72-单架': 'nvidia_dgx_gb300_nvl72',
    'SuperPOD-256': 'nvidia_dgx_h100',
    'cambricon_mlu_cluster': 'cambricon_mlu590_8u',
    'cloudmatrix_384': 'huawei_atlas_800t_a2',
    'hygon_dcu_cluster': 'hygon_k100_ai',
    'ualink_1_0_1024': 'nvidia_dgx_h100',
    'uec_1_0_cluster': 'nvidia_dgx_b200',
    '中型-512': 'nvidia_dgx_h100',
    '国产-昇腾-256': 'huawei_atlas_800t_a2',
    '大型-1024': 'nvidia_dgx_h100',
    '液冷-H100-256': 'nvidia_dgx_h100',
    '超大-2048': 'nvidia_dgx_h100',
    '空项目': 'nvidia_dgx_h100',
    'DP3Tier-1024': 'nvidia_dgx_b300',
    'GB300-NVL72-三合一': 'nvidia_dgx_gb300_nvl72',
    'cloudmatrix_512': 'huawei_atlas_800t_a2',
}


def discover_templates(base=BASE):
    """自动发现模板目录（含 network_config.ini），排除 device_library/.gitkeep 等"""
    return sorted(
        name for name in os.listdir(base)
        if os.path.isdir(os.path.join(base, name))
        and os.path.exists(os.path.join(base, name, 'network_config.ini'))
    )


def apply_template_gpu(config, tpl_name):
    """按模板语义覆盖 GPU 服务器选型"""
    gpu_id = GPU_SERVER_BY_TEMPLATE.get(tpl_name)
    if gpu_id and config.get('networks', {}).get('param_network'):
        config['device_refs']['gpu_server'] = {'library_id': gpu_id}
    return config


def build_template_config(tpl_name):
    """从 INI 生成模板 JSON 配置（内存，不写盘）"""
    tpl_dir = os.path.join(BASE, tpl_name)
    ini_path = os.path.join(tpl_dir, 'network_config.ini')
    config, warnings = ini_to_project_config(ini_path, project_name=tpl_name)
    if config is None:
        return None, warnings
    apply_template_gpu(config, tpl_name)
    return config, warnings


def validate_config_json(tpl_name):
    """校验模板配置：存在则读现有 JSON，否则内存生成。返回 (status, detail)"""
    tpl_dir = os.path.join(BASE, tpl_name)
    json_path = os.path.join(tpl_dir, 'project_config.json')
    if os.path.exists(json_path):
        try:
            with open(json_path, encoding='utf-8') as f:
                config = json.load(f)
            source = 'existing'
        except json.JSONDecodeError as e:
            return 'error', f'existing: JSON 解析失败: {e}'
    else:
        config, _ = build_template_config(tpl_name)
        source = 'generated'
        if config is None:
            return 'error', 'generated: INI 迁移失败'

    err = validate_config(config)
    if err:
        return 'error', f'{source}: validate_config: {err}'

    lib = get_device_library()
    missing = [k for k, ref in config.get('device_refs', {}).items() if lib.resolve_ref(ref) is None]
    if missing:
        return 'error', f'{source}: device_refs 无法解析: {missing}'

    return 'ok', f'{source}: OK'


def write_template_json(tpl_name, force=False):
    """生成并写入 project_config.json（已存在且非 force 时跳过）"""
    tpl_dir = os.path.join(BASE, tpl_name)
    json_path = os.path.join(tpl_dir, 'project_config.json')
    if os.path.exists(json_path) and not force:
        return 'skip', json_path, ['project_config.json 已存在（--force 覆盖）']

    config, warnings = build_template_config(tpl_name)
    if config is None:
        return 'error', json_path, warnings

    err = validate_config(config)
    if err:
        return 'error', json_path, [f'validate_config: {err}']

    lib = get_device_library()
    missing = [k for k, ref in config.get('device_refs', {}).items() if lib.resolve_ref(ref) is None]
    if missing:
        return 'error', json_path, [f'device_refs 无法解析: {missing}']

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return 'ok', json_path, warnings


def main():
    parser = argparse.ArgumentParser(description='生成/校验模板 project_config.json')
    parser.add_argument('--force', action='store_true', help='覆盖已存在的 project_config.json')
    parser.add_argument('--check', action='store_true', help='仅校验（dry-run，不写文件）')
    args = parser.parse_args()

    templates = discover_templates()
    print(f'共发现 {len(templates)} 个模板\n')

    ok = skipped = errors = 0
    for tpl in templates:
        if args.check:
            status, detail = validate_config_json(tpl)
            if status == 'ok':
                ok += 1
                print(f'[OK]   {tpl}: {detail}')
            else:
                errors += 1
                print(f'[FAIL] {tpl}: {detail}')
            continue

        status, json_path, msgs = write_template_json(tpl, force=args.force)
        if status == 'ok':
            ok += 1
            print(f'[OK]   {tpl}: {os.path.relpath(json_path, BASE)}'
                  + (f'  (警告: {"; ".join(msgs)})' if msgs else ''))
        elif status == 'skip':
            skipped += 1
            print(f'[SKIP] {tpl}: {"; ".join(msgs)}')
        else:
            errors += 1
            print(f'[FAIL] {tpl}: {"; ".join(msgs)}')

    print(f'\n结果: OK={ok}, SKIP={skipped}, FAIL={errors} / {len(templates)}')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
