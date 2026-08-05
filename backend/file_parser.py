"""AutoLink 示例文件解析（V3.1.3-T7-3）

把用户上传的示例文件（Excel / JSON / CSV / 文本）解析为结构化数据，
供 AIHUB parse_file 工具与 CLI 使用 —— 需求生成 / 模板参考的输入源。

只读操作，不修改源文件；大数据量截断（token 友好）：
  - Excel/CSV: 每 sheet 前 MAX_ROWS 行、前 MAX_SHEETS 个 sheet
  - 文本: 前 MAX_TEXT_CHARS 字符
"""
import json
import os

MAX_SHEETS = 5
MAX_ROWS = 50
MAX_TEXT_CHARS = 6000

_EXT_MAP = {
    '.xlsx': 'excel',
    '.xls': 'excel',
    '.json': 'json',
    '.csv': 'csv',
    '.txt': 'text',
    '.md': 'text',
    '.yaml': 'text',
    '.yml': 'text',
    '.ini': 'text',
    '.j2': 'text',
    '.cfg': 'text',
    '.conf': 'text',
}


def detect_file_type(path: str) -> str:
    """按扩展名识别文件类型；未知类型按文本处理"""
    ext = os.path.splitext(path)[1].lower()
    return _EXT_MAP.get(ext, 'text')


def _frame_to_records(df) -> list:
    """DataFrame → [{col: value}]，NaN/NaT → None，列名字符串化"""
    df = df.where(df.notna(), None)
    return [{str(k): v for k, v in rec.items()} for rec in df.to_dict(orient='records')]


def _parse_excel(path: str, max_sheets: int = MAX_SHEETS, max_rows: int = MAX_ROWS) -> dict:
    import pandas as pd
    xl = pd.ExcelFile(path)
    sheets = []
    for name in xl.sheet_names[:max_sheets]:
        df = xl.parse(name, nrows=max_rows)
        rows = _frame_to_records(df)
        sheets.append({
            'name': name,
            'columns': [str(c) for c in df.columns],
            'rowCount': len(df),
            'rows': rows,
        })
    return {'kind': 'excel', 'sheets': sheets, 'sheetCount': len(xl.sheet_names)}


def _parse_csv(path: str, max_rows: int = MAX_ROWS) -> dict:
    import pandas as pd
    df = pd.read_csv(path, nrows=max_rows)
    return {
        'kind': 'csv',
        'columns': [str(c) for c in df.columns],
        'rowCount': len(df),
        'rows': _frame_to_records(df),
    }


def _parse_json(path: str) -> dict:
    with open(path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
    kind = 'project-config' if isinstance(data, dict) and 'topology' in data and 'networks' in data else 'json'
    return {'kind': kind, 'data': data}


def _parse_text(path: str, max_chars: int = MAX_TEXT_CHARS) -> dict:
    with open(path, 'r', encoding='utf-8-sig', errors='replace') as f:
        content = f.read(max_chars)
    return {'kind': 'text', 'content': content, 'truncated': len(content) >= max_chars}


_PARSERS = {
    'excel': _parse_excel,
    'csv': _parse_csv,
    'json': _parse_json,
    'text': _parse_text,
}


def parse_file(path: str, file_type: str = '') -> dict:
    """解析示例文件为结构化数据（只读）

    file_type 缺省按扩展名识别（excel/json/csv/text）；
    失败返回 {'success': False, 'error': ...}。
    """
    if not path or not os.path.isfile(path):
        return {'success': False, 'error': f'文件不存在: {path}'}

    ftype = (file_type or detect_file_type(path)).lower()
    parser = _PARSERS.get(ftype)
    if parser is None:
        return {'success': False, 'error': f'不支持的文件类型: {file_type}（支持 excel/json/csv/text）'}

    try:
        parsed = parser(path)
    except Exception as e:
        return {'success': False, 'error': f'{ftype} 解析失败: {e}'}

    name = os.path.basename(path)
    # 启发式：文件名（去扩展名）作为候选项目名
    project_name = os.path.splitext(name)[0].strip()
    return {
        'success': True,
        'file': {'name': name, 'path': path, 'type': ftype, 'size': os.path.getsize(path)},
        'parsed': parsed,
        'detected': {'projectName': project_name},
    }
