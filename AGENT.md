# AGENT.md — AIDC AutoLink Client

> 面向 **AI 编程 Agent**（Claude Code / Codex / Cursor / 其他）的工程指南。
> 人读入口文档见 [`README.md`](README.md)；Claude Code 请同时读 [`CLAUDE.md`](CLAUDE.md)。
>
> **本仓在 MC-AL 联合工作区中**：与 `../MagicCommander-Client`（MC）构成双端同构对，改动需对照；
> 工作区级长期约定在 `../.workbuddy/memory/MEMORY.md`。

---

## 1. 项目定位

**AIDC AutoLink** = AI 智算中心网络规划与可视化工具。

输入 **GPU 服务器规模 / 卡数 / 网络协议**，输出 **可交付的智算中心网络设计方案**：
Scale-Up 卡间互联（NVLink / UALink / UB）+ Scale-Out 网间互联（Fat-Tree / Rail / ZCube / 双平面 / 三合一融合网 / 超节点），
配套拓扑图、机房矩阵、机柜上架、PUE 能耗、光模块选型、收敛比校验，最终产出连接表 / 布线表 / BOM / 设备清单 / 机柜表 / 9 章 PDF 报告。

**与 MC 的分工**：AL 负责「规划」（给规模 → 出组网与机房方案），MC 负责「渲染」（给 Excel + Jinja2 模板 → 批量出设备配置）。
两者以 **`plan:table v1.3`** 契约衔接：AL 导出的规划表可被 MC 消费。

---

## 2. 技术栈与版本

| 层 | 技术 |
|---|---|
| 桌面外壳 | Electron（主进程 `electron/`，preload 桥接） |
| 渲染层 | React 18 + TypeScript 5 + Vite + TailwindCSS；拓扑用自绘 SVG/Canvas，机房 3D 用 react-three-fiber |
| 后端引擎 | Python 3.12（`backend/`，随包 PyInstaller 打包；开发态由 Electron 拉起） |
| AI / Agent | 内建 AI 助手（`backend/al_ai_hub/`）+ 外部 Agent 接入 MCP（`backend/autolink_hub/mcp_server/`） |
| 测试 | vitest（前端）+ pytest（后端）+ Playwright（E2E） |
| CI | GitHub Actions（`.github/workflows/ci.yml` + `build.yml`） |

**版本单源**（4 文件，任一漂移 CI 即红）：
```
version.json = package.json = package-lock.json = VERSION   # 当前 5.4.4
```
校验：`npm run check-version`（等价 `python scripts/check_version.py`）。

---

## 3. 目录布局（只列重要项）

```
backend/                      Python 引擎（核心资产）
  designer.py                 网络设计主入口（拓扑生成为核心）
  topology.py                 拓扑模型与层级判据（calc_max_2tier 等）
  engine.py                   设计引擎 / 拓扑边构造
  exporter.py                 交付物导出（连接表 / 布线表 / BOM / 报告）
  validation.py               校验规则 V001–V022
  optical_selector.py         光模块选型
  cli.py                      ★ CLI 入口（注册表驱动，23 域 67 action）
  config_schema.py            配置模型 schema
  autolink_hub/               Agent Connect（MCP Server）宿主
    mcp_server/               ★ 与 MC 逐行同构，改动必须双端同步
  al_ai_hub/                  程序内建 AI 助手
src/                          前端（renderer）
electron/                     主进程 + preload
template/                     内置模板（模板资产）
tests/backend/                后端测试（含 golden 基线）
e2e/                          Playwright 用例
scripts/                      门禁与工具脚本（见 §5）
docs/                         项目文档（cli.md / agent-connect/ 等）
wiki/  design/  snapshot/     文档与截图资产
```

---

## 4. 常用命令

```bash
# 依赖（首次）
npm ci
pip install -r backend/requirements-dev.txt

# 开发（vite :5174 + electron）
npm run dev:all

# 构建 / 打包
npm run build                 # renderer + electron 主进程
npm run dist:win|dist:mac|dist:linux

# 类型 / 风格
npm run typecheck
npm run lint

# 测试
npm run test                  # vitest
npm run test:backend          # pytest tests/backend/
npm run test:e2e              # playwright
npm run test:report           # 带覆盖率与 junit 产物（CI 用这个）

# 门禁（本地必跑，见 §5）
npm run check-version
python scripts/validate_templates.py
python scripts/validate_device_library.py
python scripts/check_doc_numbers.py
python scripts/check_changelog_claims.py
python scripts/check_skill_refs.py
python scripts/gen_golden.py --check
```

