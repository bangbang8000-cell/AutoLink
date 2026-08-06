# AutoLink CLI 显式能力层（autolink-cli）

> 版本：1.0.0（v3.1.0-T4）
> 说明：AutoLink 全部后端能力对外的显式命令行接口。UI 与 CLI 共用同一执行路径（`engine.main()` stdin 路由经 `cli.execute()`），命令行为与图形界面完全一致。

## 1. 概览

- **注册表驱动**：CLI 子命令树由 `backend/engine.py` 的 action 注册表自动构建（`a:b` → `a b`，如 `room:create` → `room create`）。新增 action 零改动自动获得 CLI 命令。
- **同一执行路径**：`backend/cli.py` 的 `execute(action, params)` 是唯一执行入口，GUI（Electron → Python 引擎 stdin 路由）与 CLI 均经此调用。
- **参数 schema**：`ACTION_PARAM_SCHEMA` 定义常用 flag；未配置 schema 的 action 自动降级使用通用 `--json '<params>'` 入口。
- **审计**：每次执行写 `cli-audit.jsonl`（时间 / action / 命令 / 参数脱敏 / 结果）。

## 2. 环境与运行

CLI 是 `backend/` 下的 Python 模块，与引擎共用同一运行环境（Python 3.10+，依赖见 `backend/requirements.txt`）。

```bash
cd backend
python -m cli --version        # autolink-cli 1.0.0
python -m cli --help           # 列出全部域
```

打包后（PyInstaller 收集 backend 模块）可通过内置模块或独立入口调用；独立 `autolink-cli` 可执行文件不在本版本范围（后续 3.1.x 可选）。

## 3. 域速查表（18 域 37 action，注册表自动发现）

| 域 | 子命令 | action | 说明 |
|----|--------|--------|------|
| `design` | `generate` | `design` | 网络拓扑自动设计（自动选型 + 拓扑生成） |
| `estimate` | `run`（可省略） | `estimate` | 规模估算 |
| `report` | `run`（可省略） | `report` | 生成设计报告 |
| `validate` | `run`（可省略） | `validate` | 设计配置校验 |
| `project-config` | `migrate` | `migrate` | INI → JSON 项目配置迁移 |
| `project-config` | `to-ini` | `project_config_to_ini` | JSON 项目配置反向序列化为 network_config.ini |
| `export` | `run`（可省略） | `export` | 导出交付物（连接表/设备清单/布线指南/BOM/报告） |
| `room` | `create` | `room:create` | 创建机房矩阵 |
| `room` | `validate` | `room:validate` | 校验机房布局 |
| `room` | `optimize` | `room:optimize` | 机房布局自动优化 |
| `room` | `place` | `room:place` | 设备落位放置 |
| `config` | `list-schema` | `config:list-schema` | 列出统一配置 schema 与场景预设 |
| `config` | `apply-preset` | `config:apply-preset` | 应用场景预设（ib-allflash 等） |
| `config` | `export` | `config:export` | 导出配置包裹（appSettings + projectConfig） |
| `config` | `import` | `config:import` | 导入配置包裹 |
| `ai` | `chat` | `ai:chat` | AI 对话（AIHUB） |
| `ai` | `providers` | `ai:providers` | 列出 AI Provider |
| `ai` | `config` | `ai:config` | 读写 AI 配置（含 Provider 密钥） |
| `ai` | `test` | `ai:test` | 测试 Provider 连接 |
| `ai` | `models` | `ai:models` | 列出 Provider 模型 |
| `ai` | `clear` | `ai:clear` | 清空 AI 会话 |
| `device` | `list` | `device:list` | 设备库列表 |
| `device` | `defaults` | `device:defaults` | 设备默认值 |
| `template` | `list` | `template:list` | 模板列表 |
| `template` | `view` | `template:view` | 模板详情 |
| `project` | `list` | `project:list` | 项目列表 |
| `project` | `info` | `project:info` | 项目信息 |
| `project` | `generate` | `project:generate` | 一键生成项目 |
| `file` | `parse` | `file:parse` | 示例文件解析（Excel/JSON/CSV/文本） |
| `capacity` | `list-presets` | `capacity:list-presets` | 容量规划档案清单（17 档案含国产场景） |
| `capacity` | `recommend` | `capacity:recommend` | 容量规划推荐（Scale-Up/Out + TCO） |
| `atop` | `recommend` | `atop:recommend` | ATOP 拓扑推荐（ZCube 2D/3D） |
| `optimize` | `suggest` | `optimize:suggest` | 批量优化建议 |
| `optimize` | `apply` | `optimize:apply` | 应用优化建议 |
| `repair` | `plan` | `repair:plan` | 校验错误修复方案 |
| `repair` | `apply` | `repair:apply` | 应用修复（复核闭环） |
| `cli` | `info` | `cli:info` | CLI 版本 + 全部 action 清单 |

