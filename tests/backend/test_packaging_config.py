"""47-e（F7-5）：安装/升级体验——打包/发布配置校验（GitHub latest.yml + 三平台离线安装包 + 版本化 artifactName）

复用 scripts/check_packaging.py 的校验逻辑（单一事实源）。
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts'))

from check_packaging import validate_build_config, _target_names  # noqa: E402


def _load_package():
    with open(os.path.join(REPO_ROOT, 'package.json'), 'r', encoding='utf-8') as f:
        return json.load(f)


def test_publish_github_generates_latest_yml():
    pkg = _load_package()
    issues = validate_build_config(pkg)
    assert not any('publish' in i for i in issues), issues


def test_artifact_name_contains_version_all_platforms():
    pkg = _load_package()
    build = pkg['build']
    for plat in ('win', 'mac', 'linux'):
        artifact = build[plat]['artifactName']
        # latest.yml 的 path 字段据此解析下载文件名，必须含版本 + 平台扩展占位
        assert '${version}' in artifact, f'{plat} artifactName 缺少 ${{version}}'
        assert artifact.endswith('.${ext}'), f'{plat} artifactName 缺少 ${{ext}}'


def test_offline_installer_targets():
    pkg = _load_package()
    build = pkg['build']
    win_targets = _target_names(build['win']['target'])
    assert 'nsis' in win_targets, 'win 缺 nsis 离线安装包'
    mac_targets = _target_names(build['mac']['target'])
    assert 'dmg' in mac_targets, 'mac 缺 dmg 离线安装包'
    linux_targets = _target_names(build['linux']['target'])
    assert linux_targets & {'AppImage', 'deb'}, 'linux 缺 AppImage/deb 离线安装包'


def test_files_cover_renderer_and_main():
    pkg = _load_package()
    joined = ' '.join(str(f) for f in pkg['build']['files'])
    assert 'dist/**/*' in joined
    assert 'dist-electron/**/*' in joined


def test_packaging_script_pass_on_current_config():
    """当前 package.json 应通过完整校验（CI 门禁同款逻辑）"""
    pkg = _load_package()
    assert validate_build_config(pkg) == []