---

## 5. 门禁与验证（**改代码前先想清楚要跑哪些**）

| 门禁脚本 | 作用 | 何时必跑 |
|---|---|---|
| `scripts/check_version.py` | 版本 4 文件单源一致 | 任何版本相关改动 |
| `scripts/validate_templates.py` | **23 套模板端到端（JSON + INI 双路径）**，是 INI 路径**唯一**端到端门禁 | **改 `designer.py` / `topology.py` / `engine.py` 必跑**（⚠️ 本地"门禁四连"不包含它 ⇒ 本地全绿而 CI 红） |
| `scripts/validate_device_library.py` | 设备库索引 ↔ 目录对账（死文件/缺字段/重复 id/分类漂移） | 增删设备档案 |
| `scripts/gen_golden.py --check` | golden 基线比对（`tests/backend/golden/` 28 JSON） | 改动会影响设计输出时 |
| `scripts/check_doc_numbers.py` | 以**代码为唯一真值源**反查文档中的设备数/模板数/规则数 | 改文档数字 |
| `scripts/check_changelog_claims.py` | CHANGELOG 反引号标识符须在源码可检索（防"宣称交付了、实际 0 命中"） | 改 CHANGELOG |
| `scripts/check_skill_refs.py` | `agent-skills/` 中引用的工具/命令须真实存在 | 改动 Agent 工具面或 skill |
| `scripts/bench_perf.py` | 性能门禁（2048 GPU 设计 ≤30s，225 柜落位 ≤5s） | 性能敏感改动 |
| CI 内联 | 渲染层安全基线（0 直连网络 / 0 Node 访问，一切走 preload IPC）+ 冲突标记扫描 | 改 `src/` |

**CI 顺序（fail-fast）**：typecheck → lint → test:report → build:renderer → build:electron → Security baseline
→ validate_templates → validate_device_library → doc numbers → conflict markers → changelog claims → gen_golden --check → pytest。

---

## 6. 硬性纪律（违反会造成静默错误）

1. **不要 `git add -A`** —— 会静默纳入临时文件（`.commit_msg_*.txt` 等）。**显式列路径**。
2. **双端同构**：`backend/autolink_hub/mcp_server/` ↔ `../MagicCommander-Client/ai_hub/mcp_server/`
   逐行同构。改一端**必须**同步另一端，并各跑 10 个 `test_agent_connect_*.py`。
3. **打 tag 前先与远端对账**：`git fetch origin --tags` / `git ls-remote --tags origin`。
   **本地 `git tag` 缺失 ≠ 未发版**（本地 refs 可能落后；push 被拒时 git 会更新本地 refs）。
4. **大文档多处编辑必须串行**：同一文件多处 `Edit` 并发 ⇒ 后写覆盖先写**且仍报 success**。
   ⇒ 改完 `grep` 回看锚点；**整篇 `Write` 重写比多处 `Edit` 更安全**。
5. **写 JSON 必须 `newline='\n'`** —— 否则 CRLF 与 `.gitattributes` 打架，内容未变却显示已改。
6. **批量改 markdown 表格**用 `grep -n` 取真实字节按行号精确替换；**禁止 `sed`**（`|` 是分隔符）。
7. **版本号不手工改** —— 用 `python scripts/sync_version.py --set x.y.z`（单源 → 派生 4 文件）。
8. **跨模块键名/口径耦合必须端到端验证**：单元测试手搓 cfg 全绿也可能漏掉「生产者写 `上联需求总数`、
   消费者读 `需求上联总数`」这类**字序颠倒**的静默失效（历史血训 ×3）。必须写「生产者 → 消费者」端到端用例。

### 6.1 领域级不变量（AL 特有）

- **机柜默认「1 柜 1 台」**（8 卡也一柜一台）。`gpu_per_cabinet` = **每柜台数**（非卡数）；
  1 柜多台须同时设 `power_limit_per_rack`（如 36000）与 `gpu_per_cabinet=2`。
