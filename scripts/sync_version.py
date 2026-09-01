"""AutoLink 版本单源同步/校验工具（4.0.0-F0-2 / 40-d）

以 version.json 为唯一版本事实源（single source of truth），生成/校验派生文件：
  - package.json       —— version 字段（electron-builder / electron-updater 读取）
  - package-lock.json  —— 顶层 version + packages[""].version
  - VERSION            —— 纯文本版本号（兼容历史读取方）

用法：
  python scripts/sync_version.py               # 同步：version.json → 派生文件
  python scripts/sync_version.py --check       # 校验：所有版本一致（不一致退出码 1）
  python scripts/sync_version.py --set 4.0.0   # 更新单源版本号并同步派生文件
  python scripts/check_version.py              # 等价 sync_version.py --check（CI 门禁）

退出码：0 = 成功/一致；1 = 不一致/异常（供 CI 门禁）。
"""
import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 版本号形状：x.y.z（可选 -预发布 / +build 元数据），对齐 semver 主干
_VERSION_RE = re.compile(r'^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$')


def normalize_version(v):
    """去首尾空白 + 去 v/V 前缀后返回（仅规范化，不改语义）。"""
    return str(v).strip().lstrip('vV')


def is_valid_version(v):
    return bool(_VERSION_RE.match(normalize_version(v)))


def _read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def single_source_path(root=None):
    return os.path.join(root or REPO_ROOT, 'version.json')


def read_single_source(root=None):
    """读取 version.json 单源版本号（规范化，无 v 前缀）。"""
    path = single_source_path(root)
    if not os.path.exists(path):
        raise FileNotFoundError(f'版本单源文件不存在: {path}')
    data = _read_json(path)
    version = data.get('version')
    if not version:
        raise ValueError(f'版本单源缺少 version 字段: {path}')
    return normalize_version(version)


def collect_versions(root=None):
    """收集全部版本来源为 [(label, file_path, version)]，首项为单源。"""
    root = root or REPO_ROOT
    entries = [
        ('version.json', single_source_path(root), read_single_source(root)),
        ('package.json', os.path.join(root, 'package.json'),
         normalize_version(_read_json(os.path.join(root, 'package.json')).get('version', ''))),
    ]
    lock_path = os.path.join(root, 'package-lock.json')
    lock = _read_json(lock_path)
    entries.append(('package-lock.json(顶层)', lock_path,
                    normalize_version(lock.get('version', ''))))
    entries.append(('package-lock.json(packages[""])', lock_path,
                    normalize_version(lock.get('packages', {}).get('', {}).get('version', ''))))
    version_file = os.path.join(root, 'VERSION')
    with open(version_file, 'r', encoding='utf-8') as f:
        entries.append(('VERSION', version_file, normalize_version(f.read())))
    return entries


def run_check(root=None):
    """校验所有派生版本与单源一致；一致返回 0，否则返回 1。"""
    entries = collect_versions(root)
    single = entries[0][2]
    problems = []
    for label, path, version in entries[1:]:
        if version != single:
            problems.append(f'  {label}: {version!r} != 单源 {single!r}（{path}）')
    if problems:
        print(f'FAIL: 版本不一致（单源 version.json = {single}）')
        for p in problems:
            print(p)
        return 1
    print(f'PASS: 版本一致（version.json = package.json = package-lock.json = VERSION = {single}）')
    return 0


def sync(root=None):
    """把单源版本号写入全部派生文件，返回版本号。"""
    root = root or REPO_ROOT
    version = read_single_source(root)

    pkg_path = os.path.join(root, 'package.json')
    pkg = _read_json(pkg_path)
    pkg['version'] = version
    _write_json(pkg_path, pkg)

    lock_path = os.path.join(root, 'package-lock.json')
    lock = _read_json(lock_path)
    lock['version'] = version
    if '' in lock.get('packages', {}):
        lock['packages']['']['version'] = version
    _write_json(lock_path, lock)

    # VERSION 为纯文本版本号；显式 LF + 尾换行（与仓库 .gitattributes text=auto/LF 约定一致）
    with open(os.path.join(root, 'VERSION'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(version + '\n')
    return version


def set_version(version, root=None):
    """更新单源版本号并同步派生文件；返回退出码。"""
    if not is_valid_version(version):
        print(f'错误: 非法版本号 {version!r}（需形如 x.y.z，可带 -pre/+build 后缀）', file=sys.stderr)
        return 1
    version = normalize_version(version)
    _write_json(single_source_path(root), {'version': version})
    sync(root)
    print(f'set: version.json = {version}（package.json / package-lock.json / VERSION 已同步）')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='AutoLink 版本单源同步/校验（version.json）')
    parser.add_argument('--check', action='store_true', help='仅校验一致性，不写文件')
    parser.add_argument('--set', metavar='VER', help='更新单源版本号并同步派生文件')
    parser.add_argument('--root', metavar='DIR', default=None, help='仓库根目录（默认自动探测，测试用）')
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root) if args.root else REPO_ROOT
    try:
        if args.set:
            return set_version(args.set, root)
        if args.check:
            return run_check(root)
        version = sync(root)
        print(f'synced: version.json = {version}（package.json / package-lock.json / VERSION 已同步）')
        return 0
    except (FileNotFoundError, ValueError, KeyError) as e:
        print(f'错误: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
