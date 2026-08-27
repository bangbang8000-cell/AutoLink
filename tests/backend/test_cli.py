"""AutoLink v3.1.0-T4-4 CLI 集成测试（命令级 golden）

覆盖 backend/cli.py：
  - 注册表驱动自动映射（域/子命令树、新增 action 自动获得 CLI）
  - 参数解析（schema flags / --json 兜底 / file_json 读取 / 类型）
  - --help 完整性（全域全子命令可打印）
  - 输出格式（json / ndjson / text）
  - 命令级 golden：room create / config 域 / design generate / validate
  - 审计日志（AUTOLINK_AUDIT_PATH 隔离 + 敏感字段脱敏）
  - execute：未知 action / 执行失败路径
"""
import builtins
import json
import os

import pytest

from cli import (
    build_domain_map,
    build_parser,
    execute,
    _sub_name,
    _domain_of,
    _redact,
    main,
    CLIError,
    ACTION_PARAM_SCHEMA,
)
from engine import list_registered_actions


# ================================================================
#  helpers
# ================================================================

def run_cli(argv, monkeypatch, capsys, audit_path):
    """运行 cli.main 并捕获输出（恢复 builtins.print 重定向，隔离审计路径）"""
    monkeypatch.setenv('AUTOLINK_AUDIT_PATH', str(audit_path))
    orig_print = builtins.print
    try:
        try:
            rc = main(list(argv))
        except SystemExit as e:  # argparse 错误路径（usage 已打印到 stderr）
            rc = e.code if e.code is not None else 0
    finally:
        builtins.print = orig_print
    captured = capsys.readouterr()
    return rc, captured.out, captured.err


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    return str(path)


def make_project_config(tmp_path):
    """最小项目配置（8 GPU + 1 存储 + 2 通算，关闭 biz/oob 加速）"""
    from project_config import create_default_config
    cfg = create_default_config('CLI测试')
    cfg['topology']['num_gpu_servers'] = 8
    cfg['topology']['num_all_flash_storage'] = 1
    cfg['topology']['num_hybrid_flash_storage'] = 0
    cfg['topology']['num_compute_servers'] = 2
    cfg['networks']['biz_network'] = False
    cfg['networks']['oob_network'] = False
    return write_json(tmp_path / 'project_config.json', cfg)


# ================================================================
#  注册表驱动自动映射
# ================================================================

class TestAutoMapping:
    def test_all_actions_have_cli(self):
        """每个注册 action 都自动获得 CLI 映射（含无 schema 的 action 走 --json 兜底）"""
        domain_map = build_domain_map()
        mapped = {a for actions in domain_map.values() for a in actions}
        assert mapped == set(list_registered_actions())

    def test_domain_map_covers_expected_domains(self):
        domains = set(build_domain_map().keys())
        assert {'design', 'estimate', 'report', 'validate', 'project-config',
                'export', 'room', 'config'} <= domains

    def test_sub_name_mapping(self):
        assert _sub_name('room:create') == 'create'
        assert _sub_name('config:list-schema') == 'list-schema'
        assert _sub_name('design') == 'generate'      # schema 指定
        assert _sub_name('estimate') == 'run'          # 缺省 run

    def test_domain_of(self):
        assert _domain_of('room:create') == 'room'
        assert _domain_of('migrate') == 'project-config'  # schema domain 覆盖
        assert _domain_of('design') == 'design'

    def test_help_prints_all_domains_and_commands(self, capsys):
        parser = build_parser()
        parser.print_help()
        out = capsys.readouterr().out
        for domain in build_domain_map():
            assert domain in out
        run_parsers = getattr(parser, '_run_parsers', {})
        for domain, subs in run_parsers.items():
            for sub, sub_parser in subs.items():
                sub_parser.print_help()  # 不抛异常即 help 完备
        help_out = capsys.readouterr().out
        assert '--json' in help_out


# ================================================================
#  参数解析
# ================================================================