- **单柜功率上限默认 12000W**（后端 7 处 + 前端 6 处须同源）。
- **连接聚合键必须方向敏感**：去重键 `(a_device, z_device, a_port)`，**不要** `tuple(sorted(...))`（会误删反向连接）。
  例外：`designer.py` 对 scale-up GPU 链路按无序设备对去重（**勿改**）。
- **分光（breakout）必须按网络角色生效**：同型号可参数网 1:1、存储网 1 分 2。设备档案 `breakout`
  **不得当全局开关**。改 `designer._link_speed_for()` **必须跑 `validate_templates.py`**。
- **「每服务器口数」类参数必须按服务器类别给值**：建链口数、层级判据、容量校验**三处必须同源**。
- **光模块速率解析必须单位感知（`T` = ×1000）**：同仓**四份**解析
  （`optical_selector._parse_speed` + `exporter` / `engine` / `validation`），**改一处须核对四份**。
  降级只许「同速档内放宽光纤类型」，**绝不跨速率**；`matched`/`not_applicable`/`unmatched` 三态**必须守恒**。
- **`select_optical_module(...)` 的 `library` 在第 5 位** ⇒ **一律关键字传参**。
- **多初始化路径属性必须同源**：JSON 路径赋值的属性，INI 路径若漏赋值 ⇒ 旧格式 INI 项目 `AttributeError`。
  口径开关一律进**唯一入口** `_init_biz_caliber_switches(get, has=None)`。
- **`NetworkDesignerV2(json_or_ini_path)` 构造函数本身即执行设计**，无 `.design()`。

---

## 7. CLI（`backend/cli.py`）

- **注册表驱动**：`build_domain_map()` 从 `list_registered_actions()` 自动发现，**实测 23 域 67 action**。
- **退出码**：`EXIT_OK=0` / `EXIT_INTERNAL=1` / `EXIT_USAGE=2` / `EXIT_EXEC=3`（与 MC **逐位一致**）。
- **stdout 纯净**：stdout 仅含命令业务输出（成功信息 + JSON 结果）；**错误/警告走 stderr**。
- **审计**：`cli-audit.jsonl`；输出做**双重脱敏**。
- **`ACTION_PARAM_SCHEMA`** 覆盖 45/67 = 67%，其余 22 个 action 只能 `--json` 兜底（批次 C 计划补齐）。
- **`CLI_VERSION = '1.0.0'`** 表达 **CLI 契约版本**，与产品版本解耦。
- 文档契约在 `docs/cli.md`（与命令树对账）。

---

## 8. Agent Connect（MCP Server，`backend/autolink_hub/mcp_server/`）

外部编程 Agent（Claude Code / Codex 等）通过 MCP 控制程序。**Agent 工具面：72 工具 / 13 域**（编译态可见 11 域）。

**启动参数（AL 与 MC 不同，写错会静默用空路径）**：
```bash
python -m autolink_hub.mcp_server.run --user-data <用户数据目录> \
       [--mode advisor|semi_auto|full_auto|compiled] [--audit <审计文件>] [--grant readonly|semi|full]
```
MC 侧对应是 `--workspace <dir>`（**不是** `--user-data`）。

**权限模型**：
- **工具档位**：`AUTO`（🟢）/ `NOTIFY`（🟡）/ `CONFIRM`（🔴）；未登记工具**兜底 CONFIRM**（保守）。
- **授权档 `--grant`**（5.4.5 起）：
  - `readonly` —— 仅 AUTO 放行；
  - `semi`（**默认**）—— AUTO + NOTIFY 放行，CONFIRM 走门禁；
  - `full` —— 全放行（**必须**配 `--audit`，否则**拒绝启动**）。
  - 优先级：`--grant` > 环境变量 `AUTOLINK_AGENT_GRANT` > 默认 `semi`。
- **⚠️ 铁律（AG-3 裁定）**：**`full` 档不豁免编译态屏蔽规则**。
  **授权管「要不要确认」，模式管「可不可见」，二者正交。**
  `delete_*` / `run_cli` / `read_file` / `list_dir` / `read_source` 在 `compiled` 模式下**仍然不可见**。
  守卫用例：`test_full_grant_does_not_unblock_destructive`。
