"""4.0.0-F0-2 / 40-d：Release 说明抽取（extract_release_notes.py）单测

覆盖 G-6（双端版本单源）中 AL 侧发布说明抽取：
  - 段落提取（含 v 前缀 / 边界不泄漏 / 缺失报错 / 空段落报错）
  - 版本号默认取 version.json 单源（F0-2：从单源读取而非仅 CHANGELOG）
  - 显式版本与单源一致性校验（防错版发布）
  - --allow-mismatch 放行历史段落抽取
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
from extract_release_notes import (  # noqa: E402
    extract_release_notes,
    main as notes_main,
    read_single_source_version,
)

SAMPLE = """# CHANGELOG

## [3.7.7] - 2026-08-29

### 示例段落

- 条目 A
- 条目 B

## [3.6.3] - 2026-08-25

### 旧版

- 旧条目
"""


@pytest.fixture
def changelog(tmp_path):
    path = tmp_path / 'CHANGELOG.md'
    path.write_text(SAMPLE, encoding='utf-8')
    return str(path)


@pytest.fixture
def repo(tmp_path):
    """带 version.json 单源 + CHANGELOG 的最小仓库。"""
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'version.json').write_text(json.dumps({'version': '3.7.7'}) + '\n', encoding='utf-8')
    (root / 'CHANGELOG.md').write_text(SAMPLE, encoding='utf-8')
    return root


# ---------------------------------------------------------------
# 段落提取
# ---------------------------------------------------------------

def test_extract_section(changelog):
    body = extract_release_notes('3.7.7', changelog)
    assert '示例段落' in body
    assert '条目 A' in body and '条目 B' in body
    assert '3.7.7' not in body  # 标题行被去掉


def test_extract_with_v_prefix(changelog):
    body = extract_release_notes('v3.7.7', changelog)
    assert '条目 A' in body


def test_extract_no_boundary_leak(changelog):
    body = extract_release_notes('3.7.7', changelog)
    assert '旧条目' not in body  # 不泄漏到下一个版本段落


def test_extract_version_not_found(changelog):
    with pytest.raises(LookupError):
        extract_release_notes('9.9.9', changelog)


def test_extract_empty_section(tmp_path):
    path = tmp_path / 'CHANGELOG.md'
    path.write_text('# CHANGELOG\n\n## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-12-01\n', encoding='utf-8')
    with pytest.raises(LookupError):
        extract_release_notes('1.0.0', str(path))


# ---------------------------------------------------------------
# 单源版本读取
# ---------------------------------------------------------------

def test_read_single_source_version(repo):
    assert read_single_source_version(str(repo)) == '3.7.7'


def test_read_single_source_missing(tmp_path):
    with pytest.raises(LookupError):
        read_single_source_version(str(tmp_path))


# ---------------------------------------------------------------
# CLI：单源默认 / 一致性校验 / --allow-mismatch
# ---------------------------------------------------------------

def test_default_version_from_single_source(repo, capsys):
    """未传版本号时，默认取 version.json 单源并抽取对应段落。"""
    assert notes_main(['--root', str(repo)]) == 0
    out = capsys.readouterr().out
    assert '条目 A' in out


def test_explicit_version_matches_single_source(repo, capsys):
    assert notes_main(['v3.7.7', '--root', str(repo)]) == 0
    assert '条目 A' in capsys.readouterr().out


def test_explicit_version_mismatch_rejected(repo, capsys):
    """显式版本与单源不一致时阻止（防错版发布）。"""
    assert notes_main(['v3.6.3', '--root', str(repo)]) == 1
    err = capsys.readouterr().err
    assert '不一致' in err and '--allow-mismatch' in err


def test_allow_mismatch_for_historical(repo, capsys):
    assert notes_main(['--allow-mismatch', 'v3.6.3', '--root', str(repo)]) == 0
    assert '旧条目' in capsys.readouterr().out


def test_cli_not_found_exit_1(repo, capsys):
    (repo / 'version.json').write_text(json.dumps({'version': '9.9.9'}) + '\n', encoding='utf-8')
    assert notes_main(['--allow-mismatch', '9.9.9', '--root', str(repo)]) == 1
    err = capsys.readouterr().err
    assert '未找到' in err