> 单子命令域（estimate / report / validate / export）可省略子命令：`autolink-cli validate --config x.json` 等价于 `autolink-cli validate run --config x.json`。

## 4. 命令示例

所有命令默认输出 JSON（`--format json`），可用 `--format ndjson` / `--format text` 切换。

### 4.1 design generate — 网络拓扑自动设计

```bash
python -m cli design generate --config project_config.json
python -m cli design generate --config network_config.ini
python -m cli design generate --config project_config.json --format text
```

输出：完整网络设计方案（自动选型决策、拓扑、设备清单、收敛比等），与 GUI「一键设计」结果一致。

### 4.2 estimate — 规模估算

```bash
python -m cli estimate run --config project_config.json
python -m cli estimate --config project_config.json      # 等价（run 自动注入）
```

### 4.3 report — 设计报告

```bash
python -m cli report run --config project_config.json
python -m cli report --config project_config.json
```

### 4.4 validate — 设计配置校验

```bash
python -m cli validate run --config project_config.json
python -m cli validate --config project_config.json      # 校验通过输出 {valid: true}
```

校验失败时输出 `{valid: false, errors: [...]}`，错误以退出码 2 + stderr 提示。

### 4.5 project-config migrate — INI → JSON 迁移

```bash
python -m cli project-config migrate --project-dir D:\Projects\my_dc
```

将项目目录中的 `network_config.ini` 迁移为 `project_config.json`（不覆盖已有配置）。

### 4.6 project-config to-ini — JSON → INI 反向序列化

```bash
python -m cli project-config to-ini --config-file project_config.json
```

输出 `network_config.ini` 文本，可重定向保存：

```bash
python -m cli project-config to-ini --config-file project_config.json > network_config.ini
```

### 4.7 export — 导出交付物

```bash
python -m cli export run --config project_config.json --output-dir ./output \
  --output-types connections,deviceList,cablingGuide,bom,reportData
python -m cli export --config project_config.json        # 缺省输出类型全部导出
```

`--output-types` 可选：`connections`（连接表）、`deviceList`（设备清单）、`cablingGuide`（布线指南）、`bom`（物料清单）、`reportData`（报告数据）、`pdfReport`（PDF 报告）。

### 4.8 room create — 创建机房矩阵

```bash
python -m cli room create --rows A B C --cols 1 2 3 --name 机房A
```

输出矩阵 cells（每格含 type / placeholder / cabinetId），与 GUI「机房矩阵」一致。

### 4.9 room validate — 校验机房布局

```bash
python -m cli room validate --layout room_layout.json
```

校验占位冲突 / 类型域 / U 位 / 功率，输出 `{valid, errors}`。

### 4.10 config list-schema — 配置 schema 与预设

```bash
python -m cli config list-schema
```

输出四类配置模型字段 + 场景预设清单（ib-allflash / roce-general / l20-inference / uec-datacenter）。

### 4.11 config apply-preset — 应用场景预设

```bash
python -m cli config apply-preset --preset-id ib-allflash
python -m cli config apply-preset --preset-id ib-allflash --config project_config.json
```

### 4.12 config export / import — 配置包裹导出导入

