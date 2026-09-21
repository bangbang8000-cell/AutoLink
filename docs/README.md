# AIDC AutoLink 文档索引

> 本页是 AutoLink **文档体系的地图与维护入口**。新增文档前请先读「维护规约」一节，避免事实漂移与重复。

## 一、按角色找文档

| 你是谁 | 建议阅读顺序 |
|--------|-------------|
| **新用户** | [README](../README.md) → [用户指南](user_guide/user_guide.md) → 应用内「帮助 → 用户指南」 |
| **运维 / 部署** | [部署指南](deployment.md) → [用户指南 · 自动更新](user_guide/user_guide.md#12-自动更新) |
| **集成方（外部 AI Agent）** | [MCP 接入指南](user_guide/mcp_guide.md) → [Agent Connect 样板](agent-connect/README.md) → [部署指南 · Agent Connect](deployment.md#7-agent-connectmcp-server) |
| **脚本 / 流水线调用方** | [CLI 契约](cli.md) |
| **贡献者** | [文档索引](README.md)（本页）→ [更新日志](../CHANGELOG.md) |

## 二、文档清单

### 面向使用者

| 文档 | 说明 | 维护责任 |
|------|------|---------|
| [../README.md](../README.md) | 产品门面：能力概览、快速开始、模板与设备库、FAQ | 版本发布时随版更新 |
| [user_guide/user_guide.md](user_guide/user_guide.md) | 全功能操作手册（随安装包发布，应用内离线可看） | 功能变更时同步 |
| [user_guide/mcp_guide.md](user_guide/mcp_guide.md) | Agent Connect 接入外部 AI Agent 的配置指南（应用内「帮助 → MCP 接入指南」） | Agent Connect 变更时同步 |

### 面向运维 / 开发者

| 文档 | 说明 |
|------|------|
| [deployment.md](deployment.md) | 环境准备、开发模式、构建打包、生产部署、Python 引擎、AI Hub、Agent Connect、自动更新、数据持久化、CI/CD、故障排查 |
| [cli.md](cli.md) | 命令行接口契约：动作、参数、输出类型、归档与复用策略、退出码（0/1/2/3） |

### 面向集成方

| 文档 | 说明 |
|------|------|
| [agent-connect/README.md](agent-connect/README.md) | Claude Desktop / Codex CLI / Trae Work / VS Code 的 MCP 配置片段与排错表 |
| [agent-connect/claude_desktop_config.json](agent-connect/claude_desktop_config.json) | Claude Desktop 可直接复制的配置 |
| [agent-connect/config.toml](agent-connect/config.toml) | Codex CLI 配置 |
| [agent-connect/mcp.json](agent-connect/mcp.json) | Trae Work / VS Code 配置 |

### 历史归档（本地保留，不入库）

| 位置 | 内容 | 说明 |
|------|------|------|
| `docs/_archive/` | 2.x / 3.0 时期的 PRD 与开发计划 | 已在 `.gitignore` 中排除，仅本地留存 |
| \docs/_archive/v3.0/\ | v3.0 系列 PRD 与开发计划（2026-09-20 归档，已完结） | 归档，保留作追溯 |
| `*.local.md` | 含环境专有信息（如平台访问地址）的本地文档 | 已在 `.gitignore` 中排除，**禁止入库** |

## 三、文档与代码的「真值」关系

为避免"同一事实多个数字"，本项目的数量类事实**以代码为唯一真值源**，由 [`scripts/check_doc_numbers.py`](../scripts/check_doc_numbers.py) 在 CI 中反向校验：

| 事实 | 真值来源 | 当前值 |
|------|---------|--------|
| 设备库款数 | `template/device_library/library_index.json` 的 `categories[*].device_ids` | **127**（92 硬件 + 35 光模块） |
| 场景模板套数 | `template/` 下目录数（排除 `device_library`） | **23** |
| 校验规则条数 | `backend/validation*.py` 中的 `V0xx` 编号集合 | **21**（V001–V020、V022；**V021 缺号**） |
| CLI 退出码 | `backend/cli.py` 的 `EXIT_*` 常量 | 0 / 1 / 2 / 3 |
| 版本号 | `version.json`（单源） | 见 `VERSION` |

校验范围：`README.md` / `CHANGELOG.md` / `docs/cli.md`（CHANGELOG 只校验最新版本章节，历史条目保留当时真值）。

```bash
python scripts/check_doc_numbers.py          # 校验，漂移则 exit 1
python scripts/check_doc_numbers.py --print  # 只打印真值
python scripts/check_version.py              # 版本单源一致性
```

## 四、维护规约

### 新增文档

1. **先归类**：使用者文档放 `user_guide/`；集成方文档放 `agent-connect/`；工程文档放 `docs/` 根。
2. **命名**：工程类历史文档沿用 `{主题}_v{版本}_{日期}.md`；常青文档用固定短名（如 `deployment.md`、`cli.md`），**不加版本号**。
3. **加索引**：在本页「文档清单」登记一行。
4. **不写死数字**：数量类事实写成受 `check_doc_numbers.py` 覆盖的表述（「N 款设备库」/「N 套场景模板」/「N 条校验规则」），让它被自动校验。

### 修改文档（防漂移清单）

改了以下内容时，请同步检查对应文档：

| 代码改动 | 需同步的文档 |
|---------|-------------|
| 增删设备 / 模板 / 校验规则 | 无需手改数字——跑 `check_doc_numbers.py` 会指出所有待改位置 |
| CLI 动作 / 参数 / 退出码 | `docs/cli.md` |
| 构建 / 打包 / 依赖 / 端口 | `docs/deployment.md` |
| Agent Connect（模式 / 门禁 / 工具语义） | `docs/agent-connect/README.md`、`user_guide/mcp_guide.md`、`deployment.md` 第 7 节 |
| 面向用户的功能与操作路径 | `user_guide/user_guide.md` |
| 版本号 | `version.json` → `python scripts/sync_version.py --set x.y.z` |

### 禁止事项

- ❌ 文档内出现**硬编码的版本号产物名**后又忘记随版更新（改为引用 `VERSION` 或写清"以 `package.json` 为准"）
- ❌ 把 `*.local.md` 或 `docs/_archive/` 下的内容提交入库
- ❌ 在 `README.md` / `docs/cli.md` / `CHANGELOG.md` 最新章节写入未经代码校验的数量

---

## 附：修改记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-09-18 | v1.0.3 | 随 5.2.5：版本徽标/产物名/用户手册对齐 5.2.5（**AL 独立补丁，MC 不跟随**）。5.2.5 为光模块选型跨速率误配止血（两个根因：`_parse_speed('1.6T')==1`、降级忽略速率）+ `reportData.module_selection` 三分类守恒台账 + `cost` 口径标注 + 5.2.2 CHANGELOG 过度宣称更正 |
| 2026-09-18 | v1.0.2 | 随 5.2.4：版本徽标同步至 5.2.4（正文无实质变更——5.2.4 属「代码向既有文档真值对齐」：收敛比建议恢复可达、单柜功率上限默认值统一 12000W） |
| 2026-09-18 | v1.0.1 | 随 5.2.3：用户指南机柜章节更正（功率默认 12000W、每柜 GPU **服务器台数**、一柜多台两处同设）；部署指南产物名与发版流程同步 5.2.3（补充「仅 tag 触发 Release」与「tag 前须先写 CHANGELOG 段」约束） |
| 2026-09-17 | v1.0 | 首版：按角色导航 + 文档清单 + 真值关系 + 维护规约（配套 v5.2.2 文档整理） |
