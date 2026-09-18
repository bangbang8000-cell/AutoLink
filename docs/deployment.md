# AIDC AutoLink 部署指南

> 适用于 **v5.2.4**。涵盖：环境准备、开发模式、构建打包、生产部署、Python 引擎、AI Hub、Agent Connect（MCP Server）、自动更新、数据持久化、CI/CD 与故障排查。
>
> 本文档中的数量类事实（设备库 **127** 款 = 92 硬件 + 35 光模块 / 模板 **23** 套 / 校验规则 **21** 条）以代码为唯一真值源，由 `scripts/check_doc_numbers.py` 在 CI 中反向校验。

## 目录

1. [环境准备](#1-环境准备)
2. [开发模式](#2-开发模式)
3. [构建与打包](#3-构建与打包)
4. [生产部署](#4-生产部署)
5. [Python 引擎](#5-python-引擎)
6. [AI Hub](#6-ai-hub)
7. [Agent Connect（MCP Server）](#7-agent-connectmcp-server)
8. [自动更新机制](#8-自动更新机制)
9. [数据持久化](#9-数据持久化)
10. [CI/CD 自动构建](#10-cicd-自动构建)
11. [故障排查](#11-故障排查)

---

## 1. 环境准备

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 22 | 前端构建 / Electron |
| Python | ≥ 3.12 | 计算引擎 / AI Hub |
| npm | ≥ 10 | 依赖管理 |
| Git | ≥ 2.40 | 版本控制 |

### Windows

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12

git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip install -r backend/requirements-dev.txt   # 含运行时依赖 + pytest
```

### macOS

```bash
brew install node python@3.12
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip3 install -r backend/requirements-dev.txt
```

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs python3 python3-pip
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip3 install -r backend/requirements-dev.txt
```

### 依赖清单

| 文件 | 内容 |
|------|------|
| `backend/requirements.txt` | 运行时：`openpyxl` / `pandas` / `reportlab` / `matplotlib` / `openai` / `httpx` / `fastapi` / `uvicorn` / `sse-starlette` / `pydantic` / `mcp>=1.2.0` |
| `backend/requirements-dev.txt` | 运行时 + `pytest` / `pytest-cov` / `pyinstaller` |

> ⚠️ **`mcp` 版本约束**：Agent Connect（MCP Server）依赖 `mcp>=1.2.0`；若上游发布破坏性大版本，请先锁定已验证版本再升级。

---

## 2. 开发模式

```bash
# 完整开发环境（Vite HMR + Electron，并行启动）
npm run dev:all

# 仅前端（浏览器访问 http://localhost:5174）
npm run dev

# 仅 Electron（需先启动 Vite）
npm run dev:electron
```

启动后 Electron 主进程会自动拉起两个 Python 子进程：

| 进程 | 端口 | 用途 |
|------|------|------|
| Python 引擎 | 无端口（stdin/stdout JSON-RPC） | 设计 / 校验 / 导出计算 |
| AI Hub（FastAPI） | `127.0.0.1:18722` | AI 对话 / 工具调用 / Agent Connect |

---

## 3. 构建与打包

```bash
# 构建（不打包）
npm run build            # = build:renderer + build:electron
npm run build:renderer   # 仅前端
npm run build:electron   # 仅 Electron 主进程 + preload

# 打包（自动先 build）
npm run pack             # 仅解包目录（调试用）
npm run dist:win         # Windows：NSIS 安装包
npm run dist:mac         # macOS：DMG（x64 + arm64）
npm run dist:linux       # Linux：AppImage + deb
npm run dist             # 当前平台
```

### 产物命名

| 平台 | 产物 |
|------|------|
| Windows | `release/AutoLink-Setup-5.2.4-win.exe` |
| macOS | `release/AutoLink-5.2.4-mac-x64.dmg` / `AutoLink-5.2.4-mac-arm64.dmg` |
| Linux | `release/AutoLink-5.2.4-linux.AppImage` / `AutoLink-5.2.4-linux.deb` |

> V3.0.0 起，`electron-builder` 前会自动用 **PyInstaller** 将 Python 引擎打包为免 Python 运行的后端（`scripts/pyinstaller.spec`），产物输出到 `dist/backend-dist`，安装包内置该目录。

### 构建前门禁（建议本地先跑）

```bash
npm run typecheck                       # TypeScript 类型检查（含 preload）
npm run lint                            # ESLint（0 error 0 warning）
npm run check-version                   # 版本单源一致性
python scripts/validate_templates.py    # 23 套模板校验
python scripts/gen_golden.py --check    # golden 基线比对
python scripts/check_doc_numbers.py     # 文档数字真值校验
npm test                                # 前端 Vitest
npm run test:backend                    # 后端 pytest
```

### 版本号管理

`version.json` 是**唯一版本事实源**，其余文件为派生：

```bash
python scripts/sync_version.py --set 5.2.3   # 更新单源并同步 package.json / package-lock.json / VERSION
python scripts/check_version.py              # 校验一致性（CI 门禁，等价 sync_version.py --check）
```

---

## 4. 生产部署

### 方式一：从安装包安装（推荐）

1. 前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包
2. **Windows**：双击 `.exe`，按向导安装（可自定义安装目录）
3. **macOS**：将 `.app` 拖入「应用程序」文件夹；首次启动右键 → 打开（绕过 Gatekeeper）
4. **Linux**：
   ```bash
   chmod +x AutoLink-*.AppImage && ./AutoLink-*.AppImage
   # 或
   sudo dpkg -i AutoLink-*.deb
   ```

安装后首次启动会**自动创建示例项目**，内置 **23 套场景模板**（含 7 套 H100/昇腾示例）与 **127 款设备库**（92 硬件 + 35 光模块），无需额外配置。

### 方式二：从源码运行

```bash
npm run build
npm start
```

### 打包资源说明

安装包通过 `extraResources` 内置以下资源：

| 资源 | 位置 | 说明 |
|------|------|------|
| 后端引擎（免 Python） | `resourcesPath/backend-dist` | PyInstaller 产物（V3.0.0+ 优先使用） |
| 后端源码 | `resourcesPath/backend` | 开发模式回退路径 |
| 模板 | `resourcesPath/template` | 23 套场景模板 |
| 设备库 | `resourcesPath/template/device_library` | 127 款设备 JSON（含 35 款光模块） |
| 用户指南 | `resourcesPath/docs` | Markdown 离线文档 |
| 品牌资源 | `resourcesPath/branding` | Logo SVG 与设计规范 |

### 离线可用性

所有规划、计算、校验均在本地完成，**离线可用**；仅「自动更新」与「云中心」需要联网。

---

## 5. Python 引擎

AutoLink 通过子进程调用 Python 引擎（`backend/facade.py` CLI 入口），通信方式为 **JSON stdin/stdout**。

- 开发模式使用系统 `python` 命令，Windows 支持 `py` launcher 回退
- 打包后位于 `resourcesPath/backend-dist`（免 Python）或 `resourcesPath/backend`（回退）
- action 注册表自动发现，覆盖以下域（70+ action）：

| 域 | 代表 action | 说明 |
|----|------------|------|
| 设计 | `design` / `design:from-gpus` / `validate` | 拓扑生成与校验（21 条规则 V001–V020、V022） |
| 导出 | `export` / `report` | Excel（连接表/布线表/BOM/设备清单/机柜表）+ PDF 报告 |
| 估算 | `estimate` | 参数化 PUE / 收敛比重算 |
| 容量规划 | `capacity:recommend` / `capacity:list-presets` | 17 模型档案（含 5 国产场景）+ TCO |
| 拓扑优化 | `atop:recommend` | 模型通信特征 → ZCube 推荐 |
| 优化/修复 | `optimize:suggest` / `optimize:apply` / `repair:plan` / `repair:apply` | 批量优化 + 校验错误修复闭环 |
| 机房 | `room:create` / `room:optimize` / `room:place` / `room:set-type` / `room:validate` | 机房矩阵与智能落位 |
| 机柜 | `rack:optimize` | 多约束装箱 |
| 项目 | `project:*` / `aidc:project:*` / `plan:aidc:*` | 项目生命周期 + AIDC 规划导入导出 |
| 模板 | `template:*` | 模板 CRUD / 导入导出 / 预览 |
| 设备 | `device:list` / `device:get` / `device:defaults` | 设备库查询 |
| 配置 | `config:export` / `config:import` / `config:apply-preset` / `config:list-schema` | 配置契约与预设 |
| AI | `ai:chat` / `ai:config` / `ai:models` / `ai:providers` / `ai:test` | AI Hub 代理入口 |
| 技能 | `skills:list` / `skills:export` / `skills:import` | 技能库 |

> 命令行契约（退出码 0/1/2/3、输出类型、归档与复用策略）详见 [cli.md](cli.md)。

---

## 6. AI Hub

AI Hub 是 AutoLink 的 AI 对话引擎，作为 **FastAPI 子进程**随桌面应用启动。

```
Electron 主进程 ──spawn──▶ python backend/autolink_hub/main.py --port 18722 --auth-token <token>
```

### 关键设计

| 项 | 说明 |
|----|------|
| 端口 | `127.0.0.1:18722`（区别于 MC 的 18721） |
| 鉴权 | Electron 生成随机 token 经 `--auth-token` 注入；请求须带 `X-AL-Auth-Token` 头，否则 401 |
| 网络暴露 | 仅本地回环，无 CORS 开放 |
| 进程管理 | 启动去重 + 异常退出指数退避重启 + 健康检查 |
| Provider | 9 种（DeepSeek / OpenAI / Claude / Gemini / Qwen / GLM / Grok / Ollama / 自定义），Ollama 本地部署无需 API Key |
| 工具 | **72 个** Agent 工具 + 权限分级（AUTO / NOTIFY / CONFIRM） |
| 扩展 | MCP Client（接入外部 MCP server）+ MCP Server（Agent Connect，对外暴露） |
| 依赖 | 见 `backend/requirements.txt`（`fastapi` / `uvicorn` / `openai` / `httpx` / `sse-starlette` / `pydantic` / `mcp`） |

### 配置 Provider

设置面板 → **AI** → 选择 Provider → 填写 API Key / Base URL / 模型 → **测试连接**。

### 独立调试

```bash
cd backend
python autolink_hub/main.py --port 18799 --auth-token dev-token
# 不带 token 启动则无鉴权（仅调试用，勿用于生产）
```

---

## 7. Agent Connect（MCP Server）

5.1 系列起，AutoLink 可把自身暴露为**标准 MCP Server**，供 Claude Desktop / Codex CLI / Trae Work / VS Code 等外部 Agent 调用。

### 启动

```bash
python -m autolink_hub.mcp_server.run --mode compiled --workspace <工作区目录>
```

| 参数 | 说明 |
|------|------|
| `--mode compiled` | （默认）产品使用态：只读 + 受控写入，**不修改软件本体**；高危工具（删除 / 清库 / 裸 CLI / 读源码）强制隐藏 |
| `--mode source` | 开发态：追加 `run_cli` 白名单透传与沙箱内文件系统读写；写操作权限放宽为 NOTIFY |
| `--workspace` | 工作区目录（项目与模板根） |
| `--audit` | 审计 JSONL 落盘路径（缺省不落盘） |
| `--ignore-switch` | 排障用：跳过应用内「Agent Connect 总开关」校验 |

> ⚠️ **总开关强制校验（5.2.2）**：应用内 Agent Connect 关闭时，stdio 入口直接以**退出码 2** 拒绝启动，避免绕过开关被外部拉起。

### 前置条件

1. 已安装 MCP SDK：`pip install "mcp>=1.2.0"`
2. 应用内「设置 → Agent Connect」已打开开关

### 5.2.2 可信门禁

| 机制 | 说明 |
|------|------|
| 语义化屏蔽规则 | `is_destructive_tool` / `is_source_only_tool` / `is_blocked_in_compiled` 按**命名语义**匹配，替代原固定枚举名单（原名单与实际注册名不符 → 危险工具静默泄漏） |
| 启动对账断言 | `audit_block_rules()` + `assert_compiled_selection_safe()`：规则未命中任何注册工具、或命中集含受屏蔽工具 → **拒绝启动** |
| 权限门禁 | `gate_mode`（`enforce` / `shadow` / `off`），`gate_hits` / `block_audit` 可观测；`confirm` 档工具需 `approvalToken`，默认 `shadow` 灰度只记录不阻断 |
| 失败语义 | 工具失败置 `isError=true`，响应**扁平化单层** + 结构化 `error_code` |
| 入参契约 | MCP 工具**不再暴露 `toolName` 入参**（修复「传 `toolName=delete_project` 即可把只读调用路由到高危工具」的越权缺陷） |
| 入口兜底 | `execute_tool` 增加模式守卫（`AC_ERR_TOOL_NOT_ALLOWED`），防止绕过注册期过滤按名直调 |

### 自检

```bash
curl http://127.0.0.1:18722/api/chat/agent-connect/selfcheck
```

逐项体检：MCP SDK / 总开关 / 工具注册数 / 屏蔽规则对账 / 门禁模式 / 审计状态。

### 接入配置

见 [agent-connect/README.md](agent-connect/README.md) 与 [user_guide/mcp_guide.md](user_guide/mcp_guide.md)。

### 故障排查

| 现象 | 检查项 | 修复 |
|------|--------|------|
| 连接失败「MCP SDK 未安装」 | `pip show mcp` | `pip install "mcp>=1.2.0"` 后重启 |
| 启动即退出（退出码 2） | 应用内总开关 | 打开「设置 → Agent Connect」；排障可加 `--ignore-switch` |
| 工具列表为空 | 编译态屏蔽 | 检查自检中「屏蔽对账」是否绿灯；规则全不命中会拒绝启动 |
| 权限提示频繁 | `gate_mode` / `--mode` | `enforce` 下写入需确认属预期；开发场景切 `--mode source` |
| 审计缺失 | `--audit` 或应用设置 | 指定路径或开启设置项 |

---

## 8. 自动更新机制

V3.0.0 重构后的更新链路在**国内网络环境**下也可用。

### 双通道检查

- **主通道**：`electron-updater`（GitHub Releases 标准协议）
- **备用通道**：Electron `net` 模块直查 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`，走 Chromium 网络栈
- 主通道失败自动切换备用通道；备用通道解析 `version` 判断新版本，并缓存 `path` 下载信息

### 正向下载（三级兜底）

1. `electron-updater` 下载（支持断点续传 + SHA-512 校验）
2. Electron `net` 直接下载安装包到「下载」目录（手动跟随 GitHub 302 重定向，实时进度回传），完成后 `shell.openPath` 启动安装
3. 打开 Releases 页面（最终兜底）

### 关键文件

| 文件 | 职责 |
|------|------|
| `electron/services/update.service.ts` | 更新服务核心（检查 / 下载 / 安装 / 降级） |
| `electron/ipc/handlers.ts` | IPC 处理器 |
| `src/components/layout/UpdatePopover.tsx` | 顶部栏更新弹层 |
| `src/components/layout/AboutDialog.tsx` | 关于弹窗更新 UI |

### 注意事项

- `electron-updater` 必须在 `dependencies`（非 `devDependencies`），否则打包后 asar 内模块缺失
- 更新源：GitHub Releases（`package.json` 的 `build.publish`）
- 检测时机：启动后自动检测（可在设置中关闭）；手动入口：菜单「帮助 → 检查更新」

---

## 9. 数据持久化

V2.6.2+ 拓扑与机柜数据按项目持久化：

| 文件 | 位置 | 说明 |
|------|------|------|
| `project_config.json` | 项目根目录 | V2.1+ 项目配置（**优先读取**） |
| `network_config.ini` | 项目根目录 | V2.0 格式网络配置（向后兼容） |
| `topology.json` | 项目根目录 | 拓扑节点/边/摘要/校验/估算 |
| `rack_layout.json` | 项目根目录 | 机柜布局（防抖 500ms 自动保存） |

- 切换项目自动加载对应拓扑/机柜数据
- 项目导出/导入 ZIP 完整保留拓扑与机柜数据
- 旧项目无 `topology.json` 时显示「尚未生成拓扑」

### 导出归档策略（5.2.2）

`export` action 采用**版本 + 时间戳**批次目录（`outputDir/v<N>_<timestamp>/`）：

- **指纹复用**：同 `config_hash` 且请求类型上次已成功产出 → 直接返回 `reused: true`，**不新增批次目录**（可用 `regenerate` 强制重算）
- **`noArchive`**：不建批次目录、不写 `manifest.json`、不做保留轮转
- **缺省 `outputTypes`**：缺省即**全部类型**（旧行为为空 → `results: []` 的无声失败已修）
- **空结果**：无任何成功产出时删除新建批次目录并返回 `AL_ERR_EMPTY_RESULT`，不留空批次
- **保留策略**：`outputRetention`（默认 10）控制批次目录轮转
- `reportData` 为**内存态**产物，不落盘、不参与归档与复用判定

---

## 10. CI/CD 自动构建

### CI（push `main` / PR）— [ci.yml](../.github/workflows/ci.yml)

| 步骤 | 说明 |
|------|------|
| `npm ci` | 依赖安装（Node 22 + Python 3.12） |
| `pip install -r backend/requirements-dev.txt` | 引擎与测试依赖 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 门禁 |
| `npm run test:report` | 前端 Vitest + 覆盖率门禁 + junit 产物 |
| `npm run build:renderer` / `build:electron` | 渲染层与主进程编译 |
| 渲染层安全断言 | 0 直接网络 / 0 Node 访问（一律走 preload IPC） |
| `check_doc_numbers.py` | 文档数字真值校验 |
| 模板 / golden 校验 | 23 套模板 + golden 基线 |

### Build & Release（push `v*` tag）— [build.yml](../.github/workflows/build.yml)

1. **三平台并行构建**（windows-latest / macos-latest / ubuntu-latest）
2. 各平台执行 `npm ci` → PyInstaller 打包后端 → `npm run build` → `electron-builder --win/--mac/--linux`
3. 上传构建产物 → 创建 GitHub Release 并附安装包

```bash
# 发布流程
python scripts/sync_version.py --set 5.2.3     # 1. 更新版本单源并同步
npm run typecheck && npm run lint && npm run build   # 2. 本地门禁
git add -A && git commit -m "release: v5.2.3 - <摘要>"
git push origin main                            # 3. 触发 CI 编译（含 build:renderer / build:electron）
git tag -a v5.2.3 -m "5.2.3" && git push origin v5.2.3   # 4. 触发三平台打包 + Release
```

> ⚠️ tag 必须为 `v*` 干净格式（如 `v5.2.3`）；`build.yml` 的 `release` 作业带 `if: startsWith(github.ref, 'refs/tags/v')`，
> 所以**只有 tag 推送才会建 Release**，在分支上手动 `workflow_dispatch` 只会产出 artifact。
> 推荐用注释标签（`-a`，与既有 `v5.2.2` 一致）；轻量标签 `git tag v5.2.3` 也能触发。
> Release 说明由 `scripts/extract_release_notes.py <tag> CHANGELOG.md` 从 CHANGELOG 抽取，
> **打 tag 前必须先在 `CHANGELOG.md` 写好该版本段**，否则 release 作业会失败。

---

## 11. 故障排查

| 问题 | 解决方案 |
|------|---------|
| `No module named 'openpyxl'` | `pip install -r backend/requirements.txt` |
| `npm install` 失败 | 清除 `node_modules` 与 `package-lock.json` 后重试；确认 Node ≥ 22 |
| Electron 窗口无法启动 | 确认 Node ≥ 22；先跑 `npm run build:electron` |
| Python 路径找不到 | 应用依次尝试 `python` / `python3` / `py`，确保已加入 PATH |
| 安装后看不到设备库或模板 | 安装包已内置资源；源码运行需确保 `template/` 完整 |
| AI Hub 启动失败 | 确认 Python ≥ 3.12 且依赖已装；检查 18722 端口是否被占用 |
| AI Hub 401 | 主进程与子进程 token 不一致，重启应用 |
| Agent Connect 启动即退出码 2 | 应用内总开关未开启；排障可加 `--ignore-switch` |
| Agent Connect 工具列表为空 | 查看 selfcheck 的「屏蔽对账」；规则全不命中会拒绝启动 |
| 生成拓扑失败 | 检查配置参数合法性；查看 engine 返回的 `error_code` |
| PDF 报告项目名称不对 / 机柜被截断 | 升级至含 V2.9.3 修复的版本 |
| 切换项目后拓扑/机柜串扰 | V2.6.2+ 已修复（按项目持久化）；确认版本 |
| 导出结果为空 | 5.2.2 起缺省 `outputTypes` 为全部类型；若仍空检查 `AL_ERR_EMPTY_RESULT` |
| 重复导出想强制重算 | CLI 加 `--regenerate` |
| 更新提示「已是最新」但有新版 | V2.7.0+ 已修复双通道；旧版本需手动下载一次 |
| 工作区 Tab 状态丢失 | Tab 持久化在 localStorage，可在设置中 Reset Workspace |

---

## 附：修改记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-09-18 | v5.2.4 | 版本对齐 5.2.4；产物名随版本更新（正文无实质变更——5.2.4 为「代码向既有文档真值对齐」） |
| 2026-09-18 | v5.2.3 | 版本对齐 5.2.3；产物名随版本更新；发版流程补充「仅 tag 触发 Release」与「tag 前须先写 CHANGELOG 段」的硬约束 |
| 2026-09-17 | v5.2.2 | 全面重写：版本对齐 5.2.2；修正模板 19→23、设备库 126→127、规则 22→21（V021 缺号）；新增 Agent Connect 部署章节、AI Hub 端口/鉴权、导出归档与复用策略、CI 双工作流说明；补充依赖清单与故障排查项 |
| 2026-08-19 | v3.6.0 | 原版（环境准备 / 构建 / 生产部署 / 自动更新 / 数据持久化） |