- **长耗时工具在 MCP 层已自动异步** ⇒ 调用后拿 `task_id` + `task_wait`，**禁止**再套 `task_submit`（双重异步）。
- **门禁模式**：`GATE_MODES = ("notify", "enforce")`，默认 `notify`（记录不阻断）。

**跨端参数名不通用**（易错）：导入源 AL `source` / MC `zipPath`；导出目标 AL `outputPath` / MC `targetDir`；
技能名 AL `name` / MC `skillName`；知识条数 AL `top_k` / MC `topK`。

**相关文档**：`docs/agent-connect/README.md`、`docs/agent-connect/claude_desktop_config.json`。
面向旁挂 Agent 的任务级 Skill 包在**工作区** `../agent-skills/`（**非本仓**）。

---

## 9. 发版流程

```bash
# 1) 版本 bump（单源）
python scripts/sync_version.py --set 5.4.5
git add version.json package.json package-lock.json VERSION   # 显式列路径
git commit -m "chore: bump 5.4.5"

# 2) 先推 main
git push origin main

# 3) 打带注释多行 tag（先与远端对账！）
git fetch origin --tags
git ls-remote --tags origin | tail -5        # 确认目标版本未被占用
git tag -a v5.4.5 -m "AIDC AutoLink v5.4.5" <commit>
git push origin v5.4.5                        # build.yml 仅 push tag v* 建 Release

# 4) 同步群晖镜像
git push syno main --tags
```

- **远端**：`origin` = GitHub（**唯一发版通道**，`git@github.com:bangbang8000-cell/AutoLink.git`）+
  `syno` = 群晖 Gitea 镜像。
- CI ≈16–18 min；Build（三平台）≈8 min。
- `build.yml` 触发条件：`push tags: ['v*']`；`concurrency: release-<ref>`。

---

## 10. 已知陷阱

1. **本地「假红灯」**：pytest 上千 errors（`UnicodeDecodeError ... 0xce`）发生在 **capture setup/teardown**
   （子进程 GBK 中文），**不是测试失败**（指纹：error 数 ≫ 用例数、散布上百个测试类）；
   vitest `Failed to start forks worker` 但 `Test Files passed` 同理。
   ⇒ **判定回归必须 `git stash` 造干净树跑同一命令对比**。
2. **`test_sample_assets.py` 本地真挂起**（Py3.13 + openpyxl 卡 `zipfile._read1`；CI 用 3.12 可过）
   ⇒ **跳过，只信 CI**。
3. **不要用 shell 抓 pytest summary** ⇒ 一律 `--junit-xml=` 写工作区内路径 + Python 解析 XML。
4. **本机 `/tmp` 与 Windows 不通** ⇒ 临时目录用**仓内/工作区内相对路径**，用完清理。
5. **环境（Windows + Bash 工具）**：PATH 可能损坏，命令前加
   `export PATH="/usr/bin:/bin:/c/Users/everg/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH";`
   `Glob` 对大仓会超时（优先用修好的 PATH + `find`）；`grep -rn` 偶发挂起（改用 Grep 工具）。
6. **golden 基线可能编码的正是错计数** ⇒ 修缺陷时**同批重生成 + 逐条归因**；无法解释的差异**当缺陷回退排查**。
7. **CI 中 `validate_templates.py` 曾因万卡模板在 GitHub 环境跑不过而 `continue-on-error`**
   —— 本地失败**不能**直接当作"CI 也会失败"的等价结论，反之亦然；以 CI 结论为准。

---

## 11. 与 MC 端对照速查

| 项 | AL | MC |
|---|---|---|
| 包名 | `autolink_hub` | `ai_hub` |
| 引擎入口 | `backend/designer.py` | `ai_hub/`（渲染） |
| CLI 入口 | `backend/cli.py` | `backend/main.py` |
| MCP 启动目录参数 | `--user-data` | `--workspace` |
| 授权环境变量 | `AUTOLINK_AGENT_GRANT` | `MC_AGENT_GRANT` |
| 版本派生脚本 | `scripts/sync_version.py` | `scripts/sync-version.js` |
| 契约守卫 | `check_version.py` 等 | `check_cli_contract.py`（C1~C6） |
| 产品版本 | 5.4.4 | 5.4.2 |
