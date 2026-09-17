"""5.2.2 · `export` 契约（AL-E4 / AL-E5，T1.9 / T1.10）

覆盖点：
  - **AL-E5**：缺省 `outputTypes` = 全部可用类型（旧为空 → 静默 no-op）
  - **AL-E5**：空结果 / 未知类型 → 结构化错误码，退出码非零，且**不建空批次目录**
  - **AL-E4**：同配置指纹二次导出 → `reused: true`，**不新增**批次目录
  - **AL-E4**：`--no-archive` 无副作用模式 → 工作区不新增批次目录
  - **AL-E4**：`--regenerate` 可强制重算
"""
from __future__ import annotations

import json
import os

import pytest

from cli import main, EXIT_OK, EXIT_EXEC, EXIT_USAGE
from engine import (EXPORT_TYPES, _resolve_output_types, _find_reusable_batch,
                    _config_hash, handle_export, handle_design, SCHEMA_VERSION)


def _run(argv, monkeypatch, capsys, audit_path):
    import builtins
    monkeypatch.setenv('AUTOLINK_AUDIT_PATH', str(audit_path))
    orig = builtins.print
    try:
        try:
            rc = main(list(argv))
        except SystemExit as e:
            rc = e.code if e.code is not None else 0
    finally:
        builtins.print = orig
    out, err = capsys.readouterr()
    return rc, out, err


def _cfg(tmp_path, name='project_config.json'):
    from project_config import create_default_config
    cfg = create_default_config('导出测试')
    cfg['topology']['num_gpu_servers'] = 8
    cfg['topology']['num_all_flash_storage'] = 1
    cfg['topology']['num_hybrid_flash_storage'] = 0
    cfg['topology']['num_compute_servers'] = 2
    cfg['networks']['biz_network'] = False
    cfg['networks']['oob_network'] = False
    p = tmp_path / name
    p.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')
    return str(p)


# ================================================================
#  纯函数层
# ================================================================

class TestResolveOutputTypes:
    def test_default_is_all(self):
        assert _resolve_output_types({}) == list(EXPORT_TYPES)

    def test_empty_list_is_all(self):
        assert _resolve_output_types({'outputTypes': []}) == list(EXPORT_TYPES)

    def test_all_keyword(self):
        assert _resolve_output_types({'outputTypes': 'all'}) == list(EXPORT_TYPES)
        assert _resolve_output_types({'outputTypes': ['*']}) == list(EXPORT_TYPES)

    def test_comma_string(self):
        assert _resolve_output_types({'outputTypes': 'bom,reportData'}) == ['bom', 'reportData']

    def test_explicit_list_kept(self):
        assert _resolve_output_types({'outputTypes': ['bom']}) == ['bom']


class TestUnknownType:
    def test_unknown_type_rejected(self, tmp_path):
        r = handle_export({'configFile': _cfg(tmp_path), 'outputTypes': ['nope']})
        assert r['success'] is False
        assert r['error_code'] == 'AL_ERR_INVALID_ARGS'
        assert 'nope' in r['error']


# ================================================================
#  指纹复用 / no-archive（AL-E4）
# ================================================================

class TestReuseAndNoArchive:
    def test_report_data_only_creates_no_batch(self, tmp_path):
        """纯数据导出不落盘 → 不建批次目录（旧实现无条件创建）"""
        out_dir = tmp_path / 'output'
        r = handle_export({'configFile': _cfg(tmp_path), 'outputDir': str(out_dir),
                           'outputTypes': ['reportData']})
        assert r.get('success', True) is not False
        assert r['archived'] is False
        assert r['reused'] is False
        assert any(x['type'] == 'reportData' and x['status'] == 'success' for x in r['results'])
        # 允许 output 目录存在，但不得出现 v<N>_ 批次目录
        if out_dir.exists():
            assert not [d for d in os.listdir(out_dir) if d.startswith('v') and '_' in d]

    def test_second_export_reuses_batch(self, tmp_path):
        """同配置二次导出命中指纹复用，且不新增批次目录"""
        out_dir = tmp_path / 'output'
        cfg = _cfg(tmp_path)
        r1 = handle_export({'configFile': cfg, 'outputDir': str(out_dir),
                            'outputTypes': ['bom']})
        assert r1['reused'] is False
        assert r1['archived'] is True
        first_batch = r1['batchName']
        batches = sorted(os.listdir(out_dir))
        assert first_batch in batches

        r2 = handle_export({'configFile': cfg, 'outputDir': str(out_dir),
                            'outputTypes': ['bom']})
        assert r2['reused'] is True
        assert r2['batchName'] == first_batch
        assert sorted(os.listdir(out_dir)) == batches  # 未新增目录

    def test_regenerate_forces_recompute(self, tmp_path):
        out_dir = tmp_path / 'output'
        cfg = _cfg(tmp_path)
        handle_export({'configFile': cfg, 'outputDir': str(out_dir), 'outputTypes': ['bom']})
        before = sorted(os.listdir(out_dir))
        r = handle_export({'configFile': cfg, 'outputDir': str(out_dir),
                           'outputTypes': ['bom'], 'regenerate': True})
        assert r['reused'] is False
        assert len(sorted(os.listdir(out_dir))) == len(before) + 1  # 新增一个批次

    def test_no_archive_creates_no_batch(self, tmp_path):
        """--no-archive：产物直接落 outputDir，不建批次目录、不写 manifest"""
        out_dir = tmp_path / 'output'
        r = handle_export({'configFile': _cfg(tmp_path), 'outputDir': str(out_dir),
                           'outputTypes': ['bom'], 'noArchive': True})
        assert r['archived'] is False
        assert r['batchName'] is None
        names = os.listdir(out_dir)
        assert not [n for n in names if n.startswith('v') and '_' in n]
        assert 'manifest.json' not in names

    def test_find_reusable_batch_requires_config_match(self, tmp_path):
        out_dir = tmp_path / 'output'
        cfg = _cfg(tmp_path)
        handle_export({'configFile': cfg, 'outputDir': str(out_dir), 'outputTypes': ['bom']})
        assert _find_reusable_batch(str(out_dir), _config_hash(cfg), ['bom']) is not None
        assert _find_reusable_batch(str(out_dir), 'deadbeefdeadbeef', ['bom']) is None
        # 请求了未产出的类型 → 不可复用
        assert _find_reusable_batch(str(out_dir), _config_hash(cfg), ['pdfReport']) is None


