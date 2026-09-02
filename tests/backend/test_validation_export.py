"""4.5 D-2 导出数据核对测试（F5-2：渲染批次产物 vs 设计/规划漂移）"""
import json

import pytest

from validation_engine import check_export_batch, collect_batch_stats


def _write_xlsx(path, rows):
    """写入一个 xlsx：首行为表头 + rows 条数据行"""
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(['A端设备', 'A端接口', 'Z端设备'])
    for r in rows:
        ws.append(list(r))
    wb.save(path)
    return path


def _manifest(servers=64, param_leaves=8, param_spines=2, mode='full'):
    return {
        'schema_version': 1,
        'project': 'P1',
        'version': 1,
        'config_hash': 'abc',
        'downlink_mode': mode,
        'output_types': ['connections', 'deviceList', 'bom'],
        'results': [{'type': 'connections', 'status': 'success'}],
        'stats': {
            'servers': servers,
            'param_leaves': param_leaves,
            'param_spines': param_spines,
            'param_cores': 0,
            'storage_leaves': 0,
            'storage_spines': 0,
            'biz_access': 0,
            'biz_agg': 0,
            'oob_access': 0,
            'oob_agg': 0,
        },
    }


def _design(servers=64, nets=None, connections=None, mode='full'):
    nets = nets or {'param_leaves': 8, 'param_spines': 2}
    return {
        'servers': servers,
        'mode': mode,
        'network_devices': nets,
        'connections': connections or [],
    }


