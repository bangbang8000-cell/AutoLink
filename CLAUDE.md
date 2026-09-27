# CLAUDE.md — AIDC AutoLink Client

> **Claude Code 专用指令。** 完整工程指南见 [`AGENT.md`](AGENT.md)（本文件是其精简执行版，冲突时以 `AGENT.md` 为准）。
> 人读入口见 [`README.md`](README.md)。

## 你是谁 / 在哪

你在 **AIDC AutoLink Client** 仓库中工作 —— AI 智算中心网络规划与可视化工具。
技术栈：Electron + React 18 + TypeScript + Vite（`src/`、`electron/`）+ Python 3.12 引擎（`backend/`）。

本仓是 **MC-AL 联合工作区**的双端之一，与 `../MagicCommander-Client` 构成同构对。
工作区级长期约定在 `../.workbuddy/memory/MEMORY.md`，**动跨端改动物必先读**。

## 基本动作

```bash
npm ci && pip install -r backend/requirements-dev.txt   # 首次
npm run dev:all                # 开发
npm run typecheck && npm run lint
npm run test && npm run test:backend
npm run check-version          # 版本单源
```

## 硬约束（务必遵守）

1. **禁止 `git add -A`** —— 显式列路径提交（避免纳入临时文件）。
2. **改 `backend/autolink_hub/mcp_server/` 必须同步 `../MagicCommander-Client/ai_hub/mcp_server/`**
   （逐行同构），两端各跑 10 个 `test_agent_connect_*.py`。
3. **打 tag 前先 `git fetch origin --tags` / `git ls-remote --tags origin`** ——
   本地 tag 缺失 ≠ 未发版。**先推 main 再推 tag**；发版后 `git push syno main --tags`。
4. **不要手工改版本号** —— 用 `python scripts/sync_version.py --set x.y.z`（单源派生 4 文件）。
5. **大文档多处修改要串行**（同一文件并发 `Edit` 会互相覆盖且报 success）——
   优先整篇 `Write`；改完 `grep` 回看锚点。
6. **改 `designer.py` / `topology.py` / `engine.py` 必跑 `python scripts/validate_templates.py`**
   （23 套模板 JSON + INI 双路径端到端，是 INI 路径唯一端到端门禁；本地"门禁四连"**不含**它）。
7. **领域不变量**（详见 `AGENT.md` §6.1）：机柜默认 1 柜 1 台；`gpu_per_cabinet` 是**台数**不是卡数；
   连接去重键方向敏感 `(a_device, z_device, a_port)`；分光按网络角色生效；光模块速率 `T`=×1000 且四份解析须同步；
   `NetworkDesignerV2(path)` 构造即执行设计。

## 本地"假红灯"（别误判为回归）

- pytest 上千 `UnicodeDecodeError ... 0xce` 发生在 **capture setup/teardown**（GBK 子进程），**不是测试失败**；
  vitest `Failed to start forks worker` 但 `Test Files passed` 同理。
- `test_sample_assets.py` 本地真挂起（Py3.13 + openpyxl），**只信 CI**。
- 判回归：`git stash` 造干净树跑同一命令对比；**不要用 shell 抓 pytest summary**，用 `--junit-xml=` + 解析。

## Agent Connect 要点

- MCP 启动：`python -m autolink_hub.mcp_server.run --user-data <dir>`（**MC 是 `--workspace`**）。
- 授权档 `--grant readonly|semi|full`（默认 `semi`；`full` 必须配 `--audit` 否则拒绝启动）。
- **`full` 不豁免编译态屏蔽**：授权管「要不要确认」，模式管「可不可见」，二者正交。
  `delete_*` / `run_cli` / `read_file` / `list_dir` / `read_source` 在 `compiled` 下仍不可见。
- 长耗时工具**已在 MCP 层自动异步**，拿到 `task_id` 后用 `task_wait`，**不要再包 `task_submit`**。

## 验证清单（提交前）

```bash
npm run typecheck && npm run lint
npm run check-version
python scripts/validate_templates.py          # 若动引擎
python scripts/validate_device_library.py     # 若动设备库
python scripts/check_doc_numbers.py           # 若动文档数字
python scripts/gen_golden.py --check          # 若动输出
```
CI 顺序：typecheck → lint → test:report → build → Security baseline → validate_templates →
validate_device_library → doc numbers → conflict markers → changelog claims → gen_golden --check → pytest。
