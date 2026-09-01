"""4.0.0-F0-2 / 40-d：版本单源（sync_version.py / check_version.py）单元测试

覆盖测试计划 G-6（双端版本单源，AL 侧）：
  - 单源读取/规范化（v 前缀）
  - 一致性收集（version.json / package.json / package-lock.json / VERSION）
  - sync 把单源写入全部派生文件
  - check 检出漂移（任一派生文件改版即失败，退出码 1）
  - --set 更新单源并同步派生文件
  - 非法版本号拒绝（退出码 1）
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
from sync_version import (  # noqa: E402
    collect_versions,
    is_valid_version,
    main as sync_main,
    normalize_version,
    read_single_source,
    run_check,
    sync,
)

VERSION = '3.7.7'


@pytest.fixture
def repo(tmp_path):
    """构造最小版本单源仓库（含全部派生文件，初始一致）。"""
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'version.json').write_text(json.dumps({'version': VERSION}, indent=2) + '\n', encoding='utf-8')
    (root / 'package.json').write_text(
        json.dumps({'name': 'autolink', 'version': VERSION}, indent=2) + '\n', encoding='utf-8')
    lock = {'name': 'autolink', 'version': VERSION, 'lockfileVersion': 3,
            'packages': {'': {'name': 'autolink', 'version': VERSION}}}
    (root / 'package-lock.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    (root / 'VERSION').write_text(VERSION + '\n', encoding='utf-8')
    return root


def _set_pkg_version(root, ver):
    pkg = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    pkg['version'] = ver
    (root / 'package.json').write_text(json.dumps(pkg, indent=2) + '\n', encoding='utf-8')


# ---------------------------------------------------------------
# 规范化 / 合法性
# ---------------------------------------------------------------

def test_normalize_version():
    assert normalize_version('v3.7.7') == '3.7.7'
    assert normalize_version('V1.2.3') == '1.2.3'
    assert normalize_version(' 4.0.0 ') == '4.0.0'
    assert normalize_version('4.0.0-rc.1') == '4.0.0-rc.1'


def test_is_valid_version():
    assert is_valid_version('3.7.7')
    assert is_valid_version('4.0.0')
    assert is_valid_version('4.0.0-rc.1')
    assert not is_valid_version('abc')
    assert not is_valid_version('3.7')
    assert not is_valid_version('')


# ---------------------------------------------------------------
# 单源读取
# ---------------------------------------------------------------

def test_read_single_source(repo):
    assert read_single_source(str(repo)) == VERSION


def test_read_single_source_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        read_single_source(str(tmp_path / 'nope'))


def test_collect_versions_all_match(repo):
    entries = collect_versions(str(repo))
    labels = [label for label, _, _ in entries]
    assert labels == ['version.json', 'package.json', 'package-lock.json(顶层)',
                      'package-lock.json(packages[""])', 'VERSION']
    versions = {ver for _, _, ver in entries}
    assert versions == {VERSION}


# ---------------------------------------------------------------
# 一致性校验（check）
# ---------------------------------------------------------------

def test_run_check_pass(repo, capsys):
    assert run_check(str(repo)) == 0
    out = capsys.readouterr().out
    assert 'PASS' in out


def test_run_check_fail_on_package_drift(repo, capsys):
    _set_pkg_version(repo, '4.0.0')
    assert run_check(str(repo)) == 1
    out = capsys.readouterr().out
    assert 'FAIL' in out and 'package.json' in out


def test_run_check_fail_on_lock_drift(repo, capsys):
    lock_path = repo / 'package-lock.json'
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    lock['packages']['']['version'] = '3.6.3'
    lock_path.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    assert run_check(str(repo)) == 1
    out = capsys.readouterr().out
    assert 'package-lock.json' in out


def test_run_check_fail_on_version_file_drift(repo, capsys):
    (repo / 'VERSION').write_text('3.6.3\n', encoding='utf-8')
    assert run_check(str(repo)) == 1
    out = capsys.readouterr().out
    assert 'VERSION' in out


# ---------------------------------------------------------------
# 同步（sync）
# ---------------------------------------------------------------

def test_sync_writes_all_derived(repo):
    _set_pkg_version(repo, '3.6.3')
    (repo / 'package-lock.json').write_text(
        json.dumps({'version': '3.6.3', 'packages': {'': {'version': '3.6.3'}}}, indent=2) + '\n',
        encoding='utf-8')
    (repo / 'VERSION').write_text('3.6.3\n', encoding='utf-8')

    assert sync(str(repo)) == VERSION

    pkg = json.loads((repo / 'package.json').read_text(encoding='utf-8'))
    assert pkg['version'] == VERSION
    lock = json.loads((repo / 'package-lock.json').read_text(encoding='utf-8'))
    assert lock['version'] == VERSION
    assert lock['packages']['']['version'] == VERSION
    assert (repo / 'VERSION').read_text(encoding='utf-8').strip() == VERSION
    # 同步后再次校验应通过
    assert run_check(str(repo)) == 0


# ---------------------------------------------------------------
# CLI（--set / --check / 非法版本）
# ---------------------------------------------------------------

def test_set_version_updates_single_source_and_syncs(repo, capsys):
    assert sync_main(['--set', '4.0.0', '--root', str(repo)]) == 0
    assert json.loads((repo / 'version.json').read_text(encoding='utf-8'))['version'] == '4.0.0'
    assert json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version'] == '4.0.0'
    lock = json.loads((repo / 'package-lock.json').read_text(encoding='utf-8'))
    assert lock['version'] == '4.0.0'
    assert lock['packages']['']['version'] == '4.0.0'
    assert (repo / 'VERSION').read_text(encoding='utf-8').strip() == '4.0.0'


def test_set_invalid_version_rejected(repo, capsys):
    assert sync_main(['--set', 'abc', '--root', str(repo)]) == 1
    assert json.loads((repo / 'version.json').read_text(encoding='utf-8'))['version'] == VERSION


def test_check_cli(repo, capsys):
    assert sync_main(['--check', '--root', str(repo)]) == 0
    _set_pkg_version(repo, '9.9.9')
    assert sync_main(['--check', '--root', str(repo)]) == 1
