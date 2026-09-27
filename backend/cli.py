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
             'required': False,
             'help': '输出类型逗号分隔；缺省或 all = 全部（connections,deviceList,cablingGuide,bom,reportData,pdfReport,compliance）'},
            {'name': 'noArchive', 'flags': ['--no-archive'], 'type': 'bool_flag',
             'required': False,
             'help': '无副作用取值模式：不建 v<N>_<ts> 批次目录、不写 manifest、不做保留轮转'},
            {'name': 'regenerate', 'flags': ['--regenerate'], 'type': 'bool_flag',
             'required': False, 'help': '强制重算，忽略同配置指纹命中的既有批次'},
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
             'required': False, 'help': '关键词搜索（id/category/vendor/model/description）'},
            {'name': 'limit', 'flags': ['--limit'], 'type': int,
             'required': False, 'help': '最大返回数（默认 50）'},
        ],
    },
    # 5.2.2-522-a5（AL-E9）: 按设备库 id 精确取单台设备详情
    'device:get': {
        'sub': 'get',
        'domain': 'device',
        'params': [
            {'name': 'deviceId', 'flags': ['--id', '--device-id'], 'type': str,
             'required': True, 'help': '设备库 id（如 hygon_k100_ai / nvidia_dgx_h100）'},
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
    # M6: 项目/模板写操作（AI 对话内 CRUD + 基于模板创建 + 文件读写 + 模板推荐）
    'template:create': {
        'sub': 'create',
        'domain': 'template',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '新模板名'},
            {'name': 'config', 'flags': ['--config'], 'type': str,
             'required': True, 'help': '模板 ProjectConfig JSON 文件路径', 'file_json': True},
            {'name': 'description', 'flags': ['--description'], 'type': str,
             'required': False, 'help': '模板描述'},
            {'name': 'scenario', 'flags': ['--scenario'], 'type': str,
             'required': False, 'help': '场景'},
            {'name': 'overwrite', 'flags': ['--overwrite'], 'type': bool,
             'required': False, 'help': '同名覆盖（默认 False）'},
        ],
    },
    'template:update': {
        'sub': 'update',
        'domain': 'template',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '用户模板名'},
            {'name': 'config', 'flags': ['--config'], 'type': str,
             'required': True, 'help': '新 ProjectConfig JSON 文件路径', 'file_json': True},
        ],
    },
    'template:delete': {
        'sub': 'delete',
        'domain': 'template',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '用户模板名（内置只读）'},
        ],
    },
    'template:recommend': {
        'sub': 'recommend',
        'domain': 'template',
        'params': [
            {'name': 'protocol', 'flags': ['--protocol'], 'type': str,
             'required': False, 'help': '参数网协议（IB/RoCE/UEC）'},
            {'name': 'gpuModel', 'flags': ['--gpu-model'], 'type': str,
             'required': False, 'help': 'GPU 型号关键词'},
            {'name': 'scale', 'flags': ['--scale'], 'type': str,
             'required': False, 'help': '规模（GPU 服务器数）'},
        ],
    },
    'project:create': {
        'sub': 'create',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '新项目名'},
            {'name': 'description', 'flags': ['--description'], 'type': str,
             'required': False, 'help': '项目描述'},
            {'name': 'template', 'flags': ['--template'], 'type': str,
             'required': False, 'help': '基于的模板名（缺省默认配置）'},
        ],
    },
    'project:delete': {
        'sub': 'delete',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名（不可恢复）'},
        ],
    },
    'project:list-files': {
        'sub': 'list-files',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名'},
        ],
    },
    'project:read-file': {
        'sub': 'read-file',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名'},
            {'name': 'filePath', 'flags': ['--file-path'], 'type': str,
             'required': True, 'help': '项目内相对路径'},
        ],
    },
    'project:write-file': {
        'sub': 'write-file',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名'},
            {'name': 'filePath', 'flags': ['--file-path'], 'type': str,
             'required': True, 'help': '项目内相对路径'},
            {'name': 'content', 'flags': ['--content'], 'type': str,
             'required': True, 'help': '文件内容'},
        ],
    },
    # AI-4（M6c）: 模板/项目导入导出（对话内，落盘写操作）
    'template:export': {
        'sub': 'export',
        'domain': 'template',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '模板名（内置或用户模板）'},
            {'name': 'outputPath', 'flags': ['--output-path'], 'type': str,
             'required': False, 'help': 'zip 输出路径（缺省返回文件清单+内容）'},
        ],
    },
    'template:import': {
        'sub': 'import',
        'domain': 'template',
        'params': [
            {'name': 'source', 'flags': ['--source'], 'type': str,
             'required': True, 'help': '模板 zip 或目录路径'},
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': False, 'help': '导入后的模板名（缺省取 template.json）'},
            {'name': 'overwrite', 'flags': ['--overwrite'], 'type': bool,
             'required': False, 'help': '同名覆盖（默认 False）'},
        ],
    },
    'project:export': {
        'sub': 'export',
        'domain': 'project',
        'params': [
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': True, 'help': '项目名'},
            {'name': 'outputPath', 'flags': ['--output-path'], 'type': str,
             'required': False, 'help': 'zip 输出路径（缺省返回文件清单+内容）'},
        ],
    },
    'project:import': {
        'sub': 'import',
        'domain': 'project',
        'params': [
            {'name': 'source', 'flags': ['--source'], 'type': str,
             'required': True, 'help': '项目 zip 路径'},
            {'name': 'projectName', 'flags': ['--project-name'], 'type': str,
             'required': False, 'help': '导入后的项目名（缺省取 project.json）'},
            {'name': 'overwrite', 'flags': ['--overwrite'], 'type': bool,
             'required': False, 'help': '同名覆盖（默认 False）'},
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
    # ============================================================
    #  AL-P1-4（批次 C，2026-09-27）：补齐 22 条缺失 schema
    #  此前 45/67 action 有 schema，其余只能走通用 `--json` 兜底（无具名 flag、
    #  无 --help 参数说明）。下列补齐 ai:* / aidc:project:* / plan:aidc:* /
    #  skills:* / rack:optimize / share:snapshot / design:from-gpus / cli:info。
    #  未列出 params 的（如 ai:providers / cli:info）为**无参 action**，显式给空列表
    #  以「声明式登记」并消除「未登记」歧义。
    # ============================================================
    'ai:chat': {
        'params': [
            {'name': 'message', 'flags': ['--message', '-m'], 'type': str,
             'required': True, 'help': '用户消息文本'},
            {'name': 'sessionId', 'flags': ['--session-id'], 'type': str,
             'required': False, 'help': '会话 ID（默认 default）'},
            {'name': 'mode', 'flags': ['--mode'], 'type': str,
             'required': False, 'help': '对话模式（默认 general）'},
            {'name': 'provider', 'flags': ['--provider'], 'type': str,
             'required': False, 'help': '指定 AI Provider（缺省用默认）'},
            {'name': 'model', 'flags': ['--model'], 'type': str,
             'required': False, 'help': '指定模型'},
            {'name': 'autonomyMode', 'flags': ['--autonomy-mode'], 'type': str,
             'required': False, 'help': '自主度（semi_auto / full_auto 等，默认 semi_auto）'},
            {'name': 'projectName', 'flags': ['--project-name', '--project'], 'type': str,
             'required': False, 'help': '关联项目名（给 AI 上下文）'},
        ],
    },
    'ai:providers': {'params': []},
    'ai:config': {
        'params': [
            {'name': 'provider', 'flags': ['--provider'], 'type': str,
             'required': True, 'help': 'Provider 名（openai / deepseek / …）'},
            {'name': 'apiKey', 'flags': ['--api-key'], 'type': str,
             'required': False, 'help': 'API 密钥（BYO-Key；审计中脱敏）'},
            {'name': 'model', 'flags': ['--model'], 'type': str,
             'required': False, 'help': '默认模型'},
            {'name': 'baseUrl', 'flags': ['--base-url'], 'type': str,
             'required': False, 'help': '自定义端点（OpenAI 兼容）'},
        ],
    },
    'ai:config-default': {
        'params': [
            {'name': 'provider', 'flags': ['--provider'], 'type': str,
             'required': True, 'help': '设为默认的 Provider 名'},
        ],
    },
    'ai:test': {
        'params': [
            {'name': 'provider', 'flags': ['--provider'], 'type': str,
             'required': True, 'help': '待测试的 Provider 名'},
            {'name': 'apiKey', 'flags': ['--api-key'], 'type': str,
             'required': False, 'help': 'API 密钥（BYO-Key；审计中脱敏）'},
            {'name': 'baseUrl', 'flags': ['--base-url'], 'type': str,
             'required': False, 'help': '自定义端点'},
            {'name': 'model', 'flags': ['--model'], 'type': str,
             'required': False, 'help': '测试用模型'},
        ],
    },
    'ai:models': {
        'params': [
            {'name': 'baseUrl', 'flags': ['--base-url'], 'type': str,
             'required': True, 'help': 'OpenAI 兼容端点（拉取 /models）'},
            {'name': 'apiKey', 'flags': ['--api-key'], 'type': str,
             'required': False, 'help': 'API 密钥（BYO-Key；审计中脱敏）'},
        ],
    },
    'ai:clear': {
        'params': [
            {'name': 'sessionId', 'flags': ['--session-id'], 'type': str,
             'required': False, 'help': '待清除的会话 ID（默认 default）'},
        ],
    },
    'aidc:project:create': {
        'params': [
            {'name': 'projectDir', 'flags': ['--project-dir'], 'type': str,
             'required': True, 'help': 'AIDC 项目目录（workspace/<name>/）'},
            {'name': 'name', 'flags': ['--name'], 'type': str,
             'required': False, 'help': '项目名'},
            {'name': 'projectId', 'flags': ['--project-id'], 'type': str,
             'required': False, 'help': '显式 projectId（缺省自动 mint）'},
            {'name': 'macro', 'flags': ['--macro'], 'type': str,
             'required': False, 'help': '宏观参数字典 JSON（{gpu_count, site, …}）', 'file_json': True},
        ],
    },
    'aidc:project:init': {
        'params': [
            {'name': 'projectDir', 'flags': ['--project-dir'], 'type': str,
             'required': True, 'help': '普通项目目录（转为 AIDC：mint projectId + plan.json）'},
            {'name': 'macro', 'flags': ['--macro'], 'type': str,
             'required': False, 'help': '宏观参数字典 JSON（aidc_macro 注入）', 'file_json': True},
        ],
    },
    'aidc:project:save': {
        'params': [
            {'name': 'projectDir', 'flags': ['--project-dir'], 'type': str,
             'required': True, 'help': 'AIDC 项目目录（重新生成 plan）'},
            {'name': 'macro', 'flags': ['--macro'], 'type': str,
             'required': False, 'help': '宏观参数字典 JSON（planHash 变化 → planVersion+1）', 'file_json': True},
        ],
    },
    'aidc:project:load': {
        'params': [
            {'name': 'projectDir', 'flags': ['--project-dir'], 'type': str,
             'required': True, 'help': 'AIDC 项目目录（读元数据 + 最近 plan + macro）'},
        ],
    },
    'aidc:project:list': {
        'params': [
            {'name': 'workspaceDir', 'flags': ['--workspace-dir'], 'type': str,
             'required': True, 'help': '工作区目录（列出其下所有 AIDC 项目）'},
        ],
    },
    'plan:aidc': {
        'params': [
            {'name': 'macro', 'flags': ['--macro'], 'type': str,
             'required': True, 'help': '宏观参数字典 JSON（site/gpu_count/pfc_queue/cnp_queue/convergence…）',
             'file_json': True},
        ],
    },
    'plan:aidc:export': {
        'params': [
            {'name': 'filepath', 'flags': ['--filepath', '--output'], 'type': str,
             'required': True, 'help': '导出目标路径'},
            # 注：不得用 --format（与 CLI 全局输出形态 --format json/ndjson/text 撞名），
            # 故改名 --export-format；params 键仍为 'format'（handler 消费口径不变）。
            {'name': 'format', 'flags': ['--export-format'], 'type': str,
             'required': False, 'help': '导出格式 json / excel（默认 json）'},
            {'name': 'plan', 'flags': ['--plan'], 'type': str,
             'required': False, 'help': 'plan 宏观参数 JSON 文件（site/gpu_count/…）', 'file_json': True},
        ],
    },
    'plan:aidc:import': {
        'params': [
            {'name': 'plan', 'flags': ['--plan', '--plan-file'], 'type': str,
             'required': True, 'help': '外部 plan:table JSON 文件（校验/归一化）', 'file_json': True},
        ],
    },
    'design:from-gpus': {
        'params': [
            {'name': 'macro', 'flags': ['--macro'], 'type': str,
             'required': True, 'help': '宏观参数字典 JSON（GPU 规模 + 宏观参数）', 'file_json': True},
        ],
    },
    'rack:optimize': {
        'params': [
            {'name': 'cabinets', 'flags': ['--cabinets'], 'type': str,
             'required': True, 'help': '现有柜 JSON 文件（[{id,type,totalU,power_limit,devices}]）',
             'file_json': True},
            {'name': 'unplaced_devices', 'flags': ['--unplaced-devices'], 'type': str,
             'required': True, 'help': '待上架设备池 JSON 文件（[{id,type,height,power_watts}]）',
             'file_json': True},
            {'name': 'gpu_per_cabinet', 'flags': ['--gpu-per-cabinet'], 'type': int,
             'required': False, 'help': 'GPU 每柜台数上限（默认 1 柜 1 台）'},
        ],
    },
    'share:snapshot': {
        'params': [
            {'name': 'configFile', 'flags': ['--config', '--config-file'], 'type': str,
             'required': True, 'help': 'project_config.json 或 network_config.ini 路径'},
            {'name': 'estimateParams', 'flags': ['--estimate-params'], 'type': str,
             'required': False, 'help': '估算参数 JSON 文件', 'file_json': True},
        ],
    },
    'skills:list': {'params': []},
    'skills:export': {
        'params': [
            {'name': 'filepath', 'flags': ['--filepath', '--output'], 'type': str,
             'required': True, 'help': '导出 zip 路径'},
        ],
    },
    'skills:import': {
        'params': [
            {'name': 'zipPath', 'flags': ['--zip-path', '--zip'], 'type': str,
             'required': True, 'help': '技能包 zip 路径'},
            {'name': 'overwrite', 'flags': ['--overwrite'], 'type': 'bool_flag',
             'required': False, 'help': '覆盖同名技能'},
        ],
    },
    'cli:info': {'params': []},
}


# ================================================================
#  工具函数
# ================================================================

def _sub_path(action: str) -> List[str]:
    """子命令**路径**（多级）：三段式 action 拆为真二级子命令。

    批次 B（CLI-O6，2026-09-27 大师裁定 (a) 多级子命令树）：
      'aidc:project:create' → ['project', 'create']   （aidc project create）
      'plan:aidc:export'    → ['aidc', 'export']      （plan aidc export）
      'design' / 'project:list'（两段式）→ 末段单级

    规则：域取第一段（见 _domain_of），其余段全部作子命令路径（逐段 '_'→'-'）。
    schema 的 'sub' 若显式指定则覆盖为单级（保持既有显式声明优先）。
    """
    schema = ACTION_PARAM_SCHEMA.get(action)
    if schema and schema.get('sub'):
        return [schema['sub']]
    if ':' in action:
        rest = action.split(':', 1)[1]
        return [seg.replace('_', '-') for seg in rest.split(':') if seg]
    return ['run']


def _sub_name(action: str) -> str:
    """子命令名（**末级**，兼容旧调用）：多级路径取最后一段。

    保留此函数名以兼容既有引用；新代码请优先用 :func:`_sub_path`。
    """
    path = _sub_path(action)
    return path[-1] if path else 'run'


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


def _redact_argv(argv: Optional[List[str]]) -> List[str]:
    """AL-S4: 审计脱敏 argv——CLI 可能以 `--api-key=sk-xxx` / `--json '{"api_key": "..."}'` 传密钥，需在落盘前脱敏"""
    if not argv:
        return list(argv or [])
    result: List[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        # --key=value 内联形式
        m = re.match(r'(?i)^(--[a-z0-9_-]*(?:key|token|secret|password)[a-z0-9_-]*)=(.*)$', arg)
        if m:
            result.append(f'{m.group(1)}=***')
            i += 1
            continue
        # --key value 分离形式（下一项为值）
        if re.match(r'(?i)^--[a-z0-9_-]*(?:key|token|secret|password)[a-z0-9_-]*$', arg) and i + 1 < len(argv):
            result.append(arg)
            result.append('***')
            i += 2
            continue
        # JSON 对象字面量（含敏感键 → 值全部脱敏）
        if arg.startswith('{') and any(s in arg.lower() for s in _SENSITIVE_KEYS):
            try:
                obj = json.loads(arg)
                if isinstance(obj, dict):
                    result.append(json.dumps(_redact(obj), ensure_ascii=False))
                    i += 1
                    continue
            except Exception:
                pass
        result.append(arg)
        i += 1
    return result


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
            'argv': _redact_argv(argv),
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


# ================================================================
#  5.2.2-522-e1：退出码契约（docs/cli.md「退出码」为准）
#  ================================================================
#  破坏性变更（DP-AL-02 定稿）：严格退出码为唯一行为，不提供兼容开关。
#  handler 以 `{"error": ..., "error_code": ...}` 表达业务失败（见 engine.err），
#  main() 依 error_code 判定退出码；未标码的失败兜底为 EXIT_EXEC。
EXIT_OK = 0        # 成功
EXIT_INTERNAL = 1  # 内部异常（未预期异常）
EXIT_USAGE = 2     # 参数或配置错误
EXIT_EXEC = 3      # 执行失败

_ERR_CODE_TO_EXIT = {
    'AL_ERR_CONFIG': EXIT_USAGE,
    'AL_ERR_INVALID_ARGS': EXIT_USAGE,
    'AL_ERR_EXEC': EXIT_EXEC,
    'AL_ERR_EMPTY_RESULT': EXIT_EXEC,
    'AL_ERR_INTERNAL': EXIT_INTERNAL,
}


def classify_exit(result: Any) -> int:
    """按 handler 返回结果判定退出码。

    5.2.2 契约：业务失败不再返回 0。判定顺序：
      1) 返回体含 `error` → 按 error_code 映射（未知码兜底 EXIT_EXEC）
      2) 返回体显式 `success is False` → EXIT_EXEC
      3) 其余 → EXIT_OK

    V5.4.3-W1.3（修复单 R3）说明：design 等返回体的 `valid` 字段与 `validationIssues`
    （含 V001~V023 结构性 ERROR）已在返回体**非阻断透出**（R3 期望修复 #1 原文
    「哪怕不阻断」）；结构性错误对发布门禁的阻断由 validate_templates.py 消费
    V 规则集实现（R3 期望修复 #2/#3），不通过退出码隐式承担，避免 V002 等
    商务口径类既有告警改变 CLI 退出码语义。
    """
    if isinstance(result, dict):
        if result.get('error'):
            return _ERR_CODE_TO_EXIT.get(result.get('error_code') or '', EXIT_EXEC)
        if result.get('success') is False:
            return EXIT_EXEC
        if not result:  # {} —— 空结果视为无声失败
            return EXIT_EXEC
        return EXIT_OK
    if result is None:  # 无返回 —— 无声失败
        return EXIT_EXEC
    if isinstance(result, (list, tuple)) and len(result) == 0:  # [] —— 空结果
        return EXIT_EXEC
    return EXIT_OK


def error_message(result: Any) -> str:
    """取失败结果的可读原因（供 stderr 提示）"""
    if isinstance(result, dict):
        return str(result.get('error') or '执行失败')
    return '执行失败'


def execute(action: str, params: Optional[Dict[str, Any]], argv: Optional[List[str]] = None) -> Any:
    """执行 action：校验 handler → 审计 → 调 handler

    engine.main() 与 cli main 共用此入口（UI 与 CLI 行为一致）。

    ⚠️ AL-P1-2（批次 C）修复：审计 `ok` 必须反映**业务成败**，而非「handler 未抛异常」。
    此前 `audit_log(..., ok=True)` 在拿到 handler 返回体**之前**无条件写入 ⇒ handler
    以「正常返回失败体」表达失败时（`{"error": ...}` / `success: false` / 空结果，
    即 :func:`exit_code_for` 判为 3 的情形）仍被记 `ok:true`，审计日志失真。
    现改为：先取结果，用 :func:`classify_exit` 判定，`ok = (code == EXIT_OK)`。
    """
    handler = get_action_handler(action)
    if handler is None:
        raise CLIError(f"未知 action: {action}")
    params = dict(params or {})
    try:
        result = handler(params)
    except Exception as e:
        audit_log(action, params, argv, ok=False, error=str(e))
        raise CLIError(f"action {action} 执行失败: {e}") from e

    # 业务成败以返回体判定（与退出码同源），失败体记 ok=False 并留痕原因
    code = classify_exit(result)
    if code == EXIT_OK:
        audit_log(action, params, argv, ok=True)
    else:
        audit_log(action, params, argv, ok=False, error=error_message(result))
    return result


# ================================================================
#  argparse 动态路由
# ================================================================

def _add_action_parser(subparsers, domain: str, action: str,
                       name: Optional[str] = None) -> argparse.ArgumentParser:
    """为单个 action 构建子命令 parser（含 schema flags + --json 兜底 + --format）

    ``name`` 显式指定子命令名（多级树的末级）；缺省取 :func:`_sub_name`。
    """
    schema = ACTION_PARAM_SCHEMA.get(action, {})
    sub = name if name is not None else _sub_name(action)
    help_text = schema.get('help') or f"执行 {action} action"
    parser = subparsers.add_parser(sub, help=help_text, description=f"{action} — {help_text}")
    for p in schema.get('params', []):
        # required 不在此强制（--json 兜底时允许缺失），改为 _collect_params 后统一校验
        if p.get('nargs'):
            parser.add_argument(*p['flags'], dest=p['name'], nargs=p['nargs'], type=p['type'],
                                help=p['help'])
        elif p['type'] == bool or p['type'] == 'bool_flag':
            # 'bool_flag'：schema 里显式表达的开关（store_true），避免 type=bool 的
            # 「任何非空字符串都为 True」陷阱（如 --flag false 会被当成 True）
            parser.add_argument(*p['flags'], dest=p['name'], action='store_true', help=p['help'])
        else:
            parser.add_argument(*p['flags'], dest=p['name'], type=p['type'], help=p['help'])
    parser.add_argument('--json', type=str, default=None,
                        help="JSON 字符串作为 params（flags 优先覆盖；无 schema 的 action 通用入口）")
    parser.add_argument('--format', choices=['json', 'ndjson', 'text'], default='json',
                        help="输出格式（默认 json）")
    parser.set_defaults(_action=action, _domain=domain)
    return parser


def _domain_parser_map(parser: argparse.ArgumentParser) -> Dict[str, argparse.ArgumentParser]:
    """取 parser 下的子命令 {名: 子 parser}（稳健版）。

    argparse 的 ``parser._subparsers`` 是 ``_ArgumentGroup``（不是 _SubParsersAction），
    真正的选择表在 ``._subparsers._group_actions[0].choices``。旧代码用
    ``._subparsers._name_parser_map`` 恒取不到 ⇒ 域帮助/子命令帮助一直打印不出来。
    """
    group = getattr(parser, '_subparsers', None)
    actions = getattr(group, '_group_actions', None) or []
    if not actions:
        return {}
    return dict(getattr(actions[0], 'choices', {}) or {})


def build_parser() -> argparse.ArgumentParser:
    """构建完整 parser：域（subparsers）→ 子命令路径（多级）→ action parser

    批次 B：三段式 action 展开为真二级子命令，如 ``aidc project create``。
    ``_run_parsers`` 由 {sub_name: parser} 改为 {sub_path_tuple: parser}，
    并在 ``_domain_names`` 保留各域的合法子路径首段集合（供域级注入判定）。
    """
    parser = argparse.ArgumentParser(
        prog='autolink-cli',
        description='AutoLink 显式 CLI 能力层（与 GUI 行为一致）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--version', action='version', version=f'autolink-cli {CLI_VERSION}')
    subparsers = parser.add_subparsers(dest='domain', metavar='<domain>')
    run_parsers: Dict[str, Dict[tuple, argparse.ArgumentParser]] = {}
    domain_names: Dict[str, set] = {}
    for domain, actions in build_domain_map().items():
        domain_parser = subparsers.add_parser(domain, help=f"{domain} 域命令")
        action_sub = domain_parser.add_subparsers(dest='sub', metavar='<command>')
        # 多级树：按路径前缀逐级展开。若某前缀本身是完整 action
        # （如 `plan aidc` 与 `plan aidc export` 共存），则复用该 action parser
        # 并为其挂 subparsers —— argparse 不允许同名节点重复 add_parser。
        level_sub: Dict[tuple, argparse._SubParsersAction] = {(): action_sub}
        node_parser: Dict[tuple, argparse.ArgumentParser] = {}
        # 先建单级（保证被引用的前缀 action 已存在），再建多级
        ordered = sorted(actions, key=lambda a: (len(_sub_path(a)), _sub_path(a)))
        for action in ordered:
            path = tuple(_sub_path(action))
            if len(path) == 1:
                p = _add_action_parser(action_sub, domain, action, name=path[0])
                run_parsers.setdefault(domain, {})[path] = p
                node_parser[path] = p
                domain_names.setdefault(domain, set()).add(path[0])
                continue
            # 逐级确保中间节点存在
            for i in range(1, len(path)):
                prefix = path[:i]
                if prefix in level_sub:
                    continue
                parent_sub = level_sub[path[:i - 1]]
                seg = path[i - 1]
                if prefix in node_parser:
                    # 前缀是完整 action（如 plan aidc）→ 复用其 parser 并挂子命令
                    node = node_parser[prefix]
                else:
                    node = parent_sub.add_parser(seg, help=f"{seg} 子命令组")
                level_sub[prefix] = node.add_subparsers(
                    dest=f'sub{i}', metavar='<subcommand>')
                if i == 1:
                    domain_names.setdefault(domain, set()).add(seg)
            # 末级 action
            leaf_sub = level_sub[path[:-1]]
            p = _add_action_parser(leaf_sub, domain, action, name=path[-1])
            run_parsers.setdefault(domain, {})[path] = p
            node_parser[path] = p
    parser._run_parsers = run_parsers  # 域级缺省 run 用（内部）
    parser._domain_names = domain_names  # 各域合法子路径首段（内部）
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
    """CLI 入口（进程副作用隔离包装）→ 见 _main_impl

    5.2.2-522-e12（AL-E12）：后端模块的 print 需改道 stderr，保证 stdout 仅含命令输出。
    旧实现直接改写 ``builtins.print`` 且**从不还原**，属于进程级永久副作用：
    库内调用 main()（如测试、engine 复用）后，整个进程后续的 print 都被污染。
    此处改为「替换 → finally 还原」，作用域严格限于一次调用。
    """
    import builtins as _builtins
    _orig_print = _builtins.print

    def _print(*args, **kwargs):
        kwargs.setdefault('file', sys.stderr)
        _orig_print(*args, **kwargs)

    _builtins.print = _print
    try:
        return _main_impl(argv)
    finally:
        _builtins.print = _orig_print


def _main_impl(argv: Optional[List[str]] = None) -> int:
    """CLI 主体：解析 → 执行 → 输出（stdout JSON/NDJSON/文本）"""
    argv = list(sys.argv[1:] if argv is None else argv)

    # V3.1.0-T4-2: 域级调用自动注入默认子命令（单子命令域或存在 run），
    # 避免 argparse 把未知 option 值误当子命令 positional（如 `cli validate --config x`）
    # 批次 B：域下子命令首段可能为多级树中间节点（aidc → project → create），
    # 注入判定用「首段集合」而非「完整子名集合」。
    _domains = build_domain_map()
    if argv and argv[0] in _domains:
        _heads = {(tuple(_sub_path(a))[0]) for a in _domains[argv[0]]}
        _first = argv[1] if len(argv) > 1 else None
        if _first is None or (_first not in _heads and _first not in ('-h', '--help')):
            if len(_heads) == 1:
                argv = [argv[0], sorted(_heads)[0]] + argv[1:]
            elif 'run' in _heads:
                argv = [argv[0], 'run'] + argv[1:]

    parser = build_parser()
    namespace, rest = parser.parse_known_args(argv)

    if getattr(namespace, 'domain', None) is None:
        parser.print_help()
        return EXIT_OK

    domain = namespace.domain
    sub = getattr(namespace, 'sub', None)

    # 打磨轮（v1.5 / AL-C1a）：output 域（CLI 原生）
    if domain == 'output':
        out_cmd = getattr(namespace, 'out_cmd', None)
        if not out_cmd:
            print('output 请指定子命令：list / delete / clear', file=sys.stderr)
            return EXIT_OK
        try:
            if out_cmd == 'list':
                result = cmd_output_list(namespace.project)
            elif out_cmd == 'clear':
                result = cmd_output_delete(namespace.project)
            else:  # delete
                result = cmd_output_delete(namespace.project, getattr(namespace, 'batch', None))
        except CLIError as e:
            # 名称非法 / 批次不存在 —— 参数错误
            print(str(e), file=sys.stderr)
            return EXIT_USAGE
        code = classify_exit(result)
        if getattr(namespace, 'format', 'json') == 'json':
            sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        else:
            for k, v in result.items():
                sys.stdout.write(f"{k}: {json.dumps(v, ensure_ascii=False)}\n")
        if code != EXIT_OK:
            print(error_message(result), file=sys.stderr)
        return code

    if sub is None:
        # 域级调用 → 单子命令域或存在 run 时自动执行，否则打印域帮助
        # 注意：顶层 parse_known_args 会把未知 option 的值误当作子命令 positional，
        # 故此处用 argv[1:]（去掉 domain token）交给目标 parser 完整重解析。
        # 批次 B：`_run_parsers` 键为子路径 tuple（(name,) 或 (head, tail...)）。
        domain_parsers: Dict[tuple, argparse.ArgumentParser] = \
            getattr(parser, '_run_parsers', {}).get(domain, {})
        if not domain_parsers:
            print(f"未知域: {domain}", file=sys.stderr)
            return EXIT_USAGE
        _singles = {k[0] for k in domain_parsers if len(k) == 1}
        if len(domain_parsers) == 1 or ('run',) in domain_parsers:
            target = domain_parsers.get(('run',)) or next(iter(domain_parsers.values()))
            namespace, rest = target.parse_known_args(argv[1:])
        else:
            domain_parser = _domain_parser_map(parser).get(domain)
            if domain_parser:
                domain_parser.print_help()
            else:
                heads = sorted({k[0] for k in domain_parsers})
                print(f"域 {domain} 请指定子命令：{', '.join(heads)}", file=sys.stderr)
            return 0

    action = getattr(namespace, '_action', None)
    if action is None:
        # 批次 B：命中了中间节点（子命令组）或注入后仍未落到 action ⇒ 打印**该层级**帮助，
        # 而非顶层帮助（旧实现一律 print_help() 顶层，导致 `aidc` 看不到子命令清单）。
        # 注意：argparse 的 ``parser._subparsers`` 是 _ArgumentGroup，真正的选择表在
        # ``._subparsers._group_actions[0].choices``（旧代码用 _name_parser_map 恒取不到 ⇒
        # 域级帮助一直打不出来的根因）。
        node = _domain_parser_map(parser).get(domain)
        for lvl_dest in ('sub', 'sub2', 'sub3'):
            seg = getattr(namespace, lvl_dest, None)
            if not seg or node is None:
                break
            nxt = _domain_parser_map(node)
            if seg not in nxt:
                break
            node = nxt[seg]
        (node or parser).print_help()
        return 0

    fmt = getattr(namespace, 'format', 'json')
    # 阶段一：参数收集（--json 解析失败 / 缺必填 / 文件读取失败 → 参数错误 2）
    try:
        params = _collect_params(namespace)
    except CLIError as e:
        print(str(e), file=sys.stderr)
        return EXIT_USAGE
    except Exception as e:  # 兜底：避免裸 traceback 破坏 JSON 输出
        print(f"参数解析失败: {e}", file=sys.stderr)
        return EXIT_USAGE

    # 阶段二：执行（handler 抛未预期异常 → 内部错误 1）
    try:
        result = execute(action, params, argv)
    except CLIError as e:
        print(str(e), file=sys.stderr)
        return EXIT_INTERNAL
    except Exception as e:  # 兜底：避免裸 traceback 破坏 JSON 输出
        print(f"执行失败: {e}", file=sys.stderr)
        return EXIT_INTERNAL

    # 阶段三：按结果判定退出码（业务失败 / 空结果不再返回 0）
    exit_code = classify_exit(result)

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

    if exit_code != EXIT_OK:
        # 失败原因同时输出到 stderr（stdout 仍保留结构化 JSON，便于下游解析）
        print(f"[{result.get('error_code', 'AL_ERR_EXEC') if isinstance(result, dict) else 'AL_ERR_EXEC'}] "
              f"{error_message(result)}", file=sys.stderr)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
