"""
Tests for backend/project_config.py
"""
import os
import json
import tempfile
import pytest
from backend.project_config import (
    create_default_config,
    load_project_config,
    save_project_config,
    validate_config,
    find_config_file,
    update_device_ref,
    update_topology,
    update_networks,
    update_rack,
    DEFAULT_PROJECT_CONFIG,
)


class TestCreateDefaultConfig:
    def test_creates_with_name(self):
        config = create_default_config('test_project', 'test desc')
        assert config['meta']['name'] == 'test_project'
        assert config['meta']['description'] == 'test desc'
        assert config['meta']['version'] == 1
        assert config['meta']['created_at'] != ''
        assert config['meta']['updated_at'] != ''

    def test_default_topology_values(self):
        config = create_default_config('test')
        topo = config['topology']
        assert topo['num_gpu_servers'] == 100
        assert topo['num_all_flash_storage'] == 8
        assert topo['num_hybrid_flash_storage'] == 6
        assert topo['num_compute_servers'] == 20
        assert topo['param_protocol'] == 'RoCE'
        assert topo['downlink_mode'] == 'custom'

    def test_default_networks(self):
        config = create_default_config('test')
        assert config['networks']['param_network'] is True
        assert config['networks']['storage_network'] is True
        assert config['networks']['biz_network'] is True
        assert config['networks']['oob_network'] is True

    def test_default_rack_config(self):
        config = create_default_config('test')
        assert config['rack_config']['rack_type'] == 42
        assert config['rack_config']['power_limit_per_rack'] == 6000

    def test_deep_copy(self):
        """create_default_config should return a deep copy, not reference"""
        c1 = create_default_config('test1')
        c2 = create_default_config('test2')
        c1['topology']['num_gpu_servers'] = 50
        assert c2['topology']['num_gpu_servers'] == 100


class TestSaveLoadConfig:
    def test_save_and_load(self):
        config = create_default_config('save_test')
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'project_config.json')
            success, error = save_project_config(path, config)
            assert success
            assert error is None
            assert os.path.exists(path)

            loaded, load_err = load_project_config(path)
            assert load_err is None
            assert loaded['meta']['name'] == 'save_test'

    def test_load_nonexistent(self):
        config, error = load_project_config('/nonexistent/path.json')
        assert error is not None
        assert config == {}

    def test_save_creates_dir(self):
        config = create_default_config('dir_test')
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, 'new_subdir')
            path = os.path.join(subdir, 'config.json')
            success, _ = save_project_config(path, config)
            assert success
            assert os.path.exists(path)

    def test_save_auto_timestamp(self):
        config = create_default_config('ts_test')
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'config.json')
            save_project_config(path, config)
            loaded, _ = load_project_config(path)
            assert loaded['meta']['updated_at'] != ''
            assert loaded['meta']['created_at'] != ''


class TestValidateConfig:
    def test_valid_config_passes(self):
        config = create_default_config('valid')
        error = validate_config(config)
        assert error is None

    def test_invalid_type(self):
        assert validate_config('not a dict') is not None

    def test_missing_top_level_key(self):
        config = create_default_config('test')
        del config['topology']
        error = validate_config(config)
        assert error is not None
        assert 'topology' in error

    def test_missing_meta_key(self):
        config = create_default_config('test')
        del config['meta']['name']
        error = validate_config(config)
        assert error is not None
        assert 'name' in error

    def test_missing_network_key(self):
        config = create_default_config('test')
        del config['networks']['param_network']
        error = validate_config(config)
        assert error is not None
        assert 'param_network' in error

    def test_missing_topo_key(self):
        config = create_default_config('test')
        del config['topology']['num_gpu_servers']
        error = validate_config(config)
        assert error is not None

    def test_invalid_param_protocol(self):
        config = create_default_config('test')
        config['topology']['param_protocol'] = 'Ethernet'
        error = validate_config(config)
        assert error is not None

    def test_invalid_downlink_mode(self):
        config = create_default_config('test')
        config['topology']['downlink_mode'] = 'half'
        error = validate_config(config)
        assert error is not None

    def test_non_bool_network(self):
        config = create_default_config('test')
        config['networks']['param_network'] = 'yes'
        error = validate_config(config)
        assert error is not None

    def test_non_numeric_topo_value(self):
        config = create_default_config('test')
        config['topology']['num_gpu_servers'] = 'many'
        error = validate_config(config)
        assert error is not None

    def test_missing_rack_key(self):
        config = create_default_config('test')
        del config['rack_config']['rack_type']
        error = validate_config(config)
        assert error is not None


class TestFindConfigFile:
    def test_finds_json_first(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = os.path.join(tmpdir, 'project_config.json')
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(json_path, 'w') as f:
                f.write('{}')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')

            found = find_config_file(tmpdir)
            assert found == json_path

    def test_falls_back_to_ini(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ini_path = os.path.join(tmpdir, 'network_config.ini')
            with open(ini_path, 'w') as f:
                f.write('[topology]\n')

            found = find_config_file(tmpdir)
            assert found == ini_path

    def test_returns_none_for_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            found = find_config_file(tmpdir)
            assert found is None


class TestUpdateHelpers:
    def test_update_device_ref(self):
        config = create_default_config('test')
        update_device_ref(config, 'gpu_server', 'nvidia_dgx_h100')
        assert config['device_refs']['gpu_server'] == {'library_id': 'nvidia_dgx_h100'}

    def test_update_topology(self):
        config = create_default_config('test')
        update_topology(config, {'num_gpu_servers': 50, 'param_speed': '800G'})
        assert config['topology']['num_gpu_servers'] == 50
        assert config['topology']['param_speed'] == '800G'

    def test_update_networks(self):
        config = create_default_config('test')
        update_networks(config, {'param_network': False})
        assert config['networks']['param_network'] is False

    def test_update_rack(self):
        config = create_default_config('test')
        update_rack(config, {'rack_type': 49, 'power_limit_per_rack': 12000})
        assert config['rack_config']['rack_type'] == 49
