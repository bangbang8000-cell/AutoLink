"""AutoLink v3.0.4-T3-4 统一配置 schema 层测试

覆盖 config_schema.py：
  - 四类 schema 元数据（appSettings/project/template/wizard）
  - 宽松/严格校验（类型/枚举/未知键放行）
  - 应用设置默认值补全
  - 预设套用（覆盖 + 校验）
  - 导入导出往返（格式/版本校验）
engine config:* actions：
  - config:list-schema / config:apply-preset / config:export / config:import
"""
import json
import pytest

from config_schema import (
    CONFIG_TYPES,
    SCHEMAS,
    DEFAULT_APP_SETTINGS,
    get_schema,
    list_schemas,
    validate_config,
    migrate_config,
    normalize_app_settings,
    list_presets,
    apply_preset,
    export_config,
    import_config,
    EXPORT_FORMAT,
)

ROWS_225 = [chr(65 + i) for i in range(15)]
COLS_225 = list(range(1, 16))


class TestSchemas:
    """四类配置 schema 定义"""

    def test_four_config_types(self):
        assert set(SCHEMAS.keys()) == {'appSettings', 'project', 'template', 'wizard'}
        assert set(CONFIG_TYPES) == set(SCHEMAS.keys())

    def test_each_schema_has_version_and_fields(self):
        for cfg_type, schema in SCHEMAS.items():
            assert schema['schemaVersion'] >= 1
            assert isinstance(schema['fields'], list) and schema['fields']
            for f in schema['fields']:
                assert f['key'] and f['type'] in ('string', 'number', 'boolean')
                assert 'default' in f and 'group' in f and 'label' in f

    def test_app_settings_defaults(self):
        assert DEFAULT_APP_SETTINGS['theme'] == 'system'
        assert DEFAULT_APP_SETTINGS['defaultPowerLimit'] == 6000
        assert DEFAULT_APP_SETTINGS['explorerGroupMode'] == 'smart'

    def test_get_schema_unknown_type(self):
        assert get_schema('nope') is None

    def test_list_schemas_shape(self):
        schemas = list_schemas()
        assert set(schemas.keys()) == set(CONFIG_TYPES)
        assert schemas['appSettings']['schemaVersion'] == 1


class TestValidateConfig:
    """宽松/严格校验"""

    def test_valid_config(self):
        assert validate_config('appSettings', dict(DEFAULT_APP_SETTINGS)) == []

    def test_type_error(self):
        errors = validate_config('project', {'num_servers': '100'})
        assert any('num_servers' in e for e in errors)

    def test_enum_error(self):
        errors = validate_config('project', {'param_protocol': 'Wifi'})
        assert any('param_protocol' in e for e in errors)

    def test_unknown_key_allowed(self):
        assert validate_config('project', {'unknown_future_key': 123}) == []

    def test_unknown_type(self):
        errors = validate_config('nope', {})
        assert errors and '未知配置类型' in errors[0]

    def test_non_dict(self):
        errors = validate_config('appSettings', 'not-a-dict')
        assert errors and 'JSON 对象' in errors[0]

    def test_strict_missing_key(self):
        errors = validate_config('appSettings', {}, strict=True)
        assert errors and '缺少字段' in errors[0]

    def test_boolean_field(self):
        errors = validate_config('appSettings', {'animations': 'yes'})
        assert any('animations' in e for e in errors)


class TestMigrateAndNormalize:
    """迁移链与默认值补全"""

    def test_migrate_same_version(self):
        data = {'schemaVersion': 1, 'theme': 'dark'}
        result = migrate_config('appSettings', data)
        assert result['schemaVersion'] == 1
        assert result['theme'] == 'dark'

    def test_migrate_does_not_mutate_input(self):
        data = {'theme': 'dark'}
        migrate_config('appSettings', data)
        assert 'schemaVersion' not in data  # 入参不被修改

    def test_normalize_app_settings_fills_defaults(self):
        merged = normalize_app_settings({'theme': 'dark'})
        assert merged['theme'] == 'dark'
        assert merged['defaultPowerLimit'] == 6000
        assert len(merged) == len(DEFAULT_APP_SETTINGS)

    def test_normalize_none(self):
        merged = normalize_app_settings(None)
        assert merged == DEFAULT_APP_SETTINGS