# ================================================================
#  CLI 层退出码（AL-E5 空结果非零）
# ================================================================

class TestExportCLI:
    def test_cli_default_exports_all_types(self, monkeypatch, capsys, tmp_path):
        """不传 --output-types → 全部类型（退出码 0，results 非空）"""
        out_dir = tmp_path / 'output'
        rc, out, err = _run(['export', 'run', '--config', _cfg(tmp_path),
                             '--output-dir', str(out_dir)],
                            monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == EXIT_OK, err
        data = json.loads(out)
        assert data['results']
        assert {r['type'] for r in data['results']} == set(EXPORT_TYPES)

    def test_cli_unknown_type_exit_2(self, monkeypatch, capsys, tmp_path):
        rc, out, err = _run(['export', 'run', '--config', _cfg(tmp_path),
                             '--output-dir', str(tmp_path / 'output'),
                             '--output-types', 'nope'],
                            monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == EXIT_USAGE
        assert json.loads(out)['error_code'] == 'AL_ERR_INVALID_ARGS'

    def test_cli_no_archive_flag(self, monkeypatch, capsys, tmp_path):
        out_dir = tmp_path / 'output'
        rc, out, err = _run(['export', 'run', '--config', _cfg(tmp_path),
                             '--output-dir', str(out_dir),
                             '--output-types', 'bom', '--no-archive'],
                            monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == EXIT_OK, err
        assert json.loads(out)['archived'] is False
        assert not [n for n in os.listdir(out_dir) if n.startswith('v') and '_' in n]


# ================================================================
#  AL-E3：机器契约 schema_version + 英文规范子树
# ================================================================

def _report_data(tmp_path):
    from designer import NetworkDesignerV2
    from exporter import generate_report_data
    return generate_report_data(NetworkDesignerV2(_cfg(tmp_path)))


def _has_chinese_key(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if any('\u4e00' <= c <= '\u9fff' for c in str(k)):
                return True
            if _has_chinese_key(v):
                return True
    elif isinstance(obj, list):
        return any(_has_chinese_key(v) for v in obj[:5])
    return False


class TestSchemaVersion:
    def test_report_data_has_schema_version(self, tmp_path):
        r = _report_data(tmp_path)
        assert r['schema_version'] == 2

    def test_report_data_canonical_subtree_is_english(self, tmp_path):
        """data 子树为机器契约：全英文 snake_case，不得残留中文键"""
        r = _report_data(tmp_path)
        assert 'data' in r
        assert not _has_chinese_key(r['data'])
        assert 'project_name' in r['data']['overview']

    def test_report_data_legacy_subtree_preserved(self, tmp_path):
        """legacy_data 保留中文键（渲染/展示层兼容），且与顶层段同源"""
        r = _report_data(tmp_path)
        assert 'legacy_data' in r
        assert '项目名称' in r['legacy_data']['overview']
        assert r['legacy_data']['overview'] is r['overview']  # 共享引用，不深拷贝
        assert r['deprecations']['legacy_data']

    def test_design_output_has_schema_version(self, tmp_path):
        r = handle_design({'configFile': _cfg(tmp_path)})
        assert r.get('schema_version') == SCHEMA_VERSION

    def test_export_output_has_schema_version(self, tmp_path):
        r = handle_export({'configFile': _cfg(tmp_path),
                           'outputDir': str(tmp_path / 'output'),
                           'outputTypes': ['reportData']})
        assert r.get('schema_version') == SCHEMA_VERSION
