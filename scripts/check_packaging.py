"""AutoLink 打包/发布配置校验（4.7.0-47-e，部署运维/安装升级体验）

校验 electron-builder 配置满足"三平台离线安装包 + GitHub 发布生成 latest.yml + 产物命名含版本"：
  1. build.publish 配置 GitHub（electron-updater 据此生成 latest.yml / latest-mac.yml / latest-linux.yml）
  2. win/mac/linux 均声明 artifactName 且包含 ${version}（latest.yml 的 path 字段据此解析下载文件名）
  3. 目标均为离线安装包（win=nsis, mac=dmg, linux=AppImage/deb），安装不依赖网络
  4. build.files 覆盖 dist/ 与 dist-electron/（渲染层 + 主进程）

仅用 Python 标准库（同 check_version.py，无需 npm ci / pip install）。

用法：
  python scripts/check_packaging.py
退出码：0 = 通过；1 = 存在配置问题/异常（CI 失败）。
"""
import json
import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE_JSON = os.path.join(REPO_ROOT, 'package.json')


def validate_build_config(pkg: Dict[str, Any]) -> List[str]:
    """校验 package.json 的 electron-builder 配置，返回问题列表（空 = 通过）"""
    issues: List[str] = []
    build = pkg.get('build') or {}
    if not build:
        issues.append('缺少 build 配置（electron-builder）')
        return issues

    # 1. GitHub publish（生成 latest.yml 的前提）
    publish = build.get('publish') or []
    if isinstance(publish, dict):
        publish = [publish]
    providers = [p.get('provider') for p in publish if isinstance(p, dict)]
    if 'github' not in providers:
        issues.append('build.publish 未配置 provider=github（electron-updater 无法生成 latest.yml）')
    gh = next((p for p in publish if isinstance(p, dict) and p.get('provider') == 'github'), None)
    if gh and (not gh.get('owner') or not gh.get('repo')):
        issues.append('build.publish github 缺少 owner/repo')

    # 2. 各平台 artifactName（含版本变量）
    for plat, key in [('win', 'win'), ('mac', 'mac'), ('linux', 'linux')]:
        cfg = build.get(plat) or {}
        artifact = cfg.get('artifactName')
        if not artifact:
            issues.append(f'build.{plat}.artifactName 未声明（latest.yml 无法解析下载文件名）')
        elif '${version}' not in artifact:
            issues.append(f'build.{plat}.artifactName 缺少 ${{version}} 变量')

    # 3. 离线安装包目标
    win_targets = _target_names((build.get('win') or {}).get('target'))
    if 'nsis' not in win_targets:
        issues.append('build.win.target 缺少 nsis（离线安装包）')
    mac_targets = _target_names((build.get('mac') or {}).get('target'))
    if 'dmg' not in mac_targets:
        issues.append('build.mac.target 缺少 dmg（离线安装包）')
    linux_targets = _target_names((build.get('linux') or {}).get('target'))
    if not (linux_targets & {'AppImage', 'deb'}):
        issues.append('build.linux.target 缺少 AppImage/deb（离线安装包）')

    # 4. files 覆盖渲染层 + 主进程
    files = build.get('files') or []
    joined = ' '.join(str(f) for f in files)
    if 'dist/**/*' not in joined or 'dist-electron/**/*' not in joined:
        issues.append('build.files 未同时覆盖 dist/**/* 与 dist-electron/**/*')

    return issues


def _target_names(target: Any) -> set:
    if not target:
        return set()
    if isinstance(target, str):
        return {target}
    if isinstance(target, list):
        names = set()
        for t in target:
            if isinstance(t, str):
                names.add(t)
            elif isinstance(t, dict) and t.get('target'):
                names.add(str(t['target']))
        return names
    return set()


def run_check() -> int:
    """读取 package.json 并校验，打印问题；0 = 通过，1 = 失败"""
    try:
        with open(PACKAGE_JSON, 'r', encoding='utf-8') as f:
            pkg = json.load(f)
    except Exception as exc:  # noqa: BLE001
        print(f'[check_packaging] 读取 package.json 失败: {exc}')
        return 1

    issues = validate_build_config(pkg)
    if issues:
        print('[check_packaging] 打包/发布配置存在问题:')
        for i in issues:
            print(f'  - {i}')
        return 1
    print('[check_packaging] 打包/发布配置通过（GitHub latest.yml + 三平台离线安装包 + 版本化 artifactName）')
    return 0


if __name__ == '__main__':
    sys.exit(run_check())
