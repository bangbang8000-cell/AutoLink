"""
Tests for backend/migration.py
"""
import os
import json
import tempfile
import pytest
from backend.migration import (
    ini_to_project_config,
    migrate_project,
    needs_migration,
)


class TestIniToProjectConfig:
    def test_basic_ini_migration(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')
                f.write('downlink_mode = custom\n')
                f.write('param_speed = 400G\n')

            config, warnings = ini_to_project_config(ini_path, 'test_migrate')

            assert config is not None
            assert config['meta']['name'] == 'test_migrate'
            assert config['topology']['num_gpu_servers'] == 64
            assert config['topology']['downlink_mode'] == 'custom'
            assert config['topology']['param_speed'] == '400G'
            # Networks should be auto-detected
            assert config['networks']['param_network'] is True

    def test_ini_with_additional_servers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 100\n')
                f.write('num_additional_servers = 20\n')

            config, warnings = ini_to_project_config(ini_path)

            assert config['topology']['num_gpu_servers'] == 100
            assert config['topology']['num_compute_servers'] == 20

    def test_ini_storage_split(self):
        """Old num_storage_servers should be split into all_flash + hybrid"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')
                f.write('num_storage_servers = 14\n')

            config, warnings = ini_to_project_config(ini_path)

            # 14 / 2 = 7, remainder 1 goes to all_flash
            assert config['topology']['num_all_flash_storage'] > 0
            assert config['topology']['num_hybrid_flash_storage'] > 0
            assert config['topology']['num_all_flash_storage'] + config['topology']['num_hybrid_flash_storage'] == 14

    def test_ini_oob_biz_switches(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 100\n')
                f.write('oob_enabled = true\n')
                f.write('biz_enabled = false\n')
                f.write('oob_downlink_limit = 25\n')

            config, warnings = ini_to_project_config(ini_path)

            assert config['networks']['oob_network'] is True
            assert config['networks']['biz_network'] is False

    def test_ini_with_rack_section(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')
                f.write('[rack]\n')
                f.write('rack_type = 49\n')
                f.write('power_limit_per_rack = 12000\n')
                f.write('naming_prefix = Rack-')

            config, warnings = ini_to_project_config(ini_path)

            assert config['rack_config']['rack_type'] == 49
            assert config['rack_config']['power_limit_per_rack'] == 12000
            assert config['rack_config']['naming_prefix'] == 'Rack-'

    def test_ini_nonexistent_file(self):
        config, warnings = ini_to_project_config('/nonexistent/path.ini')
        assert config is None
        assert len(warnings) > 0

    def test_ini_generates_device_refs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')
                f.write('oob_enabled = true\n')
                f.write('biz_enabled = true\n')

            config, warnings = ini_to_project_config(ini_path)

            refs = config.get('device_refs', {})
            assert len(refs) > 0
            assert 'param_leaf_switch' in refs or 'gpu_server' in config.get('device_refs', {})

    def test_ini_default_when_missing_section(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[other]\n')
                f.write('key = value\n')

            config, warnings = ini_to_project_config(ini_path)
            assert config is not None
            # Should have default values
            assert 'num_gpu_servers' in config['topology']

    def test_ini_empty_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('')

            config, warnings = ini_to_project_config(ini_path)
            assert config is not None  # Should still return a default config

    def test_ib_protocol_migration(self):
        """When param_protocol is set in topology, device refs should reflect IB defaults"""
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')

            # Should default to RoCE (H3C switches)
            config, _ = ini_to_project_config(ini_path)
            assert config['topology']['param_protocol'] == 'RoCE'


class TestMigrateProject:
    def test_migrate_creates_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
                f.write('num_servers = 64\n')

            json_path, warnings = migrate_project(tmpdir)
            assert json_path is not None
            assert os.path.exists(json_path)

    def test_migrate_skips_existing_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            json_path = os.path.join(tmpdir, 'project_config.json')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
            with open(json_path, 'w') as f:
                f.write('{"meta":{"name":"existing"}}')

            result, warnings = migrate_project(tmpdir)
            assert result is None  # Should skip
            assert '已存在' in warnings[0]

    def test_migrate_no_ini(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result, warnings = migrate_project(tmpdir)
            assert result is None
            assert '不存在' in warnings[0]


class TestNeedsMigration:
    def test_needs_migration_true(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')
            assert needs_migration(tmpdir) is True

    def test_needs_migration_false_json_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = os.path.join(tmpdir, 'project_config.json')
            with open(json_path, 'w') as f:
                f.write('{}')
            assert needs_migration(tmpdir) is False

    def test_needs_migration_false_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assert needs_migration(tmpdir) is False