```bash
python -m cli config export --app-settings app_settings.json --project-config project_config.json > config-backup.json
python -m cli config import --payload config-backup.json
```

导出包裹格式为 `autolink-config`（format + version + exportedAt + appSettings + projectConfig）。

### 4.13 cli info — 能力信息

```bash
python -m cli cli info
```

输出 CLI 版本与注册表全部 action 清单（GUI 内部「关于/诊断」复用同一数据）。

### 4.14 v3.1.x+ 新增域示例（AI / 容量规划 / ATOP / 优化 / 修复）

```bash
# AI 对话（AIHUB）
python -m cli ai chat --provider openai --model gpt-4o-mini --message "为 1024 张 H800 设计网络"
python -m cli ai providers                                   # 列出 9 大厂商 Provider

# 容量规划（17 档案，含国产场景）
python -m cli capacity list-presets
python -m cli capacity recommend --preset h800-llama2-70b --gpu-count 1024

# ATOP 拓扑推荐（ZCube 2D/3D）
python -m cli atop recommend --preset h800-llama2-70b --gpu-count 2048

# 批量优化与智能修复（复核闭环）
python -m cli optimize suggest --config project_config.json
python -m cli optimize apply  --config project_config.json --items '["opt-1"]'
python -m cli repair plan --config project_config.json
python -m cli repair apply --config project_config.json --fixes '["fix-1"]'
```

## 5. 输出格式

| 格式 | 行为 |
|------|------|
| `json`（默认） | 结果整体 JSON 序列化（缩进 2） |
| `ndjson` | 结果为列表时逐行输出 JSON，否则单行 |
| `text` | 键值对逐行输出（嵌套值 JSON 序列化） |

**stdout 仅含命令输出**：后端模块的调试 print 被重定向到 stderr，保证管道解析安全（与引擎子进程行为一致）。

## 6. 通用 `--json` 兜底

任何 action（含未配置 schema 的新 action）都可用 `--json` 直接传参，flags 优先覆盖：

```bash
python -m cli design --json '{"configFile": "project_config.json"}'
python -m cli room create --json '{"rows": ["A", "B"], "cols": [1, 2]}'
```

注意：使用 `--json` 时跳过 required 校验（信任 JSON 内容）；未使用 `--json` 时缺必填参数会报错并退出码 2。

## 7. GUI 等价性

```
GUI (Electron) ── python.service.ts ── stdin ──► engine.main()
                                                  │  action = json.loads(line)['action']
                                                  ▼
CLI (autolink-cli) ── argparse ──► cli.execute(action, params)  ──► handler(params)
```

- 两个入口最终都走 `cli.execute()`，行为、校验、审计一致。
- GUI 通过 IPC `cli:info` / `cli:audit` 复用 CLI 能力信息与审计日志（设置 → 关于/诊断）。
- 引擎子进程运行时注入 `AUTOLINK_USER_DATA`，审计日志落在 `userData/audit/cli-audit.jsonl`。

## 8. 审计日志

每次执行（GUI 或 CLI）写一行 JSON 到 `cli-audit.jsonl`：

```json
{"ts": "2026-08-05T10:30:00.123456", "action": "design", "argv": ["design", "generate", "--config", "project_config.json"], "params": {"configFile": "project_config.json"}, "ok": true}
```

- **路径优先级**：`AUTOLINK_AUDIT_PATH`（测试注入）＞ `$AUTOLINK_USER_DATA/audit/cli-audit.jsonl`（Electron spawn 注入）＞ `~/.autolink/audit/cli-audit.jsonl`。
- **脱敏**：参数键名含 `password` / `secret` / `token` / `apiKey` 等敏感词时，值替换为 `***`。
- **失败留痕**：执行失败也写入（`ok: false` + `error`），审计写入失败不阻塞主流程。
- v3.1.1+ AIHUB `ai:*` action 已复用此审计（Provider/模型参数脱敏后留痕）。

## 9. 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 2 | CLI 参数错误 / action 执行失败（错误信息在 stderr） |
