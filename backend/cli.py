"""AutoLink v3.1.0-T4-1 显式 CLI 能力层（autolink-cli）

架构（v3.1.0 CLI 显式能力层）：
  - 注册表驱动：从 engine 的 action 注册表自动发现 action，
    'a:b' → 子命令树（'room:create' → `room create`；单名 'design' → `design generate`，
    sub 名由 ACTION_PARAM_SCHEMA 指定，缺省 'run'）→ 新增 action 零改动自动获得 CLI
  - 参数 schema：ACTION_PARAM_SCHEMA 定义常用 flag（类型/必填/help）；
    通用 --json '<params>' 兜底（无 schema 的 action 自动降级可用）
  - 统一执行：execute(action, params, argv=None) → handler 结果；
    engine.main() stdin 路由经此执行（UI 与 CLI 行为一致）
  - 审计：每次执行写 cli-audit.jsonl（时间/action/命令/参数脱敏/结果）
  - 输出：--format json（默认）/ ndjson / text

用法：
    python -m cli --help
    python -m cli design generate --config project_config.json
    python -m cli room create --rows A B C --cols 1 2 3 --name 机房A
    python -m cli config list-schema
    python -m cli design --json '{"configFile": "project_config.json"}'
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import datetime
from typing import Any, Dict, List, Optional

from engine import get_action_handler, list_registered_actions

CLI_VERSION = '1.0.0'

# 审计日志路径优先级：AUTOLINK_AUDIT_PATH > $AUTOLINK_USER_DATA/audit/cli-audit.jsonl > ~/.autolink/audit/cli-audit.jsonl
# （Electron 侧 spawn engine 时注入 AUTOLINK_USER_DATA=userData；测试注入 AUTOLINK_AUDIT_PATH）
_SENSITIVE_KEYS = ('password', 'secret', 'token', 'api_key', 'apikey')


# ================================================================
#  参数 schema（action → CLI 参数定义；未列出的 action 走 --json 兜底）
# ================================================================

ACTION_PARAM_SCHEMA: Dict[str, Dict[str, Any]] = {
    'design': {
        'sub': 'generate',
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'estimate': {
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'report': {
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'validate': {
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'migrate': {
        'sub': 'migrate',
        'domain': 'project-config',
        'params': [
            {'name': 'projectDir', 'flags': ['--project-dir'], 'type': str,
             'required': True, 'help': '项目目录绝对路径（INI → JSON 迁移）'},
        ],
    },
    'project_config_to_ini': {
        'sub': 'to-ini',
        'domain': 'project-config',
        'params': [
            {'name': 'config', 'flags': ['--config-file', '--config'], 'type': str,
             'required': True, 'help': 'project_config.json 路径（反向序列化为 network_config.ini）',
             'file_json': True},
        ],
    },
    'export': {
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
            {'name': 'outputDir', 'flags': ['--output-dir'], 'type': str,
             'required': False, 'help': '输出目录（默认 output）'},
            {'name': 'outputTypes', 'flags': ['--output-types'], 'type': str,
             'required': False, 'help': '输出类型逗号分隔（connections,deviceList,cablingGuide,bom,reportData,pdfReport）'},
        ],
    },
    'room:create': {
        'params': [
            {'name': 'rows', 'flags': ['--rows'], 'type': str, 'nargs': '+',
             'required': True, 'help': '行命名列表，如 --rows A B C'},
            {'name': 'cols', 'flags': ['--cols'], 'type': int, 'nargs': '+',
             'required': True, 'help': '列编号列表，如 --cols 1 2 3'},
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': False, 'help': '机房名称（默认 机房）'},
            {'name': 'project', 'flags': ['--project'], 'type': str,
             'required': False, 'help': '项目名（提供则落盘到该项目 room_layout.json）'},
        ],
    },
    'room:validate': {
        'params': [
            {'name': 'layout', 'flags': ['--layout'], 'type': str,
             'required': True, 'help': 'room_layout.json 路径（校验）', 'file_json': True},
        ],
    },
    'room:optimize': {
        'params': [
            {'name': 'matrix', 'flags': ['--matrix', '--matrix-file'], 'type': str,
             'required': False, 'help': 'room_layout.json 路径（缺省按 --project 读取）', 'file_json': True},
            {'name': 'project', 'flags': ['--project'], 'type': str,
             'required': False, 'help': '项目名（matrix 缺省时读取该项目机房矩阵）'},
            {'name': 'counts', 'flags': ['--counts'], 'type': str,
             'required': False, 'help': '类型→数量 JSON 文件（对话场景，如 {"gpu":120}）', 'file_json': True},
            {'name': 'cabinets', 'flags': ['--cabinets'], 'type': str,
             'required': False, 'help': '机柜列表 JSON 文件（[{id,type,power_watts}]，优先于 counts）', 'file_json': True},
            {'name': 'objectives', 'flags': ['--objectives'], 'type': str,
             'required': False, 'help': '目标权重 JSON 文件（power_balance/thermal_zones/network_locality/shortest_cable）', 'file_json': True},
            {'name': 'time_budget_s', 'flags': ['--time-budget'], 'type': float,
             'required': False, 'help': '时间预算秒（默认 5）'},
            {'name': 'reset_existing', 'flags': ['--reset-existing'], 'type': bool,
             'required': False, 'help': '清空已落位机柜重排（默认保留手动放置）'},
        ],
    },
    'room:set-type': {
        'params': [
            {'name': 'project', 'flags': ['--project'], 'type': str,
             'required': True, 'help': '项目名'},
            {'name': 'position', 'flags': ['--position'], 'type': str,
             'required': True, 'help': '位置，如 A1'},
            {'name': 'type', 'flags': ['--type'], 'type': str,
             'required': True, 'help': '类型：gpu/network/storage/compute/combined/empty'},
        ],
    },
    'room:place': {
        'params': [
            {'name': 'project', 'flags': ['--project'], 'type': str,
             'required': True, 'help': '项目名'},
            {'name': 'position', 'flags': ['--position'], 'type': str,
             'required': True, 'help': '位置，如 A1'},
            {'name': 'cabinet_id', 'flags': ['--cabinet-id'], 'type': int,
             'required': True, 'help': '机柜 id（0 表示移除）'},
            {'name': 'cabinet_type', 'flags': ['--cabinet-type'], 'type': str,
             'required': False, 'help': '机柜类型（提供时做类型域校验）'},
            {'name': 'power_watts', 'flags': ['--power-watts'], 'type': int,
             'required': False, 'help': '机柜功率 W（提供时做上限校验）'},
        ],
    },
    'config:list-schema': {
        'params': [],
    },
    'config:apply-preset': {
        'params': [
            {'name': 'presetId', 'flags': ['--preset-id'], 'type': str,
             'required': True, 'help': '预设 id（ib-allflash/roce-general/l20-inference/uec-datacenter）'},
            {'name': 'config', 'flags': ['--config', '--config-file'], 'type': str,
             'required': False, 'help': '当前设计配置 JSON 文件路径（缺省 = {}）', 'file_json': True},
        ],
    },
    'config:export': {
        'params': [
            {'name': 'appSettings', 'flags': ['--app-settings'], 'type': str,
             'required': False, 'help': '应用设置 JSON 文件路径（缺省 = {}）', 'file_json': True},
            {'name': 'projectConfig', 'flags': ['--project-config'], 'type': str,
             'required': False, 'help': '项目配置 JSON 文件路径（缺省 = {}）', 'file_json': True},
        ],
    },
    'config:import': {
        'params': [
            {'name': 'payload', 'flags': ['--payload', '--file'], 'type': str,
             'required': True, 'help': '导出的配置包裹 JSON 文件路径', 'file_json': True},
        ],
    },
    # V3.1.3-T7-1: 对话管理域只读查询（设备库/模板/项目）
    'device:list': {
        'sub': 'list',
        'domain': 'device',
        'params': [
            {'name': 'category', 'flags': ['--category'], 'type': str,
             'required': False, 'help': '分类 id / 厂商 / 型号过滤'},
            {'name': 'query', 'flags': ['--query'], 'type': str,
             'required': False, 'help': '关键词搜索（vendor/model/description）'},
            {'name': 'limit', 'flags': ['--limit'], 'type': int,
             'required': False, 'help': '最大返回数（默认 50）'},
        ],
    },
    'device:defaults': {
        'sub': 'defaults',
        'domain': 'device',
        'params': [
            {'name': 'protocol', 'flags': ['--protocol'], 'type': str,
             'required': False, 'help': '参数网协议：IB/RoCE/UEC（默认 IB）'},
            {'name': 'gpu_library_id', 'flags': ['--gpu-library-id'], 'type': str,
             'required': False, 'help': 'GPU 设备库 id（决定 IB 世代：gb300/nvl72/b200/b300 → 800G，其余 400G）'},
        ],
    },
    'template:list': {
        'sub': 'list',
        'domain': 'template',
        'params': [],
    },
    'template:view': {
        'sub': 'view',
        'domain': 'template',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '模板名（内置或用户模板）'},
        ],
    },
    'project:list': {
        'sub': 'list',
        'domain': 'project',
        'params': [],
    },
    'project:info': {
        'sub': 'info',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名（工作区项目）'},
        ],
    },
    # V3.1.3-T7-2: 需求生成（轨道 B）——LLM 抽取配置 → 规范化补全 + 置信度标注（只预览不落盘）
    'project:generate': {
        'sub': 'generate',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': False, 'help': '项目名（缺省取 config.meta.name）'},
            {'name': 'config', 'flags': ['--config'], 'type': str,
             'required': True, 'help': 'LLM 抽取的项目配置 JSON 文件路径', 'file_json': True},
        ],
    },
    # V3.1.3-T7-3: 示例文件解析（Excel/JSON/CSV/文本 → 结构化数据）
    'file:parse': {
        'sub': 'parse',
        'domain': 'file',
        'params': [
            {'name': 'path', 'flags': ['--path'], 'type': str,
             'required': True, 'help': '文件路径'},
            {'name': 'type', 'flags': ['--type'], 'type': str,
             'required': False, 'help': '文件类型（excel/json/csv/text，缺省按扩展名识别）'},
        ],
    },
    # V3.1.3-T7-4: 容量规划（模型档案 + 推荐）
    'capacity:list-presets': {
        'sub': 'list-presets',
        'domain': 'capacity',
        'params': [],
    },
    'capacity:recommend': {
        'sub': 'recommend',
        'domain': 'capacity',
        'params': [
            {'name': 'model', 'flags': ['--model'], 'type': str,
             'required': True, 'help': '模型档案 id（如 deepseek-v3/llama3-70b）或自定义模型名'},
            {'name': 'num_gpus', 'flags': ['--num-gpus'], 'type': int,
             'required': True, 'help': '目标 GPU 数量'},
            {'name': 'budget', 'flags': ['--budget'], 'type': str,
             'required': False, 'help': '预算档位（economy/standard/premium，默认 standard）'},
            {'name': 'tp', 'flags': ['--tp'], 'type': int, 'required': False, 'help': '张量并行（默认 8）'},
            {'name': 'dp', 'flags': ['--dp'], 'type': int, 'required': False, 'help': '数据并行（默认 1）'},
            {'name': 'pp', 'flags': ['--pp'], 'type': int, 'required': False, 'help': '流水线并行（默认 1）'},
            {'name': 'precision', 'flags': ['--precision'], 'type': str,
             'required': False, 'help': '训练精度覆盖（fp8/fp16/bf16）'},
            {'name': 'context_length', 'flags': ['--context-length'], 'type': int,
             'required': False, 'help': '上下文长度覆盖（token）'},
        ],
    },
    # V3.2.0-T9-2: ATOP 式自动拓扑优化（模型通信特征 → ZCube cube 拓扑推荐）
    'atop:recommend': {
        'sub': 'recommend',
        'domain': 'atop',
        'params': [
            {'name': 'num_gpus', 'flags': ['--num-gpus'], 'type': int,
             'required': True, 'help': '目标 GPU 数量'},
            {'name': 'model', 'flags': ['--model'], 'type': str,
             'required': False, 'help': '模型档案 id（如 deepseek-v3/llama3-70b）或模型名'},
            {'name': 'features', 'flags': ['--features'], 'type': str,
             'required': False, 'help': '通信特征 JSON 文件（communication_pattern/comm_ratio/traffic）', 'file_json': True},
            {'name': 'tp', 'flags': ['--tp'], 'type': int, 'required': False, 'help': '张量并行（默认 8）'},
            {'name': 'dp', 'flags': ['--dp'], 'type': int, 'required': False, 'help': '数据并行（默认 1）'},
            {'name': 'pp', 'flags': ['--pp'], 'type': int, 'required': False, 'help': '流水线并行（默认 1）'},
            {'name': 'switch_ports', 'flags': ['--switch-ports'], 'type': int,
             'required': False, 'help': 'Leaf 端口数（0 = 按规模自动档位）'},
            {'name': 'leaf_count', 'flags': ['--leaf-count'], 'type': int,
             'required': False, 'help': '每组 Leaf 数（0 = 自动推导）'},
        ],
    },
    # V3.2.0-T9-3: 批量优化（收敛比/成本/散热建议生成 + 应用）
    'optimize:suggest': {
        'sub': 'suggest',
        'domain': 'optimize',
        'params': [
            {'name': 'configFile', 'flags': ['--config-file', '--config'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'optimize:apply': {
        'sub': 'apply',
        'domain': 'optimize',
        'params': [
            {'name': 'configFile', 'flags': ['--config-file', '--config'], 'type': str,
             'required': True, 'help': '项目配置路径'},
            {'name': 'suggestions', 'flags': ['--suggestions'], 'type': str,
             'required': True, 'help': '选中的建议 JSON 文件（[{category,title,patch}]）', 'file_json': True},
        ],
    },
    # V3.2.0-T9-4: 智能修复（校验错误 → 修复 patch → 复核 → 一键应用）
    'repair:plan': {
        'sub': 'plan',
        'domain': 'repair',
        'params': [
            {'name': 'configFile', 'flags': ['--config-file', '--config'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
        ],
    },
    'repair:apply': {
        'sub': 'apply',
        'domain': 'repair',
        'params': [
            {'name': 'configFile', 'flags': ['--config-file', '--config'], 'type': str,
             'required': True, 'help': '项目配置路径'},
            {'name': 'fixes', 'flags': ['--fixes'], 'type': str,
             'required': True, 'help': '选中的修复项 JSON 文件（[{rule_id,patch}]）', 'file_json': True},
        ],
    },
}


# ================================================================
#  工具函数
# ================================================================

def _sub_name(action: str) -> str:
    """子命令名：schema 指定 > 'a:b' 的 b > 'run'"""
    schema = ACTION_PARAM_SCHEMA.get(action)
    if schema and schema.get('sub'):
        return schema['sub']
    if ':' in action:
        return action.split(':', 1)[1].replace('_', '-')
    return 'run'


def _domain_of(action: str) -> str:
    """域：schema.domain 覆盖 > 'a:b' 的 a > 单名 action 自身"""
    schema = ACTION_PARAM_SCHEMA.get(action)
    if schema and schema.get('domain'):
        return schema['domain']
    return action.split(':', 1)[0] if ':' in action else action


def build_domain_map() -> Dict[str, List[str]]:
    """注册表 action → { 域: [action...] }（确定性排序）"""
    domains: Dict[str, List[str]] = {}
    for action in sorted(list_registered_actions()):
        domains.setdefault(_domain_of(action), []).append(action)
    return domains


def _redact(params: Dict[str, Any]) -> Dict[str, Any]:
    """脱敏：含敏感键名的值替换为 ***（审计用）"""
    redacted: Dict[str, Any] = {}
    for k, v in params.items():
        if any(s in k.lower() for s in _SENSITIVE_KEYS):
            redacted[k] = '***'
        else:
            redacted[k] = v
    return redacted


def audit_log(action: str, params: Dict[str, Any], argv: Optional[List[str]], ok: bool,
              error: Optional[str] = None) -> None:
    """写审计日志（失败不阻塞执行）"""
    try:
        env_path = os.environ.get('AUTOLINK_AUDIT_PATH')
        if env_path:
            path = env_path
        else:
            user_data = os.environ.get('AUTOLINK_USER_DATA', '')
            if user_data:
                path = os.path.join(user_data, 'audit', 'cli-audit.jsonl')
            else:
                path = os.path.join(os.path.expanduser('~'), '.autolink', 'audit', 'cli-audit.jsonl')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        record = {
            'ts': datetime.datetime.now().isoformat(),
            'action': action,
            'argv': list(argv or []),
            'params': _redact(dict(params or {})),
            'ok': bool(ok),
        }
        if error:
            record['error'] = error
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    except Exception:
        pass  # 审计失败不阻塞主流程


# ================================================================
#  统一执行入口（engine.main() 与 CLI 共用）
# ================================================================

class CLIError(Exception):
    """CLI 层错误（参数/执行失败）"""


def execute(action: str, params: Optional[Dict[str, Any]], argv: Optional[List[str]] = None) -> Any:
    """执行 action：校验 handler → 审计 → 调 handler

    engine.main() 与 cli main 共用此入口（UI 与 CLI 行为一致）。
    """
    handler = get_action_handler(action)
    if handler is None:
        raise CLIError(f"未知 action: {action}")
    params = dict(params or {})
    try:
        result = handler(params)
        audit_log(action, params, argv, ok=True)
        return result
    except Exception as e:
        audit_log(action, params, argv, ok=False, error=str(e))
        raise CLIError(f"action {action} 执行失败: {e}") from e


# ================================================================
#  argparse 动态路由
# ================================================================

def _add_action_parser(subparsers, domain: str, action: str) -> argparse.ArgumentParser:
    """为单个 action 构建子命令 parser（含 schema flags + --json 兜底 + --format）"""
    schema = ACTION_PARAM_SCHEMA.get(action, {})
    sub = _sub_name(action)
    help_text = schema.get('help') or f"执行 {action} action"
    parser = subparsers.add_parser(sub, help=help_text, description=f"{action} — {help_text}")
    for p in schema.get('params', []):
        # required 不在此强制（--json 兜底时允许缺失），改为 _collect_params 后统一校验
        if p.get('nargs'):
            parser.add_argument(*p['flags'], dest=p['name'], nargs=p['nargs'], type=p['type'],
                                help=p['help'])
        elif p['type'] == bool:
            parser.add_argument(*p['flags'], dest=p['name'], action='store_true', help=p['help'])
        else:
            parser.add_argument(*p['flags'], dest=p['name'], type=p['type'], help=p['help'])
    parser.add_argument('--json', type=str, default=None,
                        help="JSON 字符串作为 params（flags 优先覆盖；无 schema 的 action 通用入口）")
    parser.add_argument('--format', choices=['json', 'ndjson', 'text'], default='json',
                        help="输出格式（默认 json）")
    parser.set_defaults(_action=action, _domain=domain)
    return parser


def build_parser() -> argparse.ArgumentParser:
    """构建完整 parser：域（subparsers）→ 子命令（action parser）"""
    parser = argparse.ArgumentParser(
        prog='autolink-cli',
        description='AutoLink 显式 CLI 能力层（与 GUI 行为一致）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--version', action='version', version=f'autolink-cli {CLI_VERSION}')
    subparsers = parser.add_subparsers(dest='domain', metavar='<domain>')
    run_parsers: Dict[str, Dict[str, argparse.ArgumentParser]] = {}
    for domain, actions in build_domain_map().items():
        domain_parser = subparsers.add_parser(domain, help=f"{domain} 域命令")
        action_sub = domain_parser.add_subparsers(dest='sub', metavar='<command>')
        for action in actions:
            p = _add_action_parser(action_sub, domain, action)
            run_parsers.setdefault(domain, {})[_sub_name(action)] = p
    parser._run_parsers = run_parsers  # 域级缺省 run 用（内部）
    # 打磨轮（v1.5 / AL-C1a）：output 域（CLI 原生，非引擎 action）
    _add_output_parser(subparsers)
    return parser


def _collect_params(args) -> Dict[str, Any]:
    """从解析结果收集 params：schema flags + --json 兜底（flags 优先）；file_json 参数读取文件内容"""
    params: Dict[str, Any] = {}
    if getattr(args, 'json', None):
        try:
            parsed = json.loads(args.json)
            if not isinstance(parsed, dict):
                raise ValueError('--json 必须是 JSON 对象')
            params.update(parsed)
        except (json.JSONDecodeError, ValueError) as e:
            raise CLIError(f"--json 解析失败: {e}") from e
    # flags 覆盖（跳过 argparse 注入的元数据与未提供的 None 默认值）
    skip = {'_action', '_domain', 'domain', 'sub', 'json', 'format'}
    for key, value in vars(args).items():
        if key in skip or key.startswith('_') or value is None:
            continue
        params[key] = value
    # file_json 参数：文件路径 → 读取 JSON 对象
    action = getattr(args, '_action', '')
    schema = ACTION_PARAM_SCHEMA.get(action, {})
    for p in schema.get('params', []):
        if p.get('file_json') and isinstance(params.get(p['name']), str):
            path = params[p['name']]
            try:
                with open(path, 'r', encoding='utf-8-sig') as f:
                    params[p['name']] = json.load(f)
            except (OSError, json.JSONDecodeError) as e:
                raise CLIError(f"参数 {p['name']} 读取 JSON 文件失败: {path} — {e}") from e
    # required 校验（--json 兜底时信任 JSON，跳过）
    if not getattr(args, 'json', None):
        for p in schema.get('params', []):
            if p.get('required') and params.get(p['name']) is None:
                raise CLIError(f"缺少必填参数 {p['flags'][0]}")
    return params


# ================================================================
#  打磨轮（v1.5 / AL-C1a）：output 域（项目输出管理，CLI 原生，非引擎 action）
# ================================================================

def _safe_output_name(name: str) -> str:
    """项目/批次名安全校验（防路径穿越）"""
    if not name or name in ('.', '..') or '..' in name or '/' in name or '\\' in name:
        raise CLIError(f"非法名称: {name}")
    return name


def _project_output_dir(project: str) -> str:
    from manage import workspace_dir
    return os.path.join(workspace_dir(), _safe_output_name(project), 'output')


def cmd_output_list(project: str) -> Dict[str, Any]:
    """列出项目输出版本批次（vN_ts 目录 + 根目录散文件）"""
    out = _project_output_dir(project)
    if not os.path.isdir(out):
        return {'project': project, 'batches': [], 'root_files': [], 'exists': False}
    batches = sorted(d for d in os.listdir(out) if os.path.isdir(os.path.join(out, d)))
    root_files = sorted(f for f in os.listdir(out) if os.path.isfile(os.path.join(out, f)))
    return {'project': project, 'batches': batches, 'root_files': root_files, 'exists': True}


def cmd_output_delete(project: str, batch: Optional[str] = None) -> Dict[str, Any]:
    """删除单批次或清空项目输出（仅 output/ 产物目录）"""
    out = _project_output_dir(project)
    if not os.path.isdir(out):
        return {'project': project, 'deleted': 0}
    if batch:
        _safe_output_name(batch)
        target = os.path.join(out, batch)
        if not os.path.isdir(target):
            raise CLIError(f"批次不存在: {batch}")
        shutil.rmtree(target, ignore_errors=True)
        return {'project': project, 'batch': batch, 'deleted': 1}
    for entry in os.listdir(out):
        p = os.path.join(out, entry)
        if os.path.isdir(p):
            shutil.rmtree(p, ignore_errors=True)
        else:
            try:
                os.remove(p)
            except OSError:
                pass
    return {'project': project, 'cleared': True, 'deleted': 0}


def _add_output_parser(subparsers) -> argparse.ArgumentParser:
    """output 域：list / delete / clear（CLI 原生）"""
    p = subparsers.add_parser('output', help='项目输出管理（版本批次 list/delete/clear）')
    out_sub = p.add_subparsers(dest='out_cmd', metavar='<command>')
    for cmd, help_text in (('list', '列出项目输出版本批次'), ('delete', '删除批次/清空项目输出'), ('clear', '清空项目输出')):
        sp = out_sub.add_parser(cmd, help=help_text)
        sp.add_argument('--project', required=True, help='项目名')
        if cmd == 'delete':
            sp.add_argument('--batch', default=None, help='批次目录名（缺省=清空项目输出）')
        sp.add_argument('--format', choices=['json', 'text'], default='json', help='输出格式（默认 json）')
        sp.set_defaults(out_cmd=cmd)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    """CLI 入口：解析 → 执行 → 输出（stdout JSON/NDJSON/文本）

    将后端模块 print 重定向到 stderr，保证 stdout 仅含命令输出（与 engine 进程行为一致）。
    """
    import builtins as _builtins
    _orig_print = _builtins.print

    def _print(*args, **kwargs):
        kwargs.setdefault('file', sys.stderr)
        _orig_print(*args, **kwargs)

    _builtins.print = _print

    argv = list(sys.argv[1:] if argv is None else argv)

    # V3.1.0-T4-2: 域级调用自动注入默认子命令（单子命令域或存在 run），
    # 避免 argparse 把未知 option 值误当子命令 positional（如 `cli validate --config x`）
    _domains = build_domain_map()
    if argv and argv[0] in _domains:
        _subs = {_sub_name(a) for a in _domains[argv[0]]}
        _first = argv[1] if len(argv) > 1 else None
        if _first is None or _first not in _subs:
            if len(_subs) == 1:
                argv = [argv[0], sorted(_subs)[0]] + argv[1:]
            elif 'run' in _subs:
                argv = [argv[0], 'run'] + argv[1:]

    parser = build_parser()
    namespace, rest = parser.parse_known_args(argv)

    if getattr(namespace, 'domain', None) is None:
        parser.print_help()
        return 0

    domain = namespace.domain
    sub = getattr(namespace, 'sub', None)

    # 打磨轮（v1.5 / AL-C1a）：output 域（CLI 原生）
    if domain == 'output':
        out_cmd = getattr(namespace, 'out_cmd', None)
        if not out_cmd:
            print('output 请指定子命令：list / delete / clear', file=sys.stderr)
            return 0
        try:
            if out_cmd == 'list':
                result = cmd_output_list(namespace.project)
            elif out_cmd == 'clear':
                result = cmd_output_delete(namespace.project)
            else:  # delete
                result = cmd_output_delete(namespace.project, getattr(namespace, 'batch', None))
        except CLIError as e:
            print(str(e), file=sys.stderr)
            return 2
        if getattr(namespace, 'format', 'json') == 'json':
            sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        else:
            for k, v in result.items():
                sys.stdout.write(f"{k}: {json.dumps(v, ensure_ascii=False)}\n")
        return 0

    if sub is None:
        # 域级调用 → 单子命令域或存在 run 时自动执行，否则打印域帮助
        # 注意：顶层 parse_known_args 会把未知 option 的值误当作子命令 positional，
        # 故此处用 argv[1:]（去掉 domain token）交给目标 parser 完整重解析。
        domain_parsers: Dict[str, argparse.ArgumentParser] = \
            getattr(parser, '_run_parsers', {}).get(domain, {})
        if not domain_parsers:
            print(f"未知域: {domain}", file=sys.stderr)
            return 2
        if len(domain_parsers) == 1 or 'run' in domain_parsers:
            target = domain_parsers.get('run') or next(iter(domain_parsers.values()))
            namespace, rest = target.parse_known_args(argv[1:])
        else:
            domain_parser = getattr(getattr(parser, '_subparsers', None), '_name_parser_map', {}).get(domain)
            if domain_parser:
                domain_parser.print_help()
            else:
                print(f"域 {domain} 请指定子命令：{', '.join(sorted(domain_parsers))}", file=sys.stderr)
            return 0

    action = getattr(namespace, '_action', None)
    if action is None:
        parser.print_help()
        return 0

    fmt = getattr(namespace, 'format', 'json')
    try:
        params = _collect_params(namespace)
        result = execute(action, params, argv)
    except CLIError as e:
        print(str(e), file=sys.stderr)
        return 2
    except Exception as e:  # 兜底：避免裸 traceback 破坏 JSON 输出
        print(f"执行失败: {e}", file=sys.stderr)
        return 2

    if fmt == 'json':
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    elif fmt == 'ndjson':
        for line in result if isinstance(result, list) else [result]:
            sys.stdout.write(json.dumps(line, ensure_ascii=False) + '\n')
    else:  # text
        if isinstance(result, dict):
            for k, v in result.items():
                if isinstance(v, (dict, list)):
                    sys.stdout.write(f"{k}: {json.dumps(v, ensure_ascii=False)}\n")
                else:
                    sys.stdout.write(f"{k}: {v}\n")
        else:
            sys.stdout.write(f"{result}\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