class TestPresets:
    """配置模板与预设"""

    def test_list_presets(self):
        presets = list_presets()
        assert len(presets) >= 3
        ids = [p['id'] for p in presets]
        assert 'ib-allflash' in ids and 'roce-general' in ids

    def test_apply_preset_overrides(self):
        config = {'param_protocol': 'RoCE', 'num_servers': 50}
        result, errors = apply_preset('ib-allflash', config)
        assert errors == []
        assert result['param_protocol'] == 'IB'
        assert result['num_servers'] == 100
        assert config['param_protocol'] == 'RoCE'  # 入参不被修改

    def test_apply_preset_unknown(self):
        result, errors = apply_preset('nope', {})
        assert errors and '预设不存在' in errors[0]

    def test_apply_preset_none_config(self):
        result, errors = apply_preset('uec-datacenter', None)
        assert errors == []
        assert result['param_protocol'] == 'UEC'


class TestImportExport:
    """配置导入导出闭环"""

    def test_export_import_roundtrip(self):
        app_settings = {'theme': 'dark', 'animations': False}
        project_config = {'param_protocol': 'IB', 'num_servers': 200}
        payload = export_config(app_settings, project_config)
        assert payload['format'] == EXPORT_FORMAT
        assert payload['appSettings']['theme'] == 'dark'
        assert payload['projectConfig']['param_protocol'] == 'IB'

        result = import_config(payload)
        assert result['errors'] == []
        assert result['appSettings']['theme'] == 'dark'
        assert result['appSettings']['fontSize'] == 14  # 缺失键补全
        assert result['projectConfig']['num_servers'] == 200

    def test_import_bad_format(self):
        result = import_config({'format': 'other', 'version': 1})
        assert result['errors'] and '不支持的配置格式' in result['errors'][0]

    def test_import_future_version(self):
        payload = export_config({}, {})
        payload['version'] = 99
        result = import_config(payload)
        assert result['errors'] and '版本过新' in result['errors'][0]

    def test_import_non_dict(self):
        result = import_config('oops')
        assert result['errors'] and 'JSON 对象' in result['errors'][0]

    def test_import_invalid_app_settings_type(self):
        payload = export_config({'animations': 'nope'}, {})
        result = import_config(payload)
        assert any('animations' in e for e in result['errors'])

    def test_import_invalid_project_type(self):
        payload = export_config({}, {'num_servers': 'x'})
        result = import_config(payload)
        assert any('num_servers' in e for e in result['errors'])


class TestConfigActions:
    """engine config:* actions"""

    def test_list_schema_action(self):
        from engine import handle_config_list_schema
        result = handle_config_list_schema({})
        assert set(result['schemas'].keys()) == set(CONFIG_TYPES)
        assert any(p['id'] == 'ib-allflash' for p in result['presets'])

    def test_apply_preset_action(self):
        from engine import handle_config_apply_preset
        result = handle_config_apply_preset({'presetId': 'l20-inference', 'config': {'num_servers': 10}})
        assert result['errors'] == []
        assert result['config']['num_servers'] == 64
        bad = handle_config_apply_preset({'presetId': 'missing', 'config': {}})
        assert bad['errors']

    def test_export_action(self):
        from engine import handle_config_export
        result = handle_config_export({'appSettings': {'theme': 'light'}, 'projectConfig': {'param_protocol': 'RoCE'}})
        payload = result['payload']
        assert payload['format'] == EXPORT_FORMAT
        assert payload['appSettings']['theme'] == 'light'
        assert payload['projectConfig']['param_protocol'] == 'RoCE'

    def test_import_action(self):
        from engine import handle_config_import
        payload = export_config({'theme': 'dark'}, {'num_servers': 128})
        result = handle_config_import({'payload': payload})
        assert result['errors'] == []
        assert result['appSettings']['theme'] == 'dark'
        assert result['projectConfig']['num_servers'] == 128
        bad = handle_config_import({'payload': {'format': 'x'}})
        assert bad['errors']