class TestCollectBatchStats:
    def test_nonexistent_dir(self, tmp_path):
        stats = collect_batch_stats(str(tmp_path / 'missing'))
        assert stats['exists'] is False

    def test_reads_manifest_and_mode(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest(mode='full'), ensure_ascii=False), encoding='utf-8')
        _write_xlsx(batch / 'AI智算网络_full模式_1.xlsx', [('a', 'p1', 'b')] * 5)
        stats = collect_batch_stats(str(batch))
        assert stats['has_manifest'] is True
        assert stats['mode'] == 'full'
        assert stats['connection_rows'] == 5

    def test_mode_inferred_from_filename_without_manifest(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        _write_xlsx(batch / '设备清单_custom模式_1.xlsx', [('gpu', 'h3c', 'x')] * 3)
        stats = collect_batch_stats(str(batch))
        assert stats['mode'] == 'custom'
        assert stats['device_list_rows'] == 3


class TestCheckExportBatch:
    def test_missing_dir_e001(self, tmp_path):
        issues = check_export_batch(str(tmp_path / 'missing'))
        assert [i.rule_id for i in issues] == ['E001']
        assert issues[0].severity == 'error'

    def test_missing_manifest_warns_e002(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        _write_xlsx(batch / 'AI智算网络_full模式_1.xlsx', [('a', 'p1', 'b')] * 2)
        issues = check_export_batch(str(batch))
        assert 'E002' in {i.rule_id for i in issues}

    def test_mode_drift_e003(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest(mode='custom')), encoding='utf-8')
        issues = check_export_batch(str(batch), _design(mode='full'))
        e003 = [i for i in issues if i.rule_id == 'E003']
        assert len(e003) == 1
        assert e003[0].severity == 'error'

    def test_manifest_stats_drift_e004(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest(servers=64, param_leaves=8)), encoding='utf-8')
        issues = check_export_batch(str(batch), _design(servers=64, nets={'param_leaves': 16, 'param_spines': 2}))
        e004 = [i for i in issues if i.rule_id == 'E004']
        assert len(e004) == 1
        assert 'param_leaves' in e004[0].location
        assert e004[0].severity == 'error'

    def test_connection_rows_drift_e005(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest()), encoding='utf-8')
        _write_xlsx(batch / 'AI智算网络_full模式_1.xlsx', [('a', 'p1', 'b')] * 3)
        design = _design(connections=[{'source': 'a', 'target': 'b'}] * 5)
        issues = check_export_batch(str(batch), design)
        e005 = [i for i in issues if i.rule_id == 'E005']
        assert len(e005) == 1
        assert e005[0].severity == 'error'

    def test_empty_device_list_e007(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest()), encoding='utf-8')
        _write_xlsx(batch / '设备清单_full模式_1.xlsx', [])  # 仅表头
        issues = check_export_batch(str(batch), _design())
        e007 = [i for i in issues if i.rule_id == 'E007']
        assert len(e007) >= 1

    def test_filename_mode_mismatch_e006(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest(mode='full')), encoding='utf-8')
        _write_xlsx(batch / 'AI智算网络_custom模式_1.xlsx', [('a', 'p1', 'b')])
        issues = check_export_batch(str(batch), _design(mode='full'))
        e006 = [i for i in issues if i.rule_id == 'E006']
        assert len(e006) == 1

    def test_clean_batch_no_error(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        (batch / 'manifest.json').write_text(
            json.dumps(_manifest(servers=64, param_leaves=8, param_spines=2)), encoding='utf-8')
        _write_xlsx(batch / 'AI智算网络_full模式_1.xlsx', [('a', 'p1', 'b')] * 5)
        _write_xlsx(batch / '设备清单_full模式_1.xlsx', [('gpu', 'h3c', 'x')] * 3)
        design = _design(servers=64, nets={'param_leaves': 8, 'param_spines': 2},
                         connections=[{'source': 'a', 'target': 'b'}] * 5)
        issues = check_export_batch(str(batch), design)
        assert not [i for i in issues if i.severity == 'error']


class TestBatchIntegrity:
    """48-e（F8-5）：批次产物完整性——manifest.files 逐文件（缺失/漂移/哈希不符 → E008）"""

    def _sha256(self, path):
        import hashlib
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def _write_manifest_with_files(self, batch, files, extra_actual=()):
        """files: [{name, content}] → 写文件并生成带逐文件清单的 manifest"""
        for f in files:
            (batch / f['name']).write_bytes(f['content'])
        for name in extra_actual:
            (batch / name).write_text('drift', encoding='utf-8')
        (batch / 'manifest.json').write_text(json.dumps({
            'schema_version': 1, 'version': 1, 'config_hash': 'x',
            'output_types': ['connections'], 'results': [],
            'stats': {'servers': 0, 'param_leaves': 0, 'param_spines': 0, 'param_cores': 0,
                      'storage_leaves': 0, 'storage_spines': 0, 'biz_access': 0, 'biz_agg': 0,
                      'oob_access': 0, 'oob_agg': 0},
            'files': [{'name': f['name'], 'size': len(f['content']), 'sha256': self._sha256(batch / f['name'])}
                      for f in files],
        }, ensure_ascii=False), encoding='utf-8')

    def test_intact_batch_no_e008(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        self._write_manifest_with_files(batch, [{'name': 'a.xlsx', 'content': b'AAA'}])
        issues = check_export_batch(str(batch))
        assert not [i for i in issues if i.rule_id == 'E008']

    def test_missing_file_e008(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        files = [{'name': 'a.xlsx', 'content': b'AAA'}, {'name': 'b.xlsx', 'content': b'BBB'}]
        self._write_manifest_with_files(batch, files)
        (batch / 'b.xlsx').unlink()
        issues = check_export_batch(str(batch))
        e008 = [i for i in issues if i.rule_id == 'E008']
        assert any('缺失' in i.message for i in e008)

    def test_hash_mismatch_e008(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        self._write_manifest_with_files(batch, [{'name': 'a.xlsx', 'content': b'AAA'}])
        # 篡改文件内容 → 哈希不符
        (batch / 'a.xlsx').write_bytes(b'BBB')
        issues = check_export_batch(str(batch))
        e008 = [i for i in issues if i.rule_id == 'E008']
        assert any('哈希不符' in i.message for i in e008)

    def test_drift_extra_file_e008(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        self._write_manifest_with_files(batch, [{'name': 'a.xlsx', 'content': b'AAA'}], extra_actual=('extra.txt',))
        issues = check_export_batch(str(batch))
        e008 = [i for i in issues if i.rule_id == 'E008']
        assert any('漂移' in i.message for i in e008)

    def test_check_batch_integrity_returns_problems(self, tmp_path):
        """独立入口：check_batch_integrity 直接校验。"""
        from validation_engine.export_check import check_batch_integrity
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        self._write_manifest_with_files(batch, [{'name': 'a.xlsx', 'content': b'AAA'}])
        (batch / 'a.xlsx').write_bytes(b'ZZZ')
        problems = check_batch_integrity(str(batch))
        assert any(p.rule_id == 'E008' and '哈希不符' in p.message for p in problems)
        assert all(p.rule_id == 'E008' for p in problems)