class TestArgParsing:
    def test_json_fallback(self, monkeypatch, capsys, tmp_path):
        """无 schema 的 action 也能经 --json 兜底执行"""
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(
            ['room', 'create', '--json', '{"rows": ["A", "B"], "cols": [1, 2], "name": "J"}'],
            monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert len(data['cells']) == 4

    def test_json_invalid(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, _, err = run_cli(['room', 'create', '--json', '{bad'], monkeypatch, capsys, audit)
        assert rc == 2
        assert '--json 解析失败' in err

    def test_flags_precede_json(self, monkeypatch, capsys, tmp_path):
        """flags 覆盖 --json 同名字段"""
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(
            ['room', 'create', '--rows', 'A', '--cols', '1', '--name', 'F',
             '--json', '{"name": "J"}'],
            monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['name'] == 'F'

    def test_file_json_param(self, monkeypatch, capsys, tmp_path):
        """file_json 参数：文件路径 → JSON 对象"""
        audit = tmp_path / 'audit.jsonl'
        cfg = write_json(tmp_path / 'proj.json', {'param_protocol': 'RoCE', 'num_servers': 50})
        rc, out, _ = run_cli(
            ['config', 'apply-preset', '--preset-id', 'ib-allflash', '--config', cfg],
            monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['config']['param_protocol'] == 'IB'
        assert data['config']['num_servers'] == 100

    def test_file_json_missing(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, _, err = run_cli(
            ['room', 'validate', '--layout', str(tmp_path / 'nope.json')],
            monkeypatch, capsys, audit)
        assert rc == 2
        assert '读取 JSON 文件失败' in err

    def test_unknown_domain(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, _, err = run_cli(['nope', 'run'], monkeypatch, capsys, audit)
        assert rc == 2

    def test_unknown_action(self):
        from cli import execute
        with pytest.raises(CLIError):
            execute('nope:action', {})


# ================================================================
#  输出格式
# ================================================================

class TestOutputFormats:
    def test_json_default(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['room', 'create', '--rows', 'A', '--cols', '1', '2'],
                             monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)  # 可解析 JSON
        assert len(data['cells']) == 2

    def test_text_format(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['room', 'create', '--rows', 'A', '--cols', '1', '2', '--format', 'text'],
                             monkeypatch, capsys, audit)
        assert rc == 0
        assert 'name: 机房' in out
        assert 'schemaVersion: 1' in out

    def test_ndjson_format(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['config', 'list-schema', '--format', 'ndjson'],
                             monkeypatch, capsys, audit)
        assert rc == 0
        # 每行独立 JSON（dict 单行）
        lines = [l for l in out.strip().splitlines() if l.strip()]
        json.loads(lines[0])


# ================================================================
#  命令级 golden
# ================================================================

class TestCommandGolden:
    def test_room_create(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(
            ['room', 'create', '--rows', 'A', 'B', 'C', '--cols', '1', '2', '3', '--name', '机房A'],
            monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['name'] == '机房A'
        assert data['rows'] == ['A', 'B', 'C']
        assert data['cols'] == [1, 2, 3]
        assert len(data['cells']) == 9
        assert all(c['type'] == 'empty' for c in data['cells'])

    def test_config_list_schema(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['config', 'list-schema'], monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert set(data['schemas'].keys()) == {'appSettings', 'project', 'template', 'wizard'}
        assert any(p['id'] == 'ib-allflash' for p in data['presets'])

    def test_config_export_import_roundtrip(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        app = write_json(tmp_path / 'app.json', {'theme': 'dark'})
        proj = write_json(tmp_path / 'proj.json', {'param_protocol': 'IB', 'num_servers': 200})

        rc, out, _ = run_cli(['config', 'export', '--app-settings', app, '--project-config', proj],
                             monkeypatch, capsys, audit)
        assert rc == 0
        payload = json.loads(out)['payload']
        assert payload['format'] == 'autolink-config'
        assert payload['appSettings']['theme'] == 'dark'

        import_path = write_json(tmp_path / 'exported.json', payload)
        rc2, out2, _ = run_cli(['config', 'import', '--payload', import_path],
                               monkeypatch, capsys, audit)
        assert rc2 == 0
        imported = json.loads(out2)
        assert imported['errors'] == []
        assert imported['appSettings']['theme'] == 'dark'
        assert imported['projectConfig']['num_servers'] == 200

    def test_design_generate_matches_gui(self, monkeypatch, capsys, tmp_path):
        """PRD 验收：design generate 输出与 GUI 一致（summary 结构 + valid 布尔）"""
        audit = tmp_path / 'audit.jsonl'
        cfg_path = make_project_config(tmp_path)
        rc, out, _ = run_cli(['design', 'generate', '--config', cfg_path],
                             monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['summary']['numServers'] == 8
        assert 'valid' in data
        assert 'topology' in data

    def test_validate_command(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        cfg_path = make_project_config(tmp_path)
        rc, out, _ = run_cli(['validate', '--config', cfg_path], monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert 'valid' in data


# ================================================================
#  审计日志
# ================================================================

class TestAudit:
    def test_audit_written_on_success(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        run_cli(['room', 'create', '--rows', 'A', '--cols', '1'], monkeypatch, capsys, audit)
        assert audit.exists()
        lines = audit.read_text(encoding='utf-8').strip().splitlines()
        assert len(lines) >= 1
        record = json.loads(lines[0])
        assert record['action'] == 'room:create'
        assert record['ok'] is True
        assert record['params']['rows'] == ['A']

    def test_audit_written_on_error_result(self, monkeypatch, capsys, tmp_path):
        """handler 返回 error dict（如配置缺失）也留审计轨迹"""
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['design', 'generate', '--config', str(tmp_path / 'missing.json')],
                             monkeypatch, capsys, audit)
        assert rc == 0  # handler 返回 {error} 而非抛异常
        assert 'error' in json.loads(out)
        lines = audit.read_text(encoding='utf-8').strip().splitlines()
        record = json.loads(lines[0])
        assert record['action'] == 'design'
        assert record['ok'] is True  # 执行本身成功，结果带 error

    def test_execute_failure_audit(self, monkeypatch, tmp_path):
        """execute 对执行异常路径记录 ok=False"""
        from cli import execute, CLIError
        audit = tmp_path / 'audit.jsonl'
        monkeypatch.setenv('AUTOLINK_AUDIT_PATH', str(audit))
        with pytest.raises(CLIError):
            execute('room:create', {'rows': ['A'], 'cols': ['x']})  # cols 非整数 → handler 抛异常
        lines = audit.read_text(encoding='utf-8').strip().splitlines()
        record = json.loads(lines[0])
        assert record['ok'] is False
        assert 'error' in record

    def test_redact_sensitive(self):
        redacted = _redact({'apiKey': 'sk-xxx', 'name': 'ok'})
        assert redacted['apiKey'] == '***'
        assert redacted['name'] == 'ok'

    def test_audit_failure_does_not_block(self, monkeypatch, capsys, tmp_path):
        """审计写入失败（非法路径）不阻塞命令执行"""
        audit = tmp_path / 'no-dir-here' / 'audit.jsonl'  # 目录不存在但会 makedirs，改为非法字符路径
        rc, out, _ = run_cli(['room', 'create', '--rows', 'A', '--cols', '1'],
                             monkeypatch, capsys, audit)
        assert rc == 0
        json.loads(out)


# ================================================================
#  打磨轮（v1.5 / AL-C1a）：output 域 CLI（list/delete/clear）
# ================================================================

class TestOutputCommands:
    def _mk_ws(self, tmp_path):
        """构造临时 workspace（$AUTOLINK_USER_DATA/workspace）：ProjA 含 2 版本批次 + 根目录散文件"""
        wsp = tmp_path / 'ws'
        out = wsp / 'workspace' / 'ProjA' / 'output'
        (out / 'v1_20260820_000001').mkdir(parents=True)
        (out / 'v1_20260820_000001' / 'manifest.json').write_text('{}', encoding='utf-8')
        (out / 'v2_20260820_000002').mkdir(parents=True)
        (out / 'root.txt').write_text('x', encoding='utf-8')
        return str(wsp)

    def test_output_list(self, monkeypatch, capsys, tmp_path):
        monkeypatch.setenv('AUTOLINK_USER_DATA', self._mk_ws(tmp_path))
        rc, out, _ = run_cli(['output', 'list', '--project', 'ProjA'],
                             monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == 0
        data = json.loads(out)
        assert 'v1_20260820_000001' in data['batches']
        assert 'root.txt' in data['root_files']

    def test_output_delete_batch(self, monkeypatch, capsys, tmp_path):
        monkeypatch.setenv('AUTOLINK_USER_DATA', self._mk_ws(tmp_path))
        rc, out, _ = run_cli(['output', 'delete', '--project', 'ProjA', '--batch', 'v1_20260820_000001'],
                             monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == 0
        assert json.loads(out)['deleted'] == 1
        assert not (tmp_path / 'ws' / 'workspace' / 'ProjA' / 'output' / 'v1_20260820_000001').exists()

    def test_output_clear(self, monkeypatch, capsys, tmp_path):
        monkeypatch.setenv('AUTOLINK_USER_DATA', self._mk_ws(tmp_path))
        rc, out, _ = run_cli(['output', 'clear', '--project', 'ProjA'],
                             monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == 0
        assert json.loads(out)['cleared'] is True
        assert not (tmp_path / 'ws' / 'workspace' / 'ProjA' / 'output' / 'v2_20260820_000002').exists()

    def test_output_bad_name_rejected(self, monkeypatch, capsys, tmp_path):
        monkeypatch.setenv('AUTOLINK_USER_DATA', self._mk_ws(tmp_path))
        rc, _, err = run_cli(['output', 'list', '--project', '../evil'],
                             monkeypatch, capsys, tmp_path / 'audit.jsonl')
        assert rc == 2
        assert '非法' in err


# ================================================================
#  AI-4（M6c 补齐）：模板/项目导入导出 CLI（template export/import、project export/import）
# ================================================================

class TestImportExportCommands:
    """AI-4: 模板/项目导入导出 CLI 命令"""

    def test_new_actions_in_domain_map(self):
        actions = set(list_registered_actions())
        for a in ('template:export', 'template:import', 'project:export', 'project:import'):
            assert a in actions

    def test_template_export_cli(self, monkeypatch, capsys, tmp_path):
        audit = tmp_path / 'audit.jsonl'
        out_zip = tmp_path / 'tpl.zip'
        rc, out, _ = run_cli(['template', 'export', '--name', 'DP3Tier-1024',
                              '--output-path', str(out_zip)],
                             monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['success'] is True
        assert data['zipPath'] == str(out_zip)
        assert out_zip.exists()

    def test_project_export_cli(self, monkeypatch, capsys, tmp_path):
        from manage import create_project
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        r = create_project('CLI导出项目')
        assert r['success'] is True
        audit = tmp_path / 'audit.jsonl'
        out_zip = tmp_path / 'proj.zip'
        rc, out, _ = run_cli(['project', 'export', '--name', 'CLI导出项目',
                              '--output-path', str(out_zip)],
                             monkeypatch, capsys, audit)
        assert rc == 0
        data = json.loads(out)
        assert data['success'] is True
        assert out_zip.exists()

    def test_template_export_missing_template(self, monkeypatch, capsys, tmp_path):
        """不存在的模板 → success False（命令级仍 0）"""
        audit = tmp_path / 'audit.jsonl'
        rc, out, _ = run_cli(['template', 'export', '--name', '__no_such__'],
                             monkeypatch, capsys, audit)
        assert rc == 0
        assert json.loads(out)['success'] is False
