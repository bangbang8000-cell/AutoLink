"""V3.1.3-T7-3: 示例文件解析测试（Excel/JSON/CSV/文本 → 结构化数据）"""
import json
import os

import pytest

from file_parser import detect_file_type, parse_file


def _write(tmp_path, name, content, encoding='utf-8'):
    p = os.path.join(str(tmp_path), name)
    with open(p, 'w', encoding=encoding) as f:
        f.write(content)
    return p


class TestDetectType:
    def test_ext_map(self):
        assert detect_file_type('a.xlsx') == 'excel'
        assert detect_file_type('a.XLS') == 'excel'
        assert detect_file_type('a.json') == 'json'
        assert detect_file_type('a.csv') == 'csv'
        assert detect_file_type('a.txt') == 'text'
        assert detect_file_type('a.yaml') == 'text'
        assert detect_file_type('a.unknown') == 'text'


class TestParseExcel:
    def test_parse_xlsx(self, tmp_path):
        import pandas as pd
        path = os.path.join(str(tmp_path), '需求清单.xlsx')
        pd.DataFrame({
            '设备类型': ['GPU服务器', '全闪存储'],
            '数量': [1024, 8],
            '速率': ['800G', '200G'],
        }).to_excel(path, index=False, sheet_name='规模')

        r = parse_file(path)
        assert r['success'] is True
        assert r['file']['type'] == 'excel'
        assert r['detected']['projectName'] == '需求清单'
        sheet = r['parsed']['sheets'][0]
        assert sheet['name'] == '规模'
        assert sheet['rowCount'] == 2
        assert sheet['rows'][0]['设备类型'] == 'GPU服务器'
        assert sheet['rows'][0]['数量'] == 1024

    def test_parse_missing_file(self):
        r = parse_file('/no/such/file.xlsx')
        assert r['success'] is False
        assert '文件不存在' in r['error']


class TestParseJson:
    def test_parse_project_config(self, tmp_path):
        cfg = {'meta': {'name': '示例项目'}, 'topology': {'num_gpu_servers': 512}, 'networks': {}}
        path = _write(tmp_path, 'config.json', json.dumps(cfg, ensure_ascii=False))
        r = parse_file(path)
        assert r['success'] is True
        assert r['parsed']['kind'] == 'project-config'
        assert r['parsed']['data']['topology']['num_gpu_servers'] == 512

    def test_parse_plain_json(self, tmp_path):
        path = _write(tmp_path, 'data.json', json.dumps({'items': [1, 2, 3]}))
        r = parse_file(path)
        assert r['success'] is True
        assert r['parsed']['kind'] == 'json'

    def test_parse_bad_json(self, tmp_path):
        path = _write(tmp_path, 'bad.json', '{not valid')
        r = parse_file(path)
        assert r['success'] is False
        assert '解析失败' in r['error']


class TestParseTextCsv:
    def test_parse_text(self, tmp_path):
        path = _write(tmp_path, '需求.txt', '1024 台 B300 双平面 800G IB\n全闪存储 8 台')
        r = parse_file(path)
        assert r['success'] is True
        assert r['parsed']['kind'] == 'text'
        assert 'B300' in r['parsed']['content']

    def test_parse_csv(self, tmp_path):
        path = _write(tmp_path, 'list.csv', 'type,count\nGPU,64\n存储,4\n')
        r = parse_file(path)
        assert r['success'] is True
        assert r['parsed']['kind'] == 'csv'
        assert r['parsed']['columns'] == ['type', 'count']
        assert r['parsed']['rows'][0]['count'] == 64

    def test_parse_unsupported_type_override(self, tmp_path):
        path = _write(tmp_path, 'a.bin', 'data')
        r = parse_file(path, file_type='excel')
        assert r['success'] is False
        assert '解析失败' in r['error']
