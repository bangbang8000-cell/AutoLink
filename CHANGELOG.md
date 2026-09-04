# CHANGELOG

## [5.0.5] - 2026-09-04

### 5.0.5 文档与知识（5.0 系列第 5 版）

- **文档工作台**：DocsWorkbench 工作台子视图 8 张一键生成卡（设计报告 PDF/合规/连接表/设备清单/布线/BOM + 评审 PDF/评审包 + MC 交付包）+ 产物清单表（doc:list 8 类产物识别/时间/状态 + 导出/打开位置）+ 用户指南入口；engine.py export 接线 compliance 报告
- **知识库**：KnowledgeEngine（knowledge/*.md + 伴生 .metadata.json，白名单字段，<user_data>/knowledge/）+ 中文双字加权检索 Top-K + list_knowledge/search_knowledge/add_knowledge 工具（与技能自学习解耦）+ /api/chat/knowledge* 端点 + ai:knowledge-* IPC 白名单 + KnowledgePanel 面板
- **AI 上下文管理**：系统提示词组装注入知识库上下文（query 消息级动态检索 + project 兜底进缓存）+ ChatRequest.knowledge 全链路透传（own/hermes/workflow 三路）+ 知识变更刷新 system prompt 缓存

## [5.0.4] - 2026-09-04

### 5.0.4 协作与生态（5.0 系列第 4 版）

- **模板市场生态**：评分（1-5 upsert/均值/人数/我的分，POST /rating）+ 订阅（订阅/取消，POST/DELETE /subscribe）+ featured 精选徽标 + 列表注入 rating_avg/rating_count/is_subscribed/subscribers_count（可选字段优雅降级）+ TemplateMarket 星标评分/订阅按钮/精选徽标
- **设备库云同步**：cloud:deviceLibraryGet/Push IPC + 拉取合并（MC 扁平/AL bundle/{devices} 三种形状兼容、同 id 云端优先）+ 发布（autolink-device-library v1 bundle ≤500）+ DeviceLibraryTab 云同步区（本地数/云端数/上次同步）
- 分享链路沿用既有（cloud:shareCreate → share:snapshot → POST /shares）

## [5.0.3] - 2026-09-03

### 5.0.3 AI Agent 工作流深化（5.0 系列第 3 版）

- **多步自主任务编排**（Plan→Execute→Verify 状态机，与 MC 同构）：Plan 接线 parse_plan_from_response；full_auto 自主全流程 / advisor 每步确认 / semi_auto 关键步确认（---STEP_CONFIRM--- 标记）；verify_tool_result 轻量一致性校验；会话任务状态（task_id/plan/step/verify_result）；前端「多步任务」开关 + 任务进度卡片
- **技能自学习闭环**：record_feedback 持久化（成功/失败/成功率/最近样本）+ maybe_optimize_skill 阈值自动修订 + skill_update/skill_save/skill_optimize 工具；record_usage 接线 run_stream；portable manifest v2 技能级元数据（兼容 v1）
- **MCP 工具接入**（协议层，非 Agent 框架）：mcp/manager.py 配置+stdio 生命周期+工具发现 → 动态注册 mcp: 命名空间；execute_tool 补参数校验 + unregister_tool；双引擎共享；前端 MCP 管理区；审计登记 mcp 允许依赖

## [5.0.2] - 2026-09-03

### 5.0.2 AI Agent 底座（Hermes 并存）（5.0 系列第 2 版）

- **统一 AgentProvider 抽象**（会话/工具/技能/记忆四域接口，与 MC 端同构）：OwnAgentProvider（自有引擎适配）+ HermesAgentProvider（适配 NousResearch/hermes-agent，探测运行时是否安装）
- **「AI 引擎」配置三选一**（自有=默认 / Hermes / 自动）：al_ai_hub /engine 端点 + Electron ai:get-engine/ai:set-engine + 前端「AI 引擎」下拉；配置持久化、切换不丢会话（会话按引擎命名空间隔离）；auto 模式 Hermes 可用则用 Hermes 否则回退自有
- **Hermes 未安装友好提示**：chat 返回安装指引（pip install hermes-agent + 官网），前端提示卡片
- **审计修订**：hermes 经 AgentProvider 并存（harness/langchain/langgraph/crewai/autogen 等其余平台仍拦截）

## [5.0.1] - 2026-09-03

### 5.0.1 内容与渲染准确性攻坚（5.0 系列第 1 版）

- **四示例复核修正**：plan.deviceModels 与 device_refs 严格一致（存储 200G→S9825-128B、业务汇聚 100G→S9850-32H、OOB 汇聚 10G→S6805-56HF-G），消除「plan 型号 ↔ 设计引用」漂移；plan.deviceModels 从设备库 vendor+model 派生

- **模板库门禁强化**：新增 template_gate（rack_config 完整性 cooling_method/gpu_dedicated 强制、协议兼容性、参数合理性、旧设备 id 门禁）；3 套模板（L20-推理-64/hygon_dcu_cluster/cambricon_mlu_cluster）补齐字段

- **设备库对账**：注册 optical_modules 9 个死文件（索引↔目录 35/35 一致）；新增 validate_device_library.py 对账门禁（索引↔目录/id 唯一/字段完整/分类合法/可互灌）+ CI

- **导出内容校验**：新增 E009 表头契约 / E010 设备清单合计数量 / E011 布线行数与设计一致；修复 E005 连接表多 sheet 行数统计；validate_samples 接入设计级导出+内容校验

## [4.9.0] - 2026-09-03

### 4.9 示例资产与收官（4.0 系列收官版）

- **四示例项目**：H100-64台-IB / H100-64台-RoCE / H100-128台-IB / H100-128台-RoCE（template.json + project_config.json + network_config.ini + plan.json + room_layout.json 五件套；IB 收敛比 1:1、RoCE 2:1；机房矩阵/机柜/宏观参数全配）

- **模板中心整合**：isSample 徽标 + 摘要行 + 基于示例创建（room_layout 随建项目复制，5 语言）

- **示例自动化验收**：validate_samples.py 门禁 + pytest 门禁 + E2E 建项目渲染 + golden 基线

- **文档收官**：用户指南示例项目章节 + README 模板清单 23 套（含 4 套 H100 示例）

## [4.8.0] - 2026-09-02

### 4.8 互操作与交付强化

- **项目包往返强化**：projectId 幂等导入（命中→skip/overwrite 覆盖更新，杜绝后缀副本）+ 身份一致 + 包内 manifest（文件清单+sha256）

- **导入导出格式增强**：快照/版本历史文件导出与回导 + plan:table 回导

- **跨端资产互灌**：设备库可移植格式（MC 可消费）+ 技能库文件级 zip 导入导出

- **报告/评审强化**：评审包聚合版本历史 + 设计报告 + 校验 + 交付清单 + 评审 PDF

- **交付物清单与校验**：批次 manifest 逐文件 sha256 + 完整性校验（E008）

## [4.7.0] - 2026-09-02

### 4.7 部署运维与可观测

- **诊断中心**：系统信息 / 错误日志 / 崩溃 / 审计 / 性能快照一处可查 + 一键导出支持包（zip）

- **健康检查/自检**：环境（OS/arch/node/electron/磁盘）+ 引擎（AI Hub `/api/chat/health` + engine `cli:info`）+ 网络（cloud health，未配置跳过）+ 依赖（Python），可读报告 + 导出 JSON

- **本地遥测**：默认关闭（autolink-telemetry-enabled）+ 本地 telemetry.jsonl + redact 脱敏 + 体积上限裁剪 + 读/导出/清空，不联网

- **安装/升级体验**：三平台离线安装包 + 版本化 artifactName 打包配置校验 + 更新 UI 离线友好提示 + 下载完整性校验显示

## [4.6.0] - 2026-09-02

### 4.6 质量与测试体系

- **测试覆盖率门禁**：后端 pytest-cov（fail_under=55，实测 85.18%）+ 前端 vitest coverage；CI 覆盖率门禁 + 阈值常量单源（quality_thresholds.json）+ 基线棘轮只升不降（coverage_baseline.json）

- **测试数据资产**：6 个样例项目（64h100/128h100 多机柜/融合网/存储关闭/超节点/zcube）+ 清单 manifest + README，pytest/vitest 双端消费

- **测试报告**：聚合 pytest/vitest/golden/bench/模板校验 → reports/quality_report.json + HTML

- **质量仪表盘**：LogPanel「质量」tab（覆盖率/门禁/测试通过率/校验/性能基准，本地聚合）

## [4.5.0] - 2026-09-02

### 4.5 数据准确性与校验

- **一致性校验引擎**：规划↔设计（服务器/网络设备数）、设计内部（U 位冲突/越界/功率汇总/未上架/型号/端口引用）、设计→渲染（连接数/设备清单/命名模式）

- **导出数据核对**：output 批次产物与设计/规划状态核对（连接数/设备清单/BOM/命名/漂移）

- **IP 规划校验**：掩码合法性/子网重叠/网关冲突/越界/重复（校验 AIDC plan ipSegments 与 deviceList 网关）

- **AI 规划器准确性**：声称收敛比 vs 真实计算、声称应用 vs patch 重算、patch 引用真实配置键

- **校验报告**：校验面板（一键校验/严重度分组/定位/导出 JSON）+ 脚本门禁

## [4.4.1] - 2026-09-02

### 修复

- **存储网络关闭/融合网导出崩溃**：`NetworkDesignerV2.storage_servers_per_group` 仅在存储网启用分支赋值，存储网关闭或融合网（eth_combined）项目导出连接表时抛 `AttributeError`（该缺陷此前被无条件成功提示掩盖）。修复：默认值与融合网分支补 `storage_servers_per_group=0`；新增 3 例回归测试（默认值 / 存储关闭 / 融合网）。

## [4.4.0] - 2026-09-01

### 4.4 效率与自动化工作流

- **统一快捷键规范**（10 标准键：撤销/重做、命令面板、侧边栏、日志、新建、渲染、导出、项目面板、设置、Cheatsheet）+ Cheatsheet

- **批量操作增强**：批量渲染/导出/优化（并行/进度/失败汇总）

- **一键管线**：「规划(AIDC)→设计(机房/机柜)→渲染→导出」一键编排（步骤状态/可中断/重试）+ 模板批处理

- **最近/收藏/模板入口**：最近项目 + 收藏星标 + 欢迎页「从模板新建」

- **命令面板命令全集**（项目/设计/渲染/导出/批量/管线/最近收藏/模板/设置/快捷键）

## [4.3.0] - 2026-09-01

### 4.3 AI 智能体验深化（不含 Hermes）

- **命令面板**：Ctrl+K 命令面板（项目/设计/模板/常用，动态子命令，搜索/键盘导航/执行反馈）

- **AI 项目/模板操作工具**：list/create/update/delete/import/export/create_from_template/preview（8 工具，权限分级 + 校验 + 可读错误，对话内闭环）

- **对话深化**：摘要衔接、会话重命名/清理、确认卡片确认/取消闭环

- **技能/记忆深化**：技能库 list/详情/启用禁用 + 持久化 + prompt 缓存失效

- **AI 能力矩阵标准化**（8 维度）+ 无 Hermes/外部 Agent 平台审计

## [4.2.0] - 2026-09-01

### 4.2 稳定性与数据安全

- **项目备份加固**：自动备份轮转（20 份）+ 恢复三重校验（元数据/结构/校验和）+ 恢复前自动安全备份 + 全量一致性体检；与 snapshot/undo 协同

- **性能仪表盘**：LogPanel 新增「性能」标签（内存 / 操作耗时分类 / 渲染长任务 / bench 基准对比），本地采集不遥测

## [4.1.0] - 2026-09-01

### 4.1 视觉与品牌统一

- **主题系统 DTCG 化**：light/dark/system/**high-contrast** 四主题（`public/theme-init.js` 首帧前应用，无闪变 + 持久化）；高对比 WCAG AA（正文 21:1、次要 16.5:1、弱化 9.9:1、边界 3.8:1、focus ring 3px）

- **组件库视觉收敛到契约 token**：Button/Input/Select/Modal/Tabs/Dropdown/ContextMenu/Popover/Toast 消除硬编码色值，统一 radius/shadow/动效

- **品牌资产统一**（以 MC 为准、保留 AutoLink 产品名）：启动页/About/徽标渐变/字体栈对齐契约 primary

- **空态/加载/错误态统一**：新增 Loading/ErrorState 公共组件，EmptyState 收敛 token

## [4.0.0] - 2026-08-29

### 4.0 系列启动 · 工程基座与质量门禁

- **版本单源**：新增 `version.json` 单源 + `sync_version.py`/`check_version.py` + CI `check-version` 门禁；发布说明抽取（`extract_release_notes.py`）适配单源；修复 `package-lock.json` 版本漂移（3.6.3→3.7.7→4.0.0）

- **五门禁对等确认全绿**：E2E（Playwright 3 例）/ golden 19/19 / 模板 19/19 / 性能门禁 / 渲染安全基线

- **设计 token 契约对齐**（按《双端设计Token契约_v1.0》）：语义色/中性/surface/圆角/阴影/间距/动效/字体 + 断言单测防漂移

- **组件行为契约**：Modal/Popover/Toast/ContextMenu/Select/Tabs/Dropdown 行为契约测试（补齐 Popover 基础组件）

## [3.7.7] - 2026-08-29

### 双端最终打磨（v3.6：版本历史与评审 / 复用增强）

- **版本历史与评审（F1-1/2/3）**：基于 plan_history 的宏观参数**版本差异高亮**（`diffPlans` 字段级 diff）+ **历史版本对比/一键回滚**（回滚前自动存档当前版本为 `v{N+1}`、当前置为 `v{N+2}`，同步 project_config）+"本项目输出"**评审 PDF 导出**（A4 printToPDF，含宏观参数/拓扑摘要/设备清单/接线终端计数）

- **跨项目复制粘贴（F2-1）**：剪贴板升级为应用级（localStorage 序列化 + 256KB 守卫），复制机柜/设备后可**切换项目粘贴**；跨项目启用类型/总U/设备域兼容校验（冲突明细），入撤销栈可回退

- **撤销跨会话持久化（F2-2）**：撤销/重做栈持久化到 `<project>/output/undo_history.json`（rack）与 `undo_room.json`（room），防抖 800ms 写盘、容量受控（最近 20 条/1MB），重启后恢复可回退（fallback localStorage）

## [3.7.6] - 2026-08-29

### 双端打磨增强（v3.5：设计快照）

- **设计快照（AL-SNAP1/2/3）**：设计工具栏「保存快照」（命名，默认时间戳）+「快照列表」恢复/删除，恢复后矩阵↔柜内/功率一致且可撤销；快照序列化/恢复带版本校验（v1），会话内 localStorage 持久化（单快照 >2MB 跳过提示）；「本项目输出」导出设计快照 JSON（落 output/snapshots/ 出现在批次树）与导入（结构/版本校验、失败友好提示、导入前自动备份当前设计）

## [3.7.5] - 2026-08-29

### 双端打磨增强（v3.4：3D 增强）

- **等距视图旋转/缩放（AL-3D1/2/3）**：机柜等距视图支持旋转（左/右 90° + 连续微调 ±5°，0-359 环绕）与缩放（滚轮 + 按钮，0.5-2.0，变换原点居中）；视角状态按机柜会话内保持（`isometricView` store，切柜互不污染）；旋转后设备/高度/深度偏移随角度映射（等距风格，不引入 Three.js）

## [3.7.4] - 2026-08-28

### 双端打磨增强（v3.3：编辑撤销/重做 + 复制粘贴）

- **编辑撤销/重做（AL-UR1/UR2）**：机房与柜内编辑（上架/移动/批量/属性/删除/整表替换）支持撤销/重做；矩阵编辑（标记/批量/清空/删除/上架卸载）同支持；栈深上限 50、校验拒绝不压栈、分支丢弃；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键 + 工具栏「撤销/重做」按钮；跨 store 批量一次各压一条快照，撤销后矩阵↔柜内/功率/配色一致

- **复制/粘贴（AL-CP1/CP2）**：应用内剪贴板复制/粘贴机柜（设备 U 位映射 + 冲突明细 + 新柜「-副本」后缀）与设备（U 位校验 / 自动找位）；机房机柜格/空格、柜内 Header/设备行/空 U 位槽右键入口；粘贴纳入撤销栈

## [3.7.3] - 2026-08-28

### 双端打磨修订（v3.2：设计入口/步骤状态/导出收敛 + GPU 柜修复）

- **设计入口归属（AL-N1）**：中栏「工作台视图」拆出「机房设计」「机柜设计」两个独立入口（修复原坏链 `rack`）；移除组网渲染(main)内设计入口；`WorkbenchSubview` 并入 `roomdesign/rackdesign`；二级页签标签并入 5 语言 i18n

- **步骤状态（AL-N2）**：中栏条目右侧由静态 ①-⑤ 徽标改为动态状态（已完成/待操作/进行中），随设计就绪度/机柜就绪度/输出批次变化

- **导出收敛（AL-N3）**：移除机房设计/机柜设计子视图内导出按钮，统一到「本项目输出」导出（机房设计 Excel 三 sheet / 机柜设计 Excel 两 sheet，落 output/ 根目录 [根目录] 批次）

- **GPU 柜修复（AL-N4）**：机柜设计选中 GPU 柜不再触发「工作区 加载失败」（`loadRackLayout` 补 `totalU/device.type` 默认 + 设备类型容错 + 联动 `cabinetId` 校验）

## [3.7.2] - 2026-08-27

### 机房/机柜设计拆分 + 强编辑能力（v3.1 打磨）

- **设计拆分（M1-M3）**：工作台二级页签新增「机房设计」「机柜设计」两个独立子视图，以「定稿」衔接；矩阵↔柜双向联动与跨子视图导航；收敛旧两段式 `RackWorkbenchView`；清理死代码 `DataCenterTab`

- **编辑能力（M4-M6）**：机房右键信息编辑（机柜/格子属性）+ 同类机柜批量 + 框选批量；柜内机柜信息调整 + 设备拖拽强化（跨柜/冲突预判/无效落点）+ 同柜设备批量/U 位偏移；统一冲突校验（溢出/预留/占用/功率）+ 批量二次确认 + 冲突明细面板；类型/高度/功率变更后矩阵↔柜内/配色/功率汇总联动一致

- **双设计 Excel（M7）**：机房设计 Excel（机房平面图/机柜类型清单/机房汇总 三 sheet）+ 机柜设计 Excel（每机柜设计/上机表 两 sheet）

- **工作台优化（M8）**：移除左侧面板「本项目输出」中栏（成果查看由「输出结果」子视图/侧栏「输出」兜底）；工作台 Header 项目切换器（单项目降级纯文本）

- **决策**：本版不做 WebGL 3D（保留 2D + isometric 等距立体；真实 3D 列 v3.2+ 可选增强）

## [3.7.1] - 2026-08-27

### 打磨收口（v3.0 验收审计补齐）

- **机柜规划（M4 补齐）**：归档目录名补版本号（项目名-版本-时间）+ 归档完整设计渲染（机柜设计 Excel + 拓扑图 + 机房平面图）；矩阵落位按项目 `gpu_per_cabinet` 生效；批量应用整柜设计模板复制设备名称/功率并返回逐条冲突明细（U 位占用/溢出/顶部预留/功率超限）

- **项目输出保真（M5 补齐）**：交付包拓扑图优先用设计拓扑渲染（plan 兜底）；plan→设计映射补齐端口数/网络开关/收敛比

- **AI 能力（M6 补齐）**：模型自动拉取（保存配置后 30s 节流 + 失败静默降级静态目录）+ 模型下拉最新（本次拉取 > 已持久化 > 静态目录）；AI 对话内新增模板/项目导入导出工具（template_export/import、project_export/import，含 zip-slip 防护）

- **双端一致性（M7 补齐）**：更新图标 ArrowUpCircle → RefreshCw 对齐 MC（保留更新蓝点）

## [3.7.0] - 2026-08-26

### AIDC 双产品打磨优化 v3.0（机柜规划流程 / 拓扑展示 / 项目输出保真 / AI 能力扩展与独立进程 / 双端一致性）

- **机柜规划清晰操作逻辑（M4）**：① 机房布局定稿状态机——定稿后进入柜内规划，可撤销；② 柜内默认参数——每柜 GPU 数量可配置（非超节点默认 1）、默认上架 U 位（`top_reserved_u` 项目配置联动）、逐柜功率可编辑；③ 改布局处理——一键清空柜内设计 / 归档并清空（机柜设计导出到 项目名-版本-时间 版本目录）；④ 导出机柜设计 Excel（机柜平面图 + 每机柜设计 + 上机表 三 sheet）；⑤ NVL72 超节点上架调研（top_reserved_u=2 + gpu_per_cabinet=1 并入模板中心）

- **工作台拓扑展示修复（M1）**：子视图包装层补 h-full 恢复高度链（画布不再坍缩 0）、fit 包围盒未测量节点用估算尺寸、saved layout 极端坐标清洗

- **项目输出保真（M5）**：`plan_history` 版本历史入项目包往返；交付包扩大为设计级（plan.json + README + 拓扑图 + topology.json + rack_layout.json + plan_version 透传）；交付包可导入 AL（兼容仅 plan.json）；plan→设计映射增强（参数速率从设备模型推断 800G/400G/200G）

- **AI 助手修复与能力扩展（M3a/M3b/M6）**：Provider 显式超时 + max_retries=0（聊天无反馈根因）；**AI 改独立进程**——`al_ai_hub` FastAPI+SSE（端口 18722 + 本地鉴权 + 端口回收/运行守卫/401 重启重试，对齐 MC）；AI 对话内实现项目/模板 CRUD（创建/删除/更新/基于模板创建/文件读写/模板推荐 9 新工具 + 权限分级 + 别名）；完整工具清单提示词

- **双端一致性（M7）**：顶部图标顺序 Language→Theme→…→Update + 语言文字徽章；侧边栏 AI/output 图标对齐 MC（MessageSquare/FileCheck）+ 激活条 glow；AI 对话 markdown 改 prose 排版

- 后端新增 fastapi/uvicorn/sse-starlette/pydantic 依赖；PyInstaller 第二入口 `al_ai_hub`；测试新增 al_ai_hub 服务器/SSE Chat/aiHub.service 单测

## [3.6.3] - 2026-08-25

### 发布后体验打磨（v2.0）

- **关于界面重构**：移除「Logo 设计规范」与「键盘快捷键」入口（快捷键保留帮助菜单 + Ctrl+K）；布局对齐 MagicCommander——横排小 Logo + 标题 + 简介 + 功能列表 + 更新区 + 链接/许可 + 技术栈一行；清理 about.shortcuts/logoSpec 冗余 i18n key

- **模板内容校正**：10 套 400G 模板错引 100G 交换机改为真实 400G（S9825-64D / S9827）；昇腾 256 / NVL72-单架 / uec 速率-设备错配修正；400G/800G 参数交换机 QSFP-DD → OSFP 收口；QSFP-DD 光模块移出索引；README 设备数 120 → 126 全面更正；模板门禁新增速率匹配 + 旧 id 断言；健康检查兼容旧 id 别名

- **机柜上架方向化**：GPU / 存储 / 通算从底部向上、网络设备从顶部向下上架，顶部预留 2U（默认可配 `top_reserved_u`，新建向导可设置）；后端分配器 / 优化器 / 矩阵落位 / 手动上架移动同步方向与预留保护

- **柜内布局拖拽**：已上架设备块可拖拽到目标 U 位（复用移动校验），悬停高亮合法 / 非法落点（含顶部预留保护），与点击上架共存

- **文案一致性**：工作台第③步统一为「校对与输出」（与 MC 对齐）

## [3.6.2] - 2026-08-25

### 设备库 400G/800G 接口形态修正

- **400G 接口默认形态修正**：QSFP56 → OSFP（默认），端口可选 QSFP112

- **800G 接口统一为 OSFP**（原 QSFP-DD 修正）

- 覆盖 gpu_servers / storage_servers / switches 下共 18 处设备库 JSON + 前端默认接口模型

- 设备库表单 placeholder 同步更新为「如 OSFP/QSFP112」

## [3.6.1] - 2026-08-25

### 导出收敛 + 拓扑子视图视口修复

- **导出收敛**：AIDC 规划视图移除导出按钮（plan.json / 规划 Excel / 交付包 / 拓扑 PNG），导出统一到工作台「导出」视图

- **导出视图收敛为 2 个主按钮**：

  - ① **导出 MC 交付包**：读项目已保存 plan.json → `plan:aidc:export`(zip)，含 plan.json / README / 拓扑图，供 MagicCommander 导入；项目未生成 AIDC 规划时给出引导提示

  - ② **导出渲染结果（ZIP）**：保留既有渲染输出批次打包

- 新增 `utils/aidcDelivery.ts`（`macroToInput` 提升 + `exportDeliveryZip` 公共工具）

- **拓扑子视图视口修复**：`fitWithRetry` 改为「测量推进即重 fit」（不再 2s 超时停在部分测量偏移位置），keep-alive 隐藏→显示补一次自适应——拓扑全量可见，不再只看到局部

- e2e 新增「拓扑全量节点中心点在画布内」断言；端到端验证 AL 交付包 → MC 导入成功（22 台设备）

## [3.6.0] - 2026-08-25

### 打磨优化 M1–M6：安全 / i18n / 性能 / 便捷 / 联合回归

v3.6.0 为 AIDC 双产品打磨优化里程碑（AL+MC 联合）：安全加固、国际化收官、性能稳定、便捷美观与跨端收口。

#### 安全加固（M1）

- `ai:call` 动作白名单：白名单外动作拒绝；`plan:aidc` 相关路径字段 workspace 限界

- API Key 不再落 localStorage：前端存引用，密钥落后端 safeStorage

- 审计日志落盘前脱敏（api_key/token/password）；`shell:openPath/showItemInFolder` 调用面收敛

#### 国际化收官（M2）

- Toast 消息化（`messageKey+params`，ToastContainer 统一翻译）+ 高频路径中文 fallback 补齐

- 工作台二级页签 SUBVIEW_LABELS 7 项全量 i18n + 新建/空态/导出 18 处硬编码接入

- i18n 门禁：缺 key 即失败（对新增 key 生效，存量登记豁免）；导出文件名 ASCII fallback

#### 性能与工作台/导航（M4）

- 撤销快照降内存（位置增量 + 规模阈值降 limit）、hover 局部更新避免全量重建

- keep-alive 近 N 保活 + 右键批量关闭（其他/右侧/全部），卸载前状态持久化

- Worker 竞态防护 + 实例复用；千节点动画降频；后端临时 PNG 唯一后缀；记忆引擎写盘节流

- MenuBar 快捷键从 hotkeyRegistry 单源读取（消除双源漂移）；三步 Stepper 视觉强化；ActivityType 废弃标记 + ActivityBar labelKey 前缀统一 `nav:`

#### 便捷美观（M5）

- AIDC 新建并入项目创建向导（自定义网络/拓扑/AIDC 规划参数）；移除固定 64 台内联表单

- `window.confirm` 统一替换为项目 Modal 确认体系（ConfirmDialog）

- 机柜矩阵拖拽放置预览 + 无效落点红绿高亮；输出预览 loading 骨架 + 大表「仅前 500 行」提示

- 厂商目录单源化（constants/labels.ts）+ 空态「前往项目面板」联动高亮；Glossary v1.0 术语文档

#### 联合回归收口（M6）

- 拓扑过滤器 FilterType 收敛为英文枚举 + 标签映射（逻辑与显示分离，兼容多语言）

- i18n.test.ts 新增 Glossary v1.0 术语一致性门禁（error 级）

- 修复 M4 引入的 TopologyTab TDZ（map 回调引用未初始化 nodes）；e2e app 冒烟冷启动时序修复

- 双端全量回归：AL vitest 520 + pytest 1010 + e2e 3 全绿；MC vitest 152 + pytest 197 全绿

## [3.5.0] - 2026-08-21

### AIDC 智算中心规划 v1.2–v1.6

v3.5.0 为 AIDC（AI 智算中心）规划能力的大版本：自 v3.4.3 起完成 AIDC 规划引擎与 `plan:table` 契约 v1.2 对接、工作台三步流程化统一、机柜矩阵（GPU 1 柜 1 台）规划，并系统性优化渲染稳定性与设备库。

#### AIDC 规划与桥接集成

- AIDC 宏观规划 UI + `plan:aidc` 规划器（P1.3）

- 桥接集成 AL 侧 G0–G5：契约 v1.1 / 规划 UI 完整化 / 导出 / `design:from-gpus` / 设备库补全

- `plan:table` 契约 v1.2 + AIDC 项目化 / 规划可视化评审

- AL 移除互联 IP 生成（MC 地址分配器为唯一事实源，D22）+ 契约同步

- 设备库 H1–H3 纠错 14+7 合并 + AIDC 规划独立入口 / 整网拓扑化 / 入口分组

#### 工作台统一（v1.3–v1.6）

- 工作台统一：AIDC 规划应用到设计 + 流程化子视图 + 移除独立拓扑/机柜页

- 配置界面改上下布局（顶部 Tab 导航 + 下方内容，参考 MC）

- 工作台子视图按钮移至中栏 + 批量渲染/删除 + 时间戳批次

- 渲染结果查看/导出 + AIDC 规划置顶 + 配置界面优化；渲染结果导出改用 adm-zip

- 设置界面精简：保留 7 类，删除/合并 7 类

- v1.6：默认项目 / 二级页签 / 命名与依赖门禁 / 输出结果导航 + 工作台三步分组收尾

- 打磨：渲染稳定性 / 云开关 / 一级菜单 / About 精简 / 文档

#### 机柜矩阵（v1.4–v1.5）

- power 电源柜类型 + 默认配比自动布点 + 矩阵定义

- 平面布局 + 微调联动 + AIDC 机柜 = 矩阵（GPU 1 柜 1 台）

- 机柜两段式 / 视觉 / CLI / 菜单多语言

#### 渲染稳定与修复

- 修复大拓扑响应被 1MB 缓冲丢弃导致 design 悬空超时

- 拓扑设计/渲染拓扑不再一直转圈——边数上限降载 + 超时缩短

- 渲染门禁改软门禁：组网设计就绪即可渲染，机柜设计仅提示；按「组网设计有拓扑产出」判定

- 工作台 AIDC 按钮不再自动聚焦变蓝，非 AIDC 项目置灰

- i18n：步骤③标签改「渲染输出」，可见 UI 文案 i18n 迁移

#### 回归

- 前端单测 / 后端单测（991 用例基线）/ typecheck / lint 全绿；e2e 业务链路含机柜设计步骤，渲染结果断言改工作台结果卡材料标签

## [3.4.3] - 2026-08-13

### Logo 全渠道一致性修复

v3.4.3 为品牌一致性修复版：安装包/桌面/任务栏图标与启动动画、关于弹窗统一为增强版（sky→blue→violet 渐变）Logo，并同步 Logo 设计规范文档。

#### 根因

- v3.2.1 品牌主题升级将 `build/logo.svg` 更新为增强版后，`scripts/generate-icons.mjs` 未重新执行 → `build/icon.ico` / `icon.png` / `public/icons/icon.png` 仍为 v2.5 扁平旧版（时间戳 2026-07-30 < logo.svg 2026-08-06）

- `public/splash.html` 内嵌 SVG 自 v2.5 未更新（扁平版），版本号残留 `v2.5.0`

#### 修复

- 重新执行 `scripts/generate-icons.mjs`：从增强版 `build/logo.svg` 重新生成 `build/icon.png`(1024²) / `build/icon.ico`(16~256 多尺寸,文件头合法) / `public/icons/icon.png`(512²)

- `public/splash.html` 内嵌 SVG 替换为增强版（三色渐变背景 + 玻璃高光 + 内描边 + 腿/横线渐变 + 腿/节点辉光 + 5 高光圆点），版本号 `v2.5.0` → `v3.4.3`

- `docs/v2.5/logo_specification.md` 同步为增强版规格（几何 / 完整源码 / 渲染陷阱 / 尺寸适配 / 品牌流程 / 版本演进）

- 校验：exe 内嵌图标像素级检测含紫罗兰渐变（增强版独有）通过；splash 内嵌 SVG 与 `build/logo.svg` 逐 token 一致

#### 回归

- 本轮仅资源与文档变更（图标 / 启动动画 / 规范文档），无代码逻辑改动

- 本地全链路打包验证成功：渲染层 `npm run build` + 后端 PyInstaller（`dist/backend-dist/engine.exe`）+ electron-builder Windows NSIS（`AutoLink-Setup-3.4.3-win.exe`）

- 前端 473 / 后端 991 / typecheck / lint 沿用 v3.4.2 全绿基线

## [3.4.2] - 2026-08-11

### 交付修复与版本对齐

v3.4.2 为 3.4.1 的交付修复版：修复 PDF 报告图表中文标签缺字形（豆腐块）、平台更新检查版本对齐、计划文档状态同步与残留清理。

#### PDF 图表中文字体修复

- `exporter.py` 新增共享中文字体候选 `_PDF_FONT_CANDIDATES` 与 `_configure_matplotlib_cjk()`：功率分布柱状图 / 光模块成本饼图注册 CJK 字体（微软雅黑 → 黑体 → 文泉驿 → DejaVu 兜底），reportlab 正文字体循环复用同一常量，消除两处字体选择漂移

- 修复前图表中文标题/轴标签缺字形渲染为方块；修复后 Glyph 警告归零（实测 PDF 测试 7 passed / 0 Glyph warning）

#### 平台更新检查对齐

- `versions.json` 3.4.0 → 3.4.2（客户端更新检查提示与下载目标对齐；client.py 回退默认值 / test_api.py 断言同步）

#### 文档与清理

- 计划文档状态同步：客户端 `docs/v3.0/v3.0.X_开发计划.md` 标记 3.3/3.4 完成并补 3.4 路线图；平台 PRD / DEVELOPMENT_PLAN_V2 / PHASE8_OPS_PLAN / WEBSITE_OPTIMIZATION_PLAN 状态「待审批」→「已完成」

- 清理平台 `api/.uploads/` 分片上传残留（14 个 .part，目录已 gitignore）

#### 回归

- 平台端 112 用例全绿；客户端后端 991 用例全绿（含 exporter 变更）；前端 473 用例全绿（v3.4.1 基线，本轮无前端改动）

## [3.4.1] - 2026-08-10

### 安全加固与性能优化

v3.4.1 对客户端与云平台做整体安全加固与性能优化：平台端修复管理口令默认值与部署数据安全风险；Electron 修复路径穿越与凭据外带隐患；前端补齐高频面板 i18n；后端消除重复拓扑重建与两处 O(n²) 热点。

#### 平台端安全加固

- **管理口令强制**：移除 `ADMIN_TOKEN` 默认值（`mc-admin-2026`），未配置时管理 API fail-closed（503）；`provision-env.sh` / `.env.example` 自动生成随机口令

- **部署数据安全**：`remote-setup.sh` 移除删库命令；`deploy-ubuntu-tce.sh` rsync 排除 `*.db`/`.uploads`/`__pycache__` + 同步前远端 DB 快照

- **OAuth 安全**：回调校验 state（防登录 CSRF/回放）；`scan_sessions` 不再落明文 JWT（轮询即时签发）

- **其他**：修复 `analytics.py` 管理统计 `TOPIC_TEMPLATE` NameError（此前静默返回全 0）+ 管理统计 TTL 缓存；CORS 通配符收紧为域名白名单；`/public/stats` 加限流+缓存；templates 共享缓存按用户收藏态串读竞态修复；systemd 加 `--proxy-headers`；deploy.yml 移除 MC 部署残留；OAuth 回调地址统一 18721

#### Electron 安全加固

- **路径穿越修复**：`project:create` 模板参数与 `getFile/getFileBinary/deleteOutputFile/export:saveFile` 改走项目级路径限界，阻断跨项目读/删

- **凭据外带防护**：变更服务器地址自动清空 token；打包环境强制 https；token 明文回退仅限开发环境

- **生命周期健壮性**：pythonService `stop()` 清算队列 Promise、空闲 kill 竞态消除、队列/缓冲设上限

- **IPC 门禁补全**：room/config/atop/share 动态载荷接入 zod 校验；导出上限 500MB→50MB；更新下载完整性校验 + 检查去重；本地搜索 TTL 缓存

#### 前端 i18n

- 高频面板全部接入 i18n：机柜视图 / 智能修复 / 机房智能落位 / 批量优化 / 容量规划推荐 + ui 通用组件（Modal / Dropdown）

- 新增 5 命名空间 ~95 key，en / ja / ko / zh-TW 同步补齐（i18n 完整性测试强制 5 语言 key 集合一致）

#### 后端性能

- **O(n²)→O(N)**：机柜分配网段二级索引、V009 存储冗余单遍倒排统计

- （说明：designer 实例备忘录缓存与 `handle_design` 校验管线抽取经回归验证存在共享可变状态风险，已回滚为 v3.4.0 原逻辑——`design` 执行路径与 v3.4.0 完全一致）

#### 回归

- 平台端 112 用例全绿；客户端 vitest 473 全绿 + typecheck/lint 0 error；后端 991 用例全绿；golden 19/19 模板一致；性能门禁达标（2048 GPU 设计 0.38s、225 柜落位 0.07s）

***

## [3.4.0] - 2026-08-10

### 云端协作与官网品牌化（v3.4）

v3.4 在 3.3 云端底座之上补齐协作运营能力（服务端 S3 平台增强）与官网品牌化，客户端随服务端就绪分批联动（V4-1~V4-4）。

#### 服务端 S3 平台增强

- **S3-1 项目 Fork**：`POST /projects/{o}/{r}/fork`，公开项目可 Fork 到任意用户空间，fork 后自动打 `autolink-project` topic（私有项目拒绝、owner 自身 409）

- **S3-2 模板市场统计**：模板下载 / 安装计数统一落 analytics.db，`/templates/{o}/{r}/stats` 返回 `downloads` + `usages`；下载端点自动记录 `template_download` 事件

- **S3-3 通知与公告**：新增 `announcements` 表 + `/client/notifications` 读取 + `/admin/notifications` 增改删（admin token 鉴权）

- **S3-4 公开统计 topic 化**：`/public/stats` 按 `autolink-template` / 项目仓库分页统计并排除 `magiccommander-*` 仓库

- **S3-5 大文件分片上传**：`/uploads/init|chunk|progress|complete` 四端点，单文件突破 5MB 限制（≤100MB），支持断点续传（progress 跳过已传分片）

#### 客户端 V4 联动

- **V4-1 项目 Fork**：云中心公开项目新增「Fork 到我的空间」按钮（七层贯通，Fork 后刷新我的项目列表）

- **V4-2 模板统计展示**：模板市场列表展示下载数 + 安装计数（批量拉取 `/stats`）

- **V4-3 公告横幅**：云中心顶部拉取 `/client/notifications` 展示公告（可关闭、支持链接跳转）

- **V4-4 大文件分片上传**：项目推送时 >3MB 文件自动走分片上传 + 断点续传，其余走批量

#### 官网品牌化（S3-6）

- Astro 官网全量去 MagicCommander 品牌 → AutoLink，域名 `al.evergreenzhou.com`

- 根域 `evergreenzhou.com` 提供 AutoLink / MagicCommander 双入口导引页

- changelog 重写为 AutoLink 版本史；`versions.json` 指向 AutoLink releases（3.4.0）

- nginx 多域名配置 + 部署脚本含官网构建

#### 回归

- 平台端 112 用例全绿（新增 fork / stats / 公告 / 分片 / 公开统计测试 24 个）

- 客户端 vitest 全绿 + typecheck 通过

***

## [3.3.3] - 2026-08-08

### 3.X 收官发布

v3.3.3 收官 3.X 系列云端集成：登录 → 云中心/全局搜索 → 分享与模板市场全链路落地，并与 MagicCommander 完成产品隔离；全量回归（前端 473 + 后端 991 + 平台端 94 + E2E 3 条 + 模板/golden + 性能门禁）全绿。

#### 用户登录与账号体系（T14-7）

- 飞书 / QQ / 微信三通道扫码登录，JWT 会话 + 主进程 safeStorage 保管凭据（渲染层零接触）

- 账号体系：用户资料 / 社交绑定 / Gitea 凭据（登录云平台）/ 云平台健康检测

- 模板市场入口与云中心均带登录态校验

#### 云中心与全局搜索（T15-1）

- 云中心：仪表盘 / 云端项目与模板 / 项目同步（六态 SHA 比对）/ 分享链接管理

- 全局搜索：本地 + 云端二合一搜索（搜索置顶为一级功能，AI 次之）

- 侧栏云端项目分组：登录后项目侧栏展示云端项目，一键跳转云中心

- 共享 Gitea + 并行 API 实例：`/autolink-api/` 独立网关，S1 P0 端点 + S2 上线

#### 分享与模板市场（T15-2 / T15-3）

- 分享链接：项目右键「创建分享链接」→ 只读方案快照上传 → 免登录静态预览页（token 化 / 过期 / XSS 防护 / 2MB 限流）

- ZIP 加密导入导出：自实现 ZipCrypto（PKWARE）加密重写，密码二次确认 + 强校验

- 模板市场增强：AutoLink 品类体系（GPU/存储/网络/通用）+ 收藏星标与「我的收藏」过滤 + 权限管理（所有者 / 可编辑 / 只读，共享成员授权与撤销）

- 私有模板访问控制：非授权者不可读详情 / 下载 / 文件

#### 产品隔离（§24.3）

- AutoLink 项目仓库打 `autolink-project` topic、模板 `autolink-template`，列表双向排除 `magiccommander-*` / `autolink-*` topic 仓库

- MagicCommander 侧以补丁文件交付（`mc_projects_isolate.patch`），`git apply --check` 校验通过

#### 回归与发布

- 全量回归：前端 473 用例全绿、后端 991 用例全绿、平台端 94 用例全绿、E2E 3 条全绿、模板 19/19 + golden 一致、性能基准达标、安全断言（渲染层 0 直接网络 / 0 Node 访问）

- 用户指南新增「3.X 特性矩阵」（v3.0.0 ~ v3.3.3 全版本能力归属）

- 版本号 3.2.3 → 3.3.3（package.json / package-lock.json / VERSION / README / 部署指南 / 用户指南）

***

## [3.2.3] - 2026-08-06

### 质量闭环

v3.2.3 收官 3.2 系列质量闭环：3.X 本地能力全量回归（前端 467 + 后端 991 + E2E 3 条 + 性能基准 + 模板/golden）全绿，用户指南补全本地能力矩阵，版本同步发布。

#### 全量回归（T12-1）

- CI check + e2e 全绿：typecheck / lint（0 error）/ vitest 467 / pytest 991 / 模板 19/19 / golden 一致 / 性能基准达标（2048 设计 ≤30s、225 柜落位 ≤5s）

- E2E 3 条全绿：启动冒烟 + 主题色切换 + 业务链路（建项目 → 生成拓扑 → 一键渲染 → 机房落位）

- 安全断言通过：渲染层 0 直接网络 / 0 Node 访问

#### 用户指南本地能力矩阵（T12-2）

- 用户指南新增「本地能力矩阵」章节：核心能力全部离线可用（项目管理/拓扑设计/设备选型/机柜规划/机房落位/校验修复/容量规划/ATOP/可视化/导出），AIHUB 与自动更新需网络，云功能（V3.3）标注规划中

#### 版本与发布（T12-3）

- 版本号 3.2.2 → 3.2.3（package.json / package-lock.json / VERSION / README / 部署指南 / 用户指南）

- PRD / 开发计划标记 v3.2.3 完成

***

## [3.2.2] - 2026-08-06

### 安全与性能加固

v3.2.2 落地纵深安全与质量门禁：Electron 沙箱 + CSP、IPC 运行时校验与日志脱敏、崩溃可回收、关键路径性能基准与业务链路 E2E 全部纳入 CI，并预留 Windows 代码签名通道。

#### 纵深安全（T11-1）

- 主窗口开启 **sandbox**（preload 仅用 contextBridge/ipcRenderer/process.versions，沙箱兼容验证通过）；渲染层保持 contextIsolation + 零 Node

- **CSP 注入**：`session.webRequest` 按环境注入（dev 兼容 React Refresh inline preamble 与 Vite HMR，prod 收紧为纯 self）；index.html / splash.html 加 meta 基线（交集仍为严格策略）

- **IPC zod 运行时校验**：13 个动态载荷通道接入门禁（project:createWithConfig、ai:call/chat、room:optimize、config:apply-preset/import、optimize:apply、repair:apply、capacity:recommend、export:saveFile、shell:openExternal、device-library:save/import），仅校验不剥离扩展字段

- **日志脱敏**：新建 `electron/utils/redact.ts`（apiKey/token/password/sk- 自动遮蔽），主进程错误日志、Python 子进程 stderr 尾部与崩溃信息统一脱敏

- **CI 安全断言**：渲染层 grep 检查 0 直接网络 / 0 Node 访问

#### 崩溃可回收（T11-2）

- `crashReporter` 本地崩溃转储（不上传）+ 未捕获异常/未处理拒绝脱敏留痕（userData/logs/errors.log）+ 渲染进程崩溃自动 reload 恢复

#### 性能基准与门禁（T11-3）

- 新建 `scripts/bench_perf.py`：2048 GPU 设计（实测 ≈1.1s，达标 ≤30s）+ 225 柜落位（实测 ≈0.11s，达标 ≤5s）全达标，无需优化，已入 CI 门禁

#### 业务链路 E2E（T11-4）

- 新建 `e2e/business.spec.ts`：新建项目（5 步向导）→ 生成拓扑 → 一键渲染导出 → 机房落位（IPC 直调全链路）自动化；CI e2e job 补 Python 引擎依赖

#### 自动更新与签名（T11-5）

- 双通道自动更新保持（electron-updater 主路径 + GitHub 直下 fallback）；build.yml 预留 Windows 代码签名（secrets CSC_LINK / CSC_KEY_PASSWORD 可选启用，未配置时保持未签名——SmartScreen 提示为已知限制，latest.yml 哈希保证下载完整性）

#### 版本与回归

- 版本号 3.2.1 → 3.2.2（package.json / package-lock.json / VERSION / README / 部署指南 / 用户指南）

- 回归：前端 467 用例全绿（28 文件）、后端 991 用例全绿、typecheck / lint（0 error）、模板 19/19、golden 一致、性能基准达标、业务链路 E2E 通过

***

## [3.2.1] - 2026-08-06

### 品牌主题色 + Electron E2E 门禁 + AI 入口修复

v3.2.1 落地品牌化与质量门禁增强：可切换的品牌主题色（4 色）、Electron 级 E2E 冒烟测试纳入 CI，并修复活动栏 AI 入口点击导致整界面白屏的渲染崩溃。

#### 品牌主题色（T10-1）

- 设置 → 外观新增**主题色切换**：天空蓝 / 翡翠 / 紫罗兰 / 玫瑰 4 色（默认 sky）

- `--primary-*` 设计 token 改由 CSS 变量驱动（`html[data-accent]` 整体切换），亮/暗色与全端组件（含拓扑画布、图表）即时生效，重启持久化

#### Electron E2E（T11-4）

- 新增 Playwright + Electron 应用级 E2E：启动冒烟（窗口/渲染根/活动栏）＋ 外观主题色切换联动验证（T10-1）

- CI 新增 `e2e` job（xvfb-run + playwright install-deps），三平台兼容，纳入发布门禁

#### AI 入口修复

- 修复点击活动栏「AI 对话」图标导致**整界面白屏**：`ACTIVITY_COLORS` 缺失 `ai` 语义色，渲染高亮时 `colors.icon` 抛 TypeError，未包裹 ErrorBoundary 使整棵 React 树卸载

- 补齐入口行为：点击 AI 图标现会打开 AI 对话标签页（此前仅高亮侧栏无实际内容）

- 品牌视觉：Logo 品牌渐变更新（sky→blue→violet 三色）

#### 版本与回归

- 版本号 3.2.0 → 3.2.1（package.json / package-lock.json / VERSION / README / 部署指南 / 用户指南）

- 回归：前端 467 用例全绿（28 文件），后端 991 用例全绿，typecheck / lint（0 error）通过；GitHub Releases/Tags 精简至每大版本首个发布（v2.7.0~v3.2.0 共 6 个）

***

## [3.2.0] - 2026-08-06

### 智能化增强（容量规划 v2 + ATOP 拓扑优化 + 批量优化/智能修复闭环 + 国产档案库）

v3.2.0 落地智能化增强全链路：FP8 精确容量计算与 TCO 成本估算、ATOP 式自动拓扑推荐（模型通信特征 → ZCube 拓扑）、批量优化与智能修复双闭环、国产芯片场景档案库扩充——从"算得准"到"推荐优、改得快、覆盖广"。

#### 容量规划 v2（T9-1）

- `comm_calculator.py` 新增 FP8 分块精度模型：激活/梯度/优化器状态按块结构精确估算通信量，输出与解析法误差对照（实测 12.5% < 15%）

- Pipeline 建模：`estimate_pipeline_memory` 按 pp 分段（每 stage 参数 1/pp + 激活峰值）

- 新增 `cost_estimator.py`：TCO 全口径（交换机/网卡/光模块硬件 + 电力含 PUE + 机柜空间分项 + 单价覆盖）

- `presets.py` 支持自定义档案（`register_preset` / 工作区 capacity_presets.json 加载）；`capacity:recommend` 返回 `{exact, pipeline, cost}`；前端 `CapacityRecommendModal` 增 FP8 精确通信量（误差对照）/ Pipeline 分段显存 / TCO 分项展示

#### ATOP 式自动拓扑优化（T9-2）

- 新建 `backend/atop/`：`features.py`（模型通信特征：AllReduce/All-to-All/P2P + 通信占比提取）+ `recommender.py`（特征 → ZCube 2D/3D cube 尺寸/分组/拓扑推荐 + V020 校验接入）

- `zcube_topology.py` 新增 `build_cube_topology_data`：GPU 按 cube_rank 编号、A/B 组均衡分组着色（zcube_group/plane_id）、双向边链路元数据，输出前端拓扑 schema

- action `atop:recommend` + AIHUB 工具 `atop_recommend`（AUTO）+ CLI schema + IPC 桥接

- 前端 `TopologyTab` 新增 ATOP 按钮 + `ATOPRecommendModal`（特征摘要/cube 维度/Leaf 统计/校验结果/推荐理由 + 一键应用到画布，复用双平面着色）；端到端 deepseek-v3 1024 卡：alltoall 主导、11×11×9 3D cube、V020 校验通过、1056 节点 8704 链路可渲染

#### 批量优化（T9-3）

- 新建 `backend/optimization.py`：确定性规则引擎批量产出结构化建议 `{category, title, description, patch, impact}`（收敛比双路径降下联/提交换机端口档位、成本降档、散热匹配）

- `optimize:suggest`（AUTO 只读）+ `optimize:apply`（NOTIFY 写）+ CLI schema + AIHUB 工具 + 别名

- 前端 `ChatPanel` 工具栏「批量优化」+ `BatchOptimizePanel`（建议分组列表 + 全选/逐条 → 批量应用落盘）

#### 智能修复（T9-4）

- 新建 `backend/fixit.py`：7 个 rule_id 级修复器（V002 机柜功率 / V007 Rail / V010 收敛比 / V016 网卡容量 / V018 Scale-Up 域 / V019 供电 / V020 ZCube）

- `repair:plan`（只读：校验 → 可自动修复项生成 patch）+ `repair:apply`（写：应用 patch → 落盘 → **复核** remainingErrors 下降闭环）

- 修复预存 bug：V001/V010 收敛比规则读取 snake_case 而 engine 输出 camelCase → 收敛比 error 从未触发；新增 `_cv` 双键兼容读取恢复生效

- 前端 `ChatPanel` 工具栏「智能修复」+ `RepairPanel`（错误项列表 + 修复 patch 预览 + 需人工处理分组 + 全选/逐条 → 一键修复 → 显示复核结果）

#### 国产档案库扩充（T9-5）

- `presets.py` 新增 5 个国产场景档案（昇腾 910B / 910C、寒武纪思元 590、海光 DCU、昆仑芯 P800），内置档案 12 → **17**

- 每项带来源标注（`source` 内置/国产 + `vendor` 芯片厂商）；`capacity:list-presets` 返回 `domesticCount` 统计；`resolve_preset` 支持名称子串模糊匹配（'昇腾 910B'）

- 前端 `CapacityRecommendModal` 下拉国产档案带「国产」前缀标注

#### 版本与回归

- 版本号 3.1.4 → 3.2.0（package.json / package-lock.json / VERSION / README）

- 回归：后端 991 用例全绿（含 AIHUB 47，新增容量规划 + 国产档案用例），前端 467 用例全绿（28 文件），typecheck / lint（0 error）通过

- PRD §5.12 验收标准 4 项全部达标

***

## [3.1.4] - 2026-08-06

### AI 智能落位 + 质量闭环

v3.1.4 落地机房智能落位全链路：约束满足 + 多目标优化内核、矩阵落位可视化与手动调整、对话驱动落位闭环（AI 工具 + 技能），机房体验与 AI 体验双升级。

#### 落位优化内核（T8-1）

- 新增 `backend/room_optimizer.py`：`room optimize` CLI / action，输入双模式（`counts` 类型→数量含中文键别名 / `cabinets` 具体机柜优先）

- 约束满足：占位（空调/柱）跳过、机柜类型域匹配（combined/empty 任意）、单柜功率上限超限整体拒放、保留手动放置（`reset_existing` 清空重排）

- 算法：全局互斥候选格 + 贪心分簇（类型簇中心 + 功率降序 + 区域负载最低优先 + 离簇近）+ 时间预算内迭代重分配；**约束最多优先**排序修复类型互斥挤占（225 柜 100% 落位）

- 四维可配置目标评分：功率均衡（区域功率变异系数）/ 散热分区（高功率柜至空调柱距离）/ 网络就近（网络簇聚度）/ 布线最短（同类型簇内聚度），0~1 + 加权总分；225 柜实测 <120ms ≤5s

- 输出 `{placements, scores, issues, stats}`；`engine.py` 注册 `room:optimize`（matrix dict 优先，缺省按 project 读 room_layout.json）

#### 落位结果可视化 + 手动调整（T8-2）

- electron IPC `room.optimize`（preload + handlers + electron.d.ts）；`room.store.ts` 新增 `runOptimize` / `optimizeCabinets`（默认仅提交未上架机柜，避免与已上架格重复；resetExisting 全量重排）/ `optimizeCounts` / `applyOptimize`（cabinetId + 类型标记更新，保留手动放置，占位越界保护）

- 机房矩阵工具栏「✨ 智能落位」入口 + `RoomOptimizeModal`：按机柜 / 按数量双模式，方案预览（已落位/未放置 + 四维评分 + issues），确认应用后可继续拖拽手动调整（复用 checkMount 即时校验）

#### 对话驱动落位闭环（T8-3）

- `room:set-type`（标记类型）/ `room:place`（上架/移除，复用 RoomConstraints 占位/类型域/功率校验 + 移动语义）/ `room:create` 支持 `project` 落盘（补齐对话矩阵创建），均兼容 `projectName` 别名

- AIHUB 注册 `room_optimize` / `room_set_type` / `room_place`（NOTIFY：方案返回 / 写操作需前端确认应用）+ 别名修正 + 技能 `room-layout.md`（"225 柜按 120 GPU+60 网络+45 存储落位，柱子别挡" → 矩阵检查/创建 → counts 解析 → optimize → 前端确认应用闭环）

#### 版本与回归（T8-4）

- 版本号 3.1.3 → 3.1.4（VERSION / package.json / package-lock.json / README）

- 回归：后端 916 用例全绿（新增 room_optimizer 22 + room_edit 18 + AIHUB 工具/权限 5），前端 457 用例全绿（room.store +18、RoomOptimizeModal 组件 5），typecheck / electron tsc / lint 通过

- PRD §5.11 验收标准 4 项全部达标；用户指南新增 6.5「机房智能落位」章节

***

## [3.1.3] - 2026-08-05

### 对话管理 + 需求/示例生成 + 容量规划内核（AI 能力增强）

v3.1.3 落地 AIHUB 管理域对话工具集与"轨道 B"需求生成闭环：设备/模板/项目管理对话查询、自然语言需求 → ProjectConfig 预览 → 确认落盘、示例文件解析、容量规划内核（解析法预估值）、共享选型规则双端一致。

#### 对话管理工具集（T7-1）

- 后端新增管理域只读 action：`device:list`（复用 device_library.py）/ `template:list` / `template:view` / `project:list` / `project:info`

- AIHUB 注册 5 工具（权限 AUTO）：`device_query` / `template_list` / `template_view` / `project_list` / `project_info` ——"有哪些 H100 服务器？""列出可用模板""打开项目 X"四类管理对话闭环

#### 需求生成（T7-2）

- `project:generate`：migrate_config → `_deep_merge` 默认值补全缺失键 → `validate_config(strict=False)` 宽松校验 → `_annotate` 置信度/缺失字段标注（只预览不落盘）

- AIHUB 工具 `generate_project`（NOTIFY）+ 技能 `requirements-generation.md`（规模/协议/速率/网络/机柜要素抽取 + `project-config` 预览输出块约定）

- 前端 `ProjectConfigPreview` 卡片：对话内预览（可编辑）+ 置信度徽标 + 缺失字段 chips + 校验问题 + 确认创建落盘

#### 示例文件解析（T7-3）

- 新增 `backend/file_parser.py`：Excel(pandas)/JSON(project-config 结构识别)/CSV/文本 → 结构化数据（只读 + 截断）

- AIHUB 工具 `parse_file`（AUTO）+ agent 附件路径注入（parse_file 前置）+ 技能 `parse-examples.md`（示例 → 要素 → generate_project 闭环）

#### 容量规划内核（T7-4）

- 新增 `backend/capacity_planning/` 包：12 模型档案 + 模型解析 + 通信量估算（AllReduce/All-to-All/P2P，预研文档公式）+ 拓扑推荐（Scale-Up/Scale-Out/收敛比/层数）+ 经验规则（MoE≤1.2/FP8×1.5/长上下文 NVLink/>1024 三 tier/预算档位）

- `capacity:recommend` / `capacity:list-presets` action + AIHUB 工具 `capacity_recommend`（AUTO）+ CLI schema

- 前端 `CapacityRecommendModal`：模型/GPU/预算 → 推荐结果 → 一键应用映射（param_speed/param_protocol/num_servers）+ DesignTab 顶部入口

#### 预估值/置信度标注（T7-5）

- `project:generate` 返回 `annotations{confidence, missingFields, derivedFields}`；`capacity:recommend` 返回 `estimated=true` + `estimation{label/method/accuracy/note}`（解析法预估值 ±15-20%）

- 工具描述注明预估值/置信度提示，LLM 需向用户说明

#### 共享选型规则（T7-6）

- `src/utils/device-defaults.ts` + `backend/device_defaults.py` 双端同一套映射（IB 按 GPU 世代 h100→MQM9700 400G / b300、gb300→Q3400 800G；RoCE→H3C；存储按协议 IB→Quantum HDR 200G / RoCE、UEC→CE6881；业务/带外固定默认）

- WizardStepDevices 内联规则全部移出改 import；`device:defaults` action + AIHUB 工具 `device_defaults`（AUTO）+ 技能 `device-selection.md`——LLM 与向导共用同一份默认映射

#### 版本与回归（T7-7）

- 版本号 3.1.2 → 3.1.3（VERSION / package.json / package-lock.json / README）

- 回归：后端 868 用例全绿（v3.1.2 基线 853），前端 436 用例全绿（基线 429），typecheck + electron tsc 通过

- PRD §5.10 验收标准 3 项全部达标：轨道 B 闭环（1024×B300 双平面 800G IB 收敛比 1.2 ≤1.5）/ 管理域四类对话闭环 / 示例解析 + 容量一键应用

***

## [3.1.2] - 2026-08-05

### AIHUB 响应延迟优化（纯性能版 · 不加新功能）

v3.1.2 聚焦 AIHUB 对话链路响应延迟：首字延迟 TTFT / 工具执行前延迟 TTA / 流式渲染流畅度 / 长任务可靠性。本地 mock 基准实测（同一脚本在 v3.1.1 tag 与 v3.1.2 对比）：**TTA 降 57.3%（1.087s → 0.464s）**、本地链路口径 **TTFT 降 62.5%（0.419s → 0.157s）**、配置同步固定开销 **-99.3%（~264ms → ~1.9ms/次）**。

#### TTFT 优化（T6-1 ~ T6-4）

- Provider 配置去重同步：前端记录配置指纹（apiKey/model/baseURL），仅首次/变更时下发；后端 `configure_provider`/`set_default_provider` diff 更新，无变化跳过写文件与全量重建（幂等，返回 `changed`）——连续对话仅首次同步

- system prompt 缓存：`get_system_prompt` 按 (mode, project, version) 缓存，reload/skills/memory 变更时失效重建——连续对话不重建

- asyncio 事件循环复用：engine 全局 `_get_ai_loop`，`ai:chat`/`ai:test`/`ai:models` 复用而非每次新建（消除 loop 泄漏隐患）

- AI Hub 启动预热：engine main 启动即 `init_hub()`（幂等，失败延迟懒加载）——首次对话零冷启动

#### TTA 优化（T6-5）

- 工具调用流式早停：`run_stream` 增量检测完整闭合的 tool call（\`\`\`tool_call JSON / 独立 JSON / XML `<invoke>`），完整即终止生成并立即执行（`stream.aclose()` 清理）——不再等 LLM 完整输出，工具执行前延迟显著下降（实测 -57.3%）

#### 流式渲染流畅度（T6-6）

- rAF 节流合并 chunk：每帧批量 setState，仅更新目标消息（避免全量 sessions/messages map 重建）——长会话流式不卡顿

- 修复 `createSession` 同毫秒 id 冲突（`session_${Date.now()}` → 加递增序号，避免误删/覆盖）

#### 长任务可靠性（T6-7）

- 60s 硬超时改为活跃超时：最后一次 chunk 起算 60s 无输出才超时——长工具链 >60s 不中断

- 历史摘要压缩：`_compress_history` 上下文字符超阈值（24k）时，早期历史折叠为摘要占位 + 保留最近 10 条——LLM 输入 token 受控，越聊越慢问题消除

#### 性能基准与回归（T6-8）

- 新增 `scripts/bench_aihub_latency.py`：TTFT/吞吐 + 工具早停 TTA + 配置同步 3 场景，同一脚本可在 v3.1.1 tag 与 v3.1.2 下对比运行

- 新增用例：后端 +13（配置幂等/默认幂等/prompt 缓存 ×3/事件循环/预热/早停 ×4/历史压缩 ×2），前端 +4（去重同步 ×2/流式合并/活跃超时）

#### 版本与回归

- 版本号 3.1.1 → 3.1.2（package.json / VERSION / package-lock.json / README）

- 回归：后端 804 用例全绿（v3.1.1 基线 784），前端 417 用例全绿（基线 413），typecheck 通过

***

## [3.1.1] - 2026-08-05

### AIHUB 对话框架 + 命令审计日志（3.X 系列 · AI 能力）

v3.1.1 落地 AIHUB 对话框架移植（复用 engine 进程，零新增子进程）：Agent 循环 / 工具白名单 / 9 厂商 LLM Provider / 前端对话与智能答疑闭环；AI 每次工具调用经 `cli.execute` 自动落审计日志（R5.7 留轨迹）。

#### AIHUB 后端移植（T5-1 ~ T5-3）

- 新增 `backend/autolink_hub/`：config（secrets 落 `$AUTOLINK_USER_DATA/ai_secrets.json`，键名脱敏）、llm/provider（9 厂商 OpenAI 兼容 + reasoning_content 收集）、agent（run_stream 循环 + validator + recovery + planner + context + 权限分级表）、memory / skills / prompts（JSON 持久化 + md 拼接 system prompt）

- 工具层白名单：13 工具（设计/导出/机房/配置/项目配置域）经 `cli.execute(action, params, argv=["ai:..."])` 同进程直调 —— UI / CLI / AI 三入口同一执行路径，权限分级 AUTO🟢/NOTIFY🟡/CONFIRM🔴

- 引擎注册 7 个 `ai:*` action（chat/providers/config/config-default/test/models/clear），流式回复复用 `emit_event` 通道；`ai:*` 自动映射为 CLI `ai` 域

#### 智能答疑 + 审计（T5-6 ~ T5-7）

- 统一校验管线 `_run_validation`：`validate` action 现返回 `{valid, errors, validationIssues}` —— validation 引擎 22 条规则（V001-V022）每条含 `recommendation` 修复建议，供 AI 直接引用答疑

- 命令审计日志：每次执行写 `userData/audit/cli-audit.jsonl`（时间/action/命令/参数脱敏/结果）；设置新增「诊断」分类，展示 CLI 能力信息 + 审计日志（AI 调用以 AI 徽标标记）

#### 前端对话（T5-4 ~ T5-5）

- IPC 桥接：`ai:chat` 独立通道（流式 `aihub:stream` 带 sessionId）+ preload `aihub` 命名空间 + 类型完备

- `chat.store`（会话/消息/流式追加/首条标题/附件/60s 超时）+ `ChatPanel`/`ChatMessageBubble`（markdown + 计划块可视化）/`ChatInput`/`PlanDisplay` 组件

- ActivityBar AI 入口（Ctrl+Shift+A）+ Settings AI Tab（9 厂商 BYO-Key 密码显隐/测试连接/拉模型/设默认）+ `chat` 命名空间 5 语言 + i18n 完整性测试

- 无 Provider / 无网络时降级 mock 回复（设置徽标提示）

#### 测试与打包（T5-8）

- 新增 `tests/backend/test_autolink_hub.py` 23 用例（provider 注册/工具白名单/权限分级/validator/recovery/tool_call 3 格式解析/agent 循环 mock LLM/审计留痕与脱敏）

- 新增 `src/test/chat.store.test.ts` 12 用例（会话/消息/模式/附件/流式追加/mock 降级）

- `requirements.txt` 加 `openai`/`httpx`；`pyinstaller.spec` 补 hiddenimports（openai）与 datas（prompts/skills md）

#### 版本与回归

- 版本号 3.1.0 → 3.1.1（package.json / VERSION / package-lock.json / README）

- 回归：后端 784 用例（+23 test_autolink_hub）全绿，前端 413 用例（+12 chat.store + i18n 完整性）全绿，typecheck 通过

## [3.1.0] - 2026-08-05

### CLI 显式能力层（3.X 系列 · 对外接口）

v3.1.0 落地 CLI 显式能力层：全部后端能力经 `autolink-cli` 命令行对外暴露，UI 与 CLI 共用同一执行路径（engine 路由经 `cli.execute()`），行为完全一致，并为 v3.1.1 AIHUB 的 AI 留轨迹（R5.7）铺路。

#### CLI 能力层（T4-1 ~ T4-2）

- 新增 `backend/cli.py`：注册表驱动 argparse 子命令树（`a:b` → `a b`，新增 action 零改动自动获得 CLI）、9 域 14 action、`ACTION_PARAM_SCHEMA` flag 定义 + 通用 `--json '<params>'` 兜底（无 schema 新 action 自动降级可用）

- 输出层 `--format json/ndjson/text`（stdout 仅含命令输出，模块调试 print 重定向 stderr，管道解析安全）；统一入口 `execute(action, params, argv)`（handler 校验 + 审计 + 执行）

- `engine.py` main() stdin 路由改经 `cli.execute` —— UI 与 CLI 同一执行路径，python.service.ts 协议层零改动

#### IPC 桥接与审计（T4-3）

- handlers.ts / preload / electron.d.ts 新增 `cli:info`（CLI 版本 + action 清单）与 `cli:audit`（审计日志 tail 查询，limit 默认 200）IPC

- python.service.ts spawn 注入 `AUTOLINK_USER_DATA`，每次执行写 `userData/audit/cli-audit.jsonl`（时间/action/命令/参数脱敏/结果，失败留痕），v3.1.1 AI 留轨迹直接复用

#### 测试与文档（T4-4 ~ T4-5）

- 新增 `tests/backend/test_cli.py` 25 用例（自动映射/参数解析/输出格式/命令级 golden/审计脱敏），并入后端 pytest 门禁

- 新增 `docs/cli.md`：安装使用 / 9 域速查表 / 每命令示例 / JSON-NDJSON 输出 / GUI 等价性 / 审计日志说明 / 退出码

#### 版本与回归

- 版本号 3.0.4 → 3.1.0（package.json / VERSION / package-lock.json）

- 回归：后端 768 用例（+25 test_cli）全绿，typecheck 通过

## [3.0.4] - 2026-08-05

### 机房矩阵可视化 + 配置体系重构 + 质量闭环（3.X 系列 · 引擎与组网基础）

v3.0.4 落地原 v3.0.3 规划的两大能力：机房矩阵可视化（矩阵定义/占位类型标记/手动落位约束校验）与配置体系重构（四类配置统一 schema/预设/导入导出），并完成用户指南补充与全量回归。

#### 机房矩阵数据层与可视化（T3-1 ~ T3-3）

- 新增 `backend/room.py`：`RoomMatrix`（行×列命名自定义、如 A15~O15=225 柜）、`RoomCell`（占位/类型/机柜关联）、`RoomConstraints`（占位阻止/类型设备域/功率上限）、`room_layout.json` 持久化（schema 版本化 + 校验）

- 引擎新增 `room:create` / `room:validate` action；IPC 桥接（handlers/preload/electron.d.ts）

- 前端 `room.store.ts` + `DataCenterLayout.tsx`：矩阵创建面板、SVG 网格渲染（占位斜纹/位置名/机柜名/类型标签）、9 种标记工具（选择/空调/柱子/GPU/网络/存储/通算/组合/清除，点击即标、同项再点切换）

- **手动落位与调整**：左侧机柜面板拖拽上架/移动，落位即时校验（占位阻止、机柜类型域、U 位溢出、功率超限阻塞；功率密度 >350W/U 散热警告）；选中已上架格子可移除；保存前经后端校验

- 5 语言 rack.json 新增 room 命名空间与落位交互文案

#### 配置体系重构（T3-4）

- 新增 `backend/config_schema.py`：四类配置统一模型（appSettings 17 字段 / project / template / wizard），每类 schema 版本 + 字段元数据（类型/默认值/枚举/分组）+ 宽松校验（未知键放行）+ 迁移链框架

- 内置 4 个场景预设（IB 全闪 H100 集群 / RoCE 通用 / L20 推理 / UEC 数据中心），一键套用覆盖设计配置

- 配置导入导出：统一包裹格式 `autolink-config`（format + version + exportedAt + appSettings + projectConfig），导入校验格式/版本/字段类型

- 引擎新增 `config:list-schema` / `config:apply-preset` / `config:export` / `config:import` action（预留 3.1.0 CLI 接口）

- `SettingsPanel` 重构：设置搜索框（过滤分类）、各分组「重置为默认」、新增「配置模板」分类（预设套用 + 导入/导出）

#### 质量闭环（T3-5 ~ T3-6）

- 用户指南新增「6.4 机房矩阵」与「10.6 配置模板与预设」章节

- 全量回归：后端 743 用例（+31 config_schema / room 24）与前端 401 用例（+39 room.store / i18n 完整性）全绿，typecheck 通过

#### 版本与回归

- 版本号 3.0.3 → 3.0.4（package.json / VERSION / package-lock.json）

## [3.0.3] - 2026-08-05

### Release 说明自动更新与发布体验（3.X 系列 · 发布链路）

v3.0.3 聚焦发布链路体验：GitHub Release 页面说明文档从 CHANGELOG.md 自动提取对应版本段落，替代 GitHub 自动生成（英文、无结构）的说明，与软件「关于」对话框、README 保持一致的版本叙事。

#### Release 说明自动更新（T）

- 新增 `scripts/extract_release_notes.py`：从 CHANGELOG.md 提取指定版本 `## [x.y.z]` 段落（支持 `v` 前缀），版本不存在或段落为空时退出码非 0 阻止发布

- `.github/workflows/build.yml` Release 步骤改用 `--notes-file release_notes.md`（替代 `--generate-notes`）：打 tag 推送后自动发布 CHANGELOG 对应段落为 Release 说明

- CHANGELOG.md 补全 v3.0.0 / v3.0.1 / v3.0.2 三条历史条目，与 v2.9.x 格式对齐

#### 版本与回归

- 版本号 3.0.2 → 3.0.3（package.json / VERSION / package-lock.json）

- 提取脚本本地验证：v3.0.0/v3.0.1/v3.0.2/v3.0.3 段落提取正确、边界无泄漏，缺失版本报错退出码 1

## [3.0.2] - 2026-08-05

### 三合一融合网与 1 分 2 扇出 + ZCube/华为超节点（3.X 系列迭代）

v3.0.2 在 v3.0.1 双平面基础上补齐 3.X 组网能力：三合一融合网（存储 + 业务 + 带内管理合一）、1 分 2 扇出（逻辑口模型 + 分裂线缆）、ZCube 扁平二部图、华为超节点（PRD 见 `docs/v3.0/v3.0.X_PRD.md`）。

#### 三合一融合网（T2-5）

- `eth_combined` 融合域：存储 + 业务 + 带内管理合并为单一融合以太网（单层 Leaf），OOB 独立保留，GB300-NVL72 三合一模板落地

- V022 校验：融合交换机存在 + 带内管理可达；融合交换机上架 / 冷板液冷 / 光模块 WARN 检查修复；机柜分配修复

#### 1 分 2 扇出（T2-11）

- NetworkObject 逻辑口模型：物理高速口按 `breakout.count` 拆分为逻辑低速口（端口 1-1 / 1-2），容量上限 = 物理口 × count

- 一对多接线：参数网 / 存储网 / 融合网均按逻辑速率建连，携带归一化 breakout 标注

- 分裂线缆选型闭环：`require_breakout` 匹配 800G→2×400G、400G→2×200G，布线指导表新增"1 分 2"列，V016 容量按逻辑口校验

#### ZCube 与华为超节点（T2-1/T2-3/T2-4）

- ZCube 扁平二部图：无 Spine 双口混合接入，CloudMatrix 384/512 模板

- 华为超节点：UB 域内全对等 + 域间 800G Scale-Out 上联，V021 校验，HuaweiSuperNodePlugin

- 昇腾 CloudMatrix 模板升级 huawei_supernode、新增 cloudmatrix_512 双域；华为方案全系华为设备（昇腾 256 / CloudMatrix 四网改用华为交换机 + CE6885H 档案）

#### 版本与回归

- 版本号 3.0.1 → 3.0.2（package.json / VERSION / package-lock.json）

- 全量回归：vitest 362 passed、pytest 688 passed、golden 基线（GB300-NVL72 三合一）重新生成

## [3.0.1] - 2026-08-04

### 双平面与超大规模拓扑（3.X 重构 · 组网能力落地）

v3.0.1 落地双平面 16 Leaf 组网与超大规模降载（PRD 见 `docs/v3.0/v3.0.X_PRD.md` 4.1.1）。

#### 双平面 16 Leaf（T1-1~T1-8）

- `param_planes` 双平面后端：每平面独立 Leaf/Spine（共 16 Leaf），服务器双口网卡逐平面接入

- 双平面拓扑可视化基础版：平面 A/B 配色可辨识

- 3-tier 服务器超级 Pod 分组 + 前端 Pod 归一化渲染；逐平面校验 + golden 基线

#### 超大规模与模板

- 超大规模拓扑降载：EDGE_LIMIT 边裁剪 + 折叠粒度归一化，2048 台全量报告无失真

- `loadConfig` JSON 优先；B300 默认 Leaf 自动选型 Q3400；DP3Tier-1024 模板与 golden 基线

## [3.0.0] - 2026-08-03

### 引擎重构与发布体系（3.X 系列 · 基础重构）

v3.0.0 是 3.X 系列基础重构版本：架构改为「渲染层（0 网络）+ 主进程 + Python 引擎」，后端 PyInstaller 打包免 Python 运行，CI 全量门禁 + tag 自动发布（PRD 见 `docs/v3.0/v3.0.X_PRD.md`）。

#### 基础重构（T0-1~T0-6）

- 版本切换 + schema 版本化迁移链 + 统一访问器 + golden 基线

- 端口模型显式化 + GPU 池化 / 正交集群（P/D 集群独立组网）

- 拓扑插件接线 + 集群正交模型元数据

- Python 持久 Agent 进程 + 流式事件通道（NDJSON）

#### 打包与 CI（T0-7/T0-8）

- requirements 拆分 + PyInstaller 后端打包（`dist/backend-dist`，免 Python 运行）

- CI 全量门禁：typecheck / lint / vitest / build / validate_templates / golden / pytest

- CI 发布编译 job：tag 触发三平台（Win NSIS / macOS dmg / Linux AppImage+deb）构建并自动发布 Release

#### 修复

- 项目浏览器右键菜单功能丢失（ContextMenu 遮罩拦截右键事件）

## [2.9.9] - 2026-08-02

### 收口与发布（项目模板生命周期打通 · 最终阶段）

v2.9.9 是 v2.9.4~2.9.9「项目模板生命周期打通」系列收官版本：验证导出回归（TypeError 历史遗留修复确认）、全量质量门禁、用户指南模板全流程 5 章节、CI 手动触发支持（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 导出回归验证（T1）

- `scripts/test_export.py` 历史遗留 `TypeError: unhashable type: 'LibraryDevice'` 确认已修复（v2.9.3 已将 `export_bom` 设备分组键由 LibraryDevice 对象改为设备 id 字符串）

- 全量 16 模板逐一验证 `export_bom` + `generate_report_data` 通过，0 失败

#### 全量回归（T2）

- `npx tsc --noEmit` → 0 error；`npx eslint src/ electron/` → 0 error（38 个既有 warning）

- `npm run test` → 354 passed（19 文件）；`python -m pytest tests/backend/ -v` → 560 passed

- `python scripts/validate_templates.py` → 16/16；`python scripts/prepare_templates.py --check` → 16/16

#### 用户指南 5 章节（T3）

- `docs/user_guide/user_guide.md` 第 2 章重构为模板全流程：2.5 从模板创建项目 / 2.6 沉淀与编辑模板（可视化表单）/ 2.7 模板预览 / 2.8 模板分享（导入导出 ZIP 结构与强校验）/ 2.9 模板健康检查

#### 发布与 CI（T4）

- 版本号 2.9.8 → 2.9.9（package.json / VERSION / package-lock.json）

- `.github/workflows/ci.yml` 新增 `workflow_dispatch` 手动触发（含 v2.9.8 加入的 `validate_templates.py` 步骤）

- commit + tag v2.9.9 推送，触发 CI 验证

## [2.9.8] - 2026-08-02

### 模板生命周期管理（项目模板生命周期打通 · 第五阶段）

v2.9.8 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第五阶段：导入强校验、模板健康检查、列表筛选增强、模板验证纳入 CI（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 模板 ZIP 导入强校验（T1）

- `template:importZip` 导入后强校验：无 `project_config.json` 时自动调用 Python 迁移（`migrate` action）补全；含 JSON 时执行 `validate_config` 校验

- 校验失败（JSON 非法/配置语义非法/两者皆无）→ 明确抛错并**回滚删除**已导入的模板目录，杜绝残留损坏模板

#### 模板健康检查（T2）

- 新增 `template:healthCheck` IPC：扫描内置+用户全部模板，逐项检查缺 JSON / JSON 非法 / 配置语义非法（validate_config）/ 选型引用失效（device_refs 引用的设备不在设备库）

- 前端工具栏新增 ❤ 健康检查按钮 + `TemplateHealthModal` 结果弹窗：健康/异常汇总 + 逐项错误详情（含内置徽标）

#### CI 门禁（T3）

- `.github/workflows/ci.yml` 新增 `python scripts/validate_templates.py` 步骤——内置模板损坏时 CI 失败

#### 模板列表增强（T4）

- 模板中心新增筛选行：场景/标签/名称实时搜索 + 内置/用户类型下拉，复用 v2.9.7 规模摘要

#### 用户指南（T5）

- `docs/user_guide/user_guide.md` 增补 2.5 模板分享（导入/导出 ZIP 结构与强校验行为）与 2.6 模板健康检查章节

#### 缓存与测试（T6）

- `project.store` 新增 `templateHealth` 缓存与 `fetchTemplateHealth`/`clearTemplateHealth`；模板增删改（导入/编辑/删除/转模板）后缓存失效

- 新增 5 语言 `common.template.health.*`（12 keys）与 `common.template.filter.*`（4 keys）

- 新增 `template-health-modal.test.tsx` 4 个 RTL 用例：全健康/异常清单/失败/关闭

#### 版本与回归

- 版本号 2.9.7 → 2.9.8（package.json / VERSION / package-lock.json）

- 全量回归：pytest 560 passed、vitest 354 passed（+4）、tsc 0 error、eslint 0 error（38 个既有 warning）、模板验证 16/16 通过

## [2.9.7] - 2026-08-02

### 模板预览与派生文件（项目模板生命周期打通 · 第四阶段）

v2.9.7 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第四阶段：模板列表展示规模摘要，新增"预览方案"能力——以临时目录即时执行设计引擎，弹窗呈现校验状态与统计摘要，不落盘任何派生文件（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 模板规模摘要（T1）

- `template:list` 返回每模板 `summary`：GPU 服务器/全闪/混闪/通算数量、参数网络协议与速率、存储速率、单机柜功率上限（从 `project_config.json` 解析，无 JSON 时 `null`）

- 模板列表项展示摘要行：`GPU n · 存储 n · 通算 n · 协议 速率`

#### 预览方案（T2/T3）

- 新增 `template:preview` IPC：`mkdtemp` 临时目录复制 `project_config.json` → 调用 design 引擎（30s 超时）→ 提取服务器/交换机分级计数/机柜数/总功率/校验状态与错误/收敛比 → `finally` 清理临时目录，不落盘到模板目录

- 模板右键菜单新增"预览方案"；新增 `TemplatePreviewModal` 弹窗：校验状态横幅 + 6 张统计卡片（服务器/交换机/机柜/总功率/协议/收敛比）+ 校验错误列表（最多 8 条）

- 弹窗底部提供"去编辑"与"基于此模板创建项目"快捷入口

#### 无 JSON 模板提示（T4）

- 旧模板无 `project_config.json` 时预览返回 `template.noConfig`，弹窗内明确警告提示（不再静默失败）

#### 派生文件策略固化（T5）

- 预览采用临时目录模式：`topology.json`/`rack_layout.json` 等派生文件仅在临时目录生成，随 `finally` 删除，模板目录保持只读不变

#### i18n 与测试（T6）

- 新增 5 语言 `common.template.preview.*`（15 keys）与 `common.explorer.contextMenu.previewTemplate`

- 新增 `template-preview-modal.test.tsx` 5 个 RTL 用例：成功摘要/无 JSON 提示/校验失败列表/创建项目回调/去编辑回调

#### 版本与回归

- 版本号 2.9.6 → 2.9.7（package.json / VERSION / package-lock.json）

- 全量回归：pytest 560 passed、vitest 350 passed、tsc 0 error、eslint 0 error（37 个既有 warning）、模板验证 16/16 通过

## [2.9.6] - 2026-08-02

### 模板可视化编辑（项目模板生命周期打通 · 第三阶段）

v2.9.6 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第三阶段：将模板编辑从纯 INI 文本升级为可视化表单，支持规模/网络/选型/机柜全量编辑，JSON+INI 双文件同步（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 后端：JSON→INI 反向序列化（T1/T2）

- `migration.project_config_to_ini`：project_config.json 全字段映射回模板 `[DEFAULT]` 段 INI（与 designer `_load_common_ini_config` 键一一对应）；含 `[rack]` 段（冷却/GPU 独占）与 `[scale_up]` 段（非空才输出）

- 存储合并：全闪+混闪 → `additional_storage_servers` 单键（往返按 1/2 拆分，总量一致）

- 网络开关 → `oob_enabled`/`biz_enabled` 布尔

- 新增 engine action `project_config_to_ini`：`validate_config` 校验通过后返回 INI，失败返回具体错误

- `template:update` 扩展 `projectConfig` 字段：JSON.parse + 后端校验 → 写回 `project_config.json` + 同步生成 `network_config.ini`；校验失败明确抛错

#### 前端：EditTemplateModal v2 表单化（T3/T4/T5）

- 重构为可视化表单：基本信息（名称/描述/场景/标签）+ 规模设置（GPU/全闪/混闪/通算数量、网卡/交换机口数、速率、协议 IB/RoCE/UEC、下行模式与 4 网下行数）+ 网络类型（4 Toggle）+ 选型设置（按网络分组，复用 `DeviceLibraryPicker`）+ 机柜设置（42U/49U、功率预设、散热方式、GPU 独占、命名前缀）

- JSON 原文兜底折叠面板：手动编辑 JSON 时以 JSON 为准保存（保存前语法校验），可"从表单重新生成"

- 保存失败（含后端校验失败）保持弹窗打开并展示具体错误

- `ParamProtocol` 类型扩展 UEC；`WizardStepDevices` 存储默认表补 UEC 键

#### 内置模板编辑策略（T6）

- 内置模板仍不可编辑（toast 提示），行为不变

#### i18n 与测试（T7）

- 新增 5 语言 `common.template.editForm.*`（37 keys）

- `test_migration.py` 新增 8 个用例：往返一致性/rack/scale_up/存储合并/网络开关/空 scale_up/action 校验（合法/非法/非字典）

#### 版本与回归

- 版本号 2.9.5 → 2.9.6（package.json / VERSION / package-lock.json）

- 全量回归：pytest 560 passed（+8）、vitest 345 passed、tsc 0 error、eslint 0 error（37 个既有 warning）、模板验证 16/16 通过

## [2.9.5] - 2026-08-02

### 从模板创建项目（项目模板生命周期打通 · 第二阶段）

v2.9.5 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第二阶段：打通"模板 → 项目"完整链路——模板右键入口、向导预加载、后端双路径查找、前端死代码清理（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 后端：project:create 模板支持（T1）

- 模板目录双路径查找：用户模板（user-templates）优先，其次内置模板（template/），均未找到时明确抛错

- 从模板创建项目时全量复制 `project_config.json` + `network_config.ini`（此前只复制 INI）

#### 后端：template:getConfig IPC（T2）

- 新增 `template:getConfig` IPC：返回模板的 project_config.json 内容，供向导预加载

#### 向导：模板配置预加载（T3）

- `wizard.store.loadTemplateConfig`：创建项目向导打开时拉取模板配置并合并（规模/选型/机柜/网络）

- 加载失败或模板无配置时 toast 提示并从头开始（`templateLoadFailed`/`templateNoConfig`）

#### 模板侧边栏：右键"基于此模板创建项目"（T4）

- 模板目录上下文菜单新增"基于此模板创建项目"，一键打开向导并预填模板配置

- 新增 `ui.store.openWizardFromTemplate` + `templateForWizard` 状态

#### 向导基本步骤增强（T5）

- 新增"重置为默认"按钮（`resetConfig`），一键恢复空白向导配置

#### 死代码清理（T6）

- 删除不再使用的 `CreateProjectModal.tsx`（已被向导取代）

#### 前端测试与 i18n（T7/T8）

- `wizard.store.test.ts` 新增 `loadTemplateConfig`/`resetConfig` 用例

- 新增 5 语言 key：`common.explorer.contextMenu.createFromTemplate`、`common.templateLoadFailed`/`templateNoConfig`、`project.resetToDefault`

#### 版本与回归

- 版本号 2.9.4 → 2.9.5（package.json / VERSION / package-lock.json）

- 全量回归：pytest 552 passed、vitest 345 passed、tsc 0 error、eslint 0 error（36 个既有 warning）、模板验证 16/16 通过

## [2.9.4] - 2026-08-02

### 模板数据模型与库治理（项目模板生命周期打通 · 第一阶段）

v2.9.4 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第一阶段：为每个内置模板补齐 `project_config.json`（规模/选型/机柜/网络的唯一权威载体），并升级模板生成与验证脚本，为"从模板创建项目"打好数据地基（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 迁移引擎支持模板 INI（T1）

- `migration.ini_to_project_config` 支持 `[DEFAULT]` 段（模板风格），兼容旧 `[topology]` 段

- 新增映射：`additional_storage_servers`（拆分为全闪/混闪）、`additional_compute_servers`、`rail_mode`/`rail_count`/`param_protocol`/`biz_chassis_threshold`

- `[rack]` 段支持 `cooling_method`/`gpu_dedicated`（V2.9.1 rack_config 扩展）；存储数量为 0 时正确拆分为 0+0

#### 模板预生成脚本（T2）

- 新建 `scripts/prepare_templates.py`：INI → JSON 批量生成 + 按模板语义覆盖 GPU 选型 + 校验（validate_config + 设备库解析）；幂等，`--force` 覆盖，`--check` dry-run

#### 选型规则收敛（T3）

- `_get_default_device_refs` 补充 `gpu_server` 与 designer 别名键（`param_switch`/`storage_switch`/`storage_server`）

- 参数交换机按协议+速率选型（IB/UEC/RoCE × 200G/400G/800G），与 `designer._auto_select_param_switch` 一致

- `designer._load_project_config` 新增别名收敛：向导键名（`param_leaf_switch`/`all_flash_storage_server`）自动映射为 designer 键名

#### 内置模板库治理（T4）

- 16 个内置模板全部生成并人工校准 `project_config.json`（GPU 选型：H100/L20/GB300 NVL72/MLU590/昇腾 910C/海光 K100/B200 等）

- 11 个模板补充 `[rack]` 段机柜配置（功率上限 8K~18KW、液冷-H100-256 为 cold_plate、GPU 独占）

- `template.json` 增加 `templateVersion: 2`；修复 cambricon_mlu_cluster 缺失的 template.json

#### 模板验证升级（T5）

- `validate_templates.py` 升级：project_config.json 完整性、device_refs 全量解析、INI/JSON 设计拓扑等价、机柜功率/U 位/上架检查

- 全量结果：`prepare_templates.py` 16/16 OK，`validate_templates.py` 16/16 通过

#### 版本与回归（T7）

- 版本号 2.9.3 → 2.9.4（package.json / VERSION / package-lock.json）

- 全量回归：pytest 552 passed（新增 12 个迁移/别名用例）、vitest 341 passed、tsc 0 error、eslint 0 error（37 个既有 warning）

## [2.9.3] - 2026-08-02

### 能力补强收口（3.0 前收官 · 第三阶段）

v2.9.3 是 3.0 前收官最后阶段：Scale-Up 双栈转正、校验硬规则扩到 19 条、PDF 报告修复完善、端口前缀解析补齐、UEC/模板一致性治理（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### Scale-Up 配置层（T1）

- JSON 顶层 `scale_up` 段 + INI `[scale_up]` section，`bandwidth` 兼容旧命名 `bandwidth_per_link_gbps`

- 旧配置缺失该段 → `scale_up_config=None` 不报错；INI→JSON 迁移保留 scale_up

- `project_config.validate_config` 新增可选 scale_up 校验（protocol 枚举 + 数值类型）

#### Scale-Up 生成层（T2）

- designer 主流程接入：GPU 以 `NetworkObject(obj_type='scaleup_gpu', network_type='scale_up', domain_id, protocol)` 纳入体系

- 域内全对等边双向挂接 Connection，`scale_up_connections` 按无向 pair 去重

#### Scale-Up 机柜层（T3）

- RackAllocator 新增 `CABINET_TYPE_SCALEUP`，GPU 节点 1 台/柜独占，域内柜号相邻

- engine 输出 scale_up 节点（domainId/protocol/networkType）与 summary.scaleUp

#### Scale-Up 前端与报告（T4）

- TopologyTab/RackTab 消费 scale_up 数据：拓扑边渲染、机柜类型 scaleup（琥珀色）

- 报告概览/架构/机柜章节含 Scale-Up 汇总

#### 校验硬规则 V016-V019（T5）

- V016 服务器网卡容量、V017 光模块封装/距离匹配、V018 Pod/域规模、V019 整机房功率，规则数 15→19

#### PDF 报告修复与完善（T6）

- 项目名称取 meta.name（修 bug）、机柜表全量渲染（repeatRows=1）、BOM 按型号聚合

- 新增设备清单/收敛比章节，收敛比读 estimation 计算值（非硬编码）

#### 端口前缀解析补齐（T7）

- `_resolve_device_port_prefixes` 实现 storage/oob/biz 命名前缀（接口模型驱动 + 默认值兜底）

- `_wire_storage` / OOB / 业务网连线端口按对应前缀命名

#### UEC/模板一致性（T8）

- `validate_config` 接受 UEC 协议（IB/RoCE/UEC），与 designer 自动选型一致

- ualink_1_0_1024 / cloudmatrix_384 / NVL72-单架 三模板补 scale_up 配置（名实相符：UALink 1024 / UB 384 / NVLink 72 单域）

#### 版本与回归（T9）

- 版本号 2.9.2 → 2.9.3（package.json / VERSION / package-lock.json）

- 全量回归：pytest（新增 15 个用例）、tsc、eslint、vitest 全绿

## [2.9.2] - 2026-08-02

### 体验精细打磨（3.0 前收官 · 第二阶段）

v2.9.2 聚焦使用体验的精细打磨：统一空态/弹窗/组件、工作区 Tab 项目隔离与未保存确认、长操作真实进度反馈、表单校验完善、首次引导与无障碍（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### EmptyState 统一落地（T1）

- RackTab/Topology3DTab/OutputTab/ProjectListPanel/DataCenterTab/FileViewerTab 无数据场景统一 `ui/EmptyState`（图标 + 标题 + 描述 + 可选操作）

- 删除 ProjectOverviewTab 本地 EmptyState 副本，改为复用 ui 组件

#### 弹窗统一 ui/Modal（T2）

- DeviceImportModal / DeviceExportModal / ImportCabinetsModal 统一走 `ui/Modal`（ESC 关闭 / 焦点陷阱 / 滚动锁定 / aria-labelledby）

- 导入解析失败、导出失败在弹窗内展示错误；导出增加 try/catch 与 exporting 状态

#### ui/ 组件库业务落地（T3）

- DataCenterTab 布局参数、DeviceLibraryTab 搜索/厂商筛选、DesignTab 数字输入与开关全部切换为 `ui/Input`、`ui/Select`、`ui/NumberInput`、`ui/Toggle`

#### 工作区 Tab 项目隔离 + 未保存确认（T4）

- Tab 状态携带 `projectName`（persist 版本 v1→v2），切换项目自动清理旧项目 Tab，删除项目清理其持久化 Tab

- Design/Rack Tab 配置变更标记 `dirty`，关闭时弹确认（标题 + 文案 + 仍要关闭）

- Tab 栏无障碍：`role=tab` / `aria-selected` / 键盘 Enter 激活 / 关闭按钮 `aria-label`，dirty 圆点指示

- OutputTab 错误信息 i18n 化（`fileViewer.loadFailed`）

#### loading 真实化（T5）

- DeviceImportModal / FileViewerTab / OutputTab Excel 解析改分片（`parseWorkbookChunked`）+ 真实进度条

- TopologyTab / DataCenterTab PNG 导出按钮转圈 + 禁用（导出中防重复点击）

#### 表单校验完善（T6）

- ProjectWizard 分步校验：名称必填/长度/去重、网络必选、设备必选、机柜功率上限按散热方式联动校验，按钮下方 inline 错误

- WizardStepBasic 名称错误态（红框 + 文案 + maxLength=50 + 重名提示）

- WizardStepDevices 服务器数量上限（≤2048）红框提示

- WizardStepRack 切换散热方式自动收敛功率上限

#### 首次引导 + 无障碍（T7）

- 首启 3 步 OnboardingModal（创建项目 → 配置设计 → 可视化与交付），看过一次不再弹出

- 搜索清除 / 导出按钮补 `aria-label`

#### i18n 与版本（T8）

- 新增 key：dirty 关闭确认、解析进度、wizard 校验、onboarding 引导，5 语言同步补齐

- 版本号 2.9.1 → 2.9.2（package.json / VERSION / package-lock.json）

## [2.9.1] - 2026-08-02

### 质量工程闭环（3.0 前收官 · 第一阶段）

v2.9.1 是 3.0 前"质量工程闭环"首个子版本，聚焦工程质量与性能基线（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### 死代码清理与重复合并（T1/T2）

- 删除 `src/components/sidebar/` 下 7 个零引用死文件（Explorer/Output/Design/DeviceLibrary/Rack/Topology/Workbench Panel）

- `handlers.ts` 两处 `walkDir` 文件树遍历合并为公共函数，project/template 结构查询共用

- `template:getFile` 复用通用路径防护 `sanitizeUnderBase`

- `project-io.service.ts` `importProjectZip`/`importTemplateZip` 抽取公共 `extractZipCommon`（安全校验→命名冲突后缀→白名单解压→元数据同步）

#### 错误反馈补齐（T3）

- 拓扑保存/机柜布局保存/项目列表刷新失败均有 toast 提示（design.store / rack.store / project.store）

- 设备 Excel 导入解析失败在弹窗内红色错误提示（parseError），切换 Tab 清空

- 存储数量字段双 schema 兼容替代 `as any`

#### any 类型治理（T4）

- 修复 10+ 处 `catch (e: any)` / 强转链：MenuBar、AboutDialog、WorkspaceView、CreateProjectWizard、WorkbenchActionCard、Topology3DTab、ImportCabinetsModal、exportTopology、preload、WizardStepDevices 等

- `eslint no-explicit-any` 恢复 **error**（`src/test/**` 测试 mock 数据豁免）

- eslint 从 10 errors → **0 errors**

#### 测试补缺（T5）

- 新建 `test_ub_topology.py`（25 用例）：UBConfig 默认值/域划分/全对等连接数/端口命名/统计/engine schema 兼容

- `test_validation.py` 追加 V011（PUE≤1.3 合规）/V012（OCP 冷板接口）/V013（信创比例≥50%）正反例（9 用例）

- `test_scaleup_and_plugin.py` 追加 biz/oob 插件 generate_topology 用例

- `test_designer_integration.py` 追加超大-2048（3-tier）集成用例：16 Pod×128 台、三层 Core 存在、拓扑自检通过

#### 性能优化（T6）

- `topology.py`：Leaf/Spine 查找从 O(n) 线性扫描改为 name→对象 dict 索引，消除 2048 台场景约 840 万次无效迭代

- `rack_allocation.py`：按机柜类型分桶索引 + U 位满柜惰性移除，`_find_fit_cabinet` 不再全量扫描

- **2048 台全流程设计耗时 1.29s → 0.51s**（含拓扑自检，目标 <2s）

#### 模板验证扩展（T7）

- `validate_templates.py` 自动发现并覆盖**全部 16 模板**（原 7 个），新增机柜分配/功率超限/U 位重叠/上架覆盖率检查

- **修复存储网络连接 bug**：`_wire_storage` 每台服务器固定生成 1 条存储连接，`storage_ports_per_server=2` 时只连一半（cambricon/cloudmatrix/hygon/ualink/uec 5 模板受影响）→ 按端口数生成多条并轮转分配 Leaf，16/16 模板通过

#### 回归

- tsc 0 errors、eslint 0 errors、vitest 335 passed、pytest 495 passed、16/16 模板验证通过

## [2.9.0] - 2026-08-02

### 机柜规划与上架逻辑重构

v2.9.0 系列让机柜规划从"简单轮转"升级为"物理约束装箱"，贴近真实机房上架规则（PRD 见 `docs/v2.9/v2.9.X_PRD.md`）。

#### 机柜核心算法（v2.9.0）

- **多约束装箱算法**: 新建 `backend/rack_allocation.py`，功率 + U 位双约束 + 设备类型区分（GPU/通算/存储/网络）；GPU 高功率（≥50% 上限）独占机柜，128×DGX H100（10.2KW）在 12/16KW 柜自动 **1 台/柜**；通算/存储 15 台/柜；网络设备按网段聚柜

- **交换机机柜分配**: param/storage/oob/biz 交换机全部参与上架（网络柜），拓扑连线机柜字段补齐，oob/biz 分配后回填连接机柜信息

- **机柜功率汇总含交换机**: `_calculate_power_summary` 遍历全部设备，输出每柜 type/设备数/功率/利用率/超限标记

- **V002 校验升级**: 阈值取 `min(散热方式上限, power_limit_per_rack)`，6000W 柜不再等 15000W 才报警

- **功率密度联动**: 机柜数含网络柜，密度估算与分配一致

#### 机柜配置与报告（v2.9.1）

- `rack_config` 扩展：`cooling_method`（air/cold_plate/immersion）、`gpu_dedicated`（独占开关）、`power_preset`（功率预设）

- `WizardStepRack` 增强：功率预设快速按钮（6/12/16/30/60KW）、散热方式选择、GPU 独占开关

- 报告/PDF 新增"机柜规划"章节（柜号/类型/设备数/功率/利用率/超限），功率密度与散热配置一致性提示

#### 前端机柜体验（v2.9.2）

- `rack.store` 重构：`initFromTopology` 优先后端分配并按类型分类（gpu/storage/compute/network），`loadRackLayout` 无布局回退空状态（不再虚构 4 柜）

- 机柜类型着色：机架视图类型徽章 + 机房平面图类型角标（GPU 红/网络蓝/存储绿/通算黄）

- i18n：新增 rack 命名空间 5 语言 + key 完整性测试

#### 双栈与智能分组（v2.9.3）

- Scale-Up 域聚柜验证：GPU 服务器组（域）输入有序 → 柜号连续

- 新校验规则 **V014**（GPU 高功率柜多台共柜告警）、**V015**（机柜利用率 <30% 提示）

- 修复 `scripts/test_export.py` TypeError（`library.get(profile)` 传入不可哈希的 LibraryDevice → 改传 `profile.id`）

- 回归测试: tsc 0 errors、eslint 0 errors、vitest 335 passed、pytest 456 passed

## [2.8.0] - 2026-08-02

### 体验与性能

v2.8.0 系列聚焦文件加载、拓扑持久化与交互编辑三大体验升级，按 v2.8.0~v2.8.3 四个子版本交付（PRD 见 `docs/v2.8/v2.8.X_PRD.md`）。

#### v2.8.0 文件加载与查看

- **Excel 一次性加载**: 新增 `ExcelTable` 统一组件 + 模块级缓存（`excel-cache.ts`，容量 50），FileViewerTab 一次解析全部 sheet，切 sheet 纯状态切换零重载

- **图片乱码修复**: 图片文件（png/jpg/gif/webp/svg）走 `getFileBinary` + MIME 归一渲染 `<img>`，不再按 UTF-8 文本读入 `<pre>`（`file-type.ts`）

- **输出目录体验**: `listOutputFiles` type 小写归一、`listOutputBatches` 新增虚拟 `[根目录]` 批次（根目录文件如导出的拓扑 PNG 可见），根目录批次常展开且不可删除

#### v2.8.1 拓扑持久化与可加载

- **拓扑布局落盘**: topology.json schema 升级 v2（新增 `layout` 字段），保存布局写回项目输出文件，重新生成时保留已保存布局（过滤失效节点）

- **原始拓扑可编辑**: 项目列表点击 topology.json 直接打开拓扑视图，继续编辑并可再次保存；新增 `removeTopologyNodes`/`restoreTopology` 删除与恢复

- **未保存指示器**: 工具栏显示布局"已保存/未保存"状态，重置布局同步清理落盘文件

#### v2.8.2 拓扑交互增强

- **框选拖动**: 多选节点可整体拖动调整位置（selectionOnDrag），支持 Delete/Backspace 删除选中节点（撤销可恢复）、Esc 取消选区/退出框选、Space 临时平移

- **悬浮信息**: 网元悬浮显示 id/类型/组/Pod/机柜/U位/功率/连接数（NodeToolbar）；链路悬浮高亮 + 详情面板（源端/目标端/速率/网络类型/缆型/描述）

- **链路标签**: 边标签显示开关（缩放 <0.5 自动隐藏），对齐工具栏（左/右/上/下按选区边界对齐）

- **撤销/重做升级**: 完整拓扑快照（positions+nodes+edges）替代纯位置快照，删除节点可恢复

- **性能优化**: hover 仅目标节点新建对象，其余复用引用

#### v2.8.3 文案与一致性

- **i18n key 补全**: 5 语言（zh-CN/en/zh-TW/ja/ko）补齐 `menu.visualization`、`update.releaseNotes`、`menu.deviceLibrary`、`design.exportPdf`、PUE 估算、`workbench.cablingGuide/bom` 等缺失 key，修复编程 ID 泄漏

- **topology.json 重写**: 新增 40+ key（viewTitle/nodes/connections/saveLayout/edgeLabels/alignLeft/nodeDetail 等），拓扑视图全面接入 i18n

- **防回归测试**: 新增"i18n key 完整性（以 zh-CN 为基准）"测试（77 用例），4 语言缺失 key 将直接失败

- 回归测试: tsc 0 errors、eslint 0 errors、vitest 330 passed

## [2.7.7] - 2026-08-02

### 修复

- **更新检查误报修复**: 当 `app.getVersion()` 返回无法解析的值（如 "unknown"/空字符串）时，原 `compareVersions` 会误判为"线上有新版本"导致即使线上版本 = 当前版本仍触发更新提示。现统一使用严格比较 `isVersionNewer()`，线上版本 ≤ 当前版本或当前版本无效时一律不触发更新

- 新增 `electron/utils/version.ts` 版本比较工具，主路径（electron-updater）与 fallback 通道统一复用

- fallback 通道仅在确认有新版本时缓存下载信息，避免污染后续下载路径

- 新增 10 个单元测试（`src/test/update-version.test.ts`）覆盖相等/大于/小于/无效版本场景

- 回归测试: tsc 0 errors、eslint 0 errors、vitest 323 passed、pytest 424 passed

## [2.7.6] - 2026-08-02

### 双栈与标准

v2.7.6 支持 Scale-Up/Scale-Out 双栈规划，预置 UEC/UALink 新标准，预研插件化架构与 3D 可视化，完成 10 项任务。

#### 双栈拓扑规划 (T1-T5)

- **T1**: Scale-Up 拓扑规划（`backend/scaleup_topology.py`），支持 NVLink / UALink / UB 三种协议的 Pod 内全对等互联

- **T2**: Scale-Out 拓扑规划扩展，`param_protocol` 新增 UEC（Ultra Ethernet Consortium）支持，自动选型 CPO/硅光交换机

- **T3**: UEC 1.0 拓扑模板（`template/uec_1_0_cluster/`），1024 GPU 集群，RoCE 400G Scale-Out

- **T4**: UALink 1.0 拓扑模板（`template/ualink_1_0_1024/`），1024 GPU Pod，Scale-Up 全对等互联 + Scale-Out RoCE 400G

- **T5**: 双栈联合视图，拓扑视图支持 Scale-Up 网络类型（琥珀色连线 + GPU 节点可视化）

#### 插件化架构 (T6-T8)

- **T6**: 网络类型插件化接口（`backend/network_plugin.py`），定义 `NetworkPlugin` 抽象接口，内置 param/storage/biz/oob/scale_up 5 个插件

- **T7**: `engine.py` action 注册表化，action 处理改为 decorator 注册（`@register_action`），新增 action 无需改主逻辑

- **T8**: 设备库 category 动态化，从 `library_index.json` 动态读取目录（优先 `category.directory` 字段），新增 category 无需改代码

#### 预研 (T9-T10)

- **T9**: 3D 可视化 PoC（`src/components/workspace/tabs/Topology3DTab.tsx`），基于 react-three-fiber，分层摆放 + 彩色连接 + OrbitControls

- **T10**: AI 辅助容量规划预研文档（`docs/v2.7/ai_capacity_planning_research.md`），调研 MoE/长上下文/FP8 训练负载反推带宽与收敛比

#### 其他

- 新增 `src/three-fiber.d.ts` 类型兼容声明，解决 @react-three/fiber v8 与 React 19 的 JSX 命名空间冲突

- 新增测试 `tests/backend/test_scaleup_and_plugin.py`（26 用例），覆盖 Scale-Up 拓扑与插件化扩展性

- 回归测试: tsc 0 errors、eslint 0 errors、vitest 313 passed、pytest 424 passed

## [2.7.5] - 2026-08-02

### 国产生态与信创

v2.7.5 构建国产算力生态壁垒，支持昇腾/海光/寒武纪国产设备，完成 9 项任务。

#### CloudMatrix 超节点 (T1-T3)

- **T1**: 昇腾 CloudMatrix 384 超节点拓扑模板（384 颗 910C NPU + 192 颗鲲鹏 CPU）

- **T2**: UB 统一总线拓扑算法（`backend/ub_topology.py`），全对等互联，单卡 2800Gbps

- **T3**: 昇腾 910C NPU 设备库完善，含 UB 总线接口参数

#### 国产设备模板 (T4-T6)

- **T4**: 海光 DCU 集群拓扑模板（64 台 K100，RoCE 200G）

- **T5**: 寒武纪 MLU 集群拓扑模板（128 台 MLU590，RoCE 200G）

- **T6**: 国产交换机生态完善，新增新华三 51.2T CPO 硅光交换机、锐捷 1.6T 交换机

#### 信创校验与报告 (T7-T9)

- **T7**: 信创比例校验规则 V013，统计国产设备占比，<30% INFO、<50% WARNING

- **T8**: 信创合规报告导出（`export_compliance_report`），含设备清单与占比统计

- **T9**: 国产设备库分类标签，设备增加 `origin`/`lead_time` 字段，`library_index.json` 更新

#### 设备库扩展

- `DeviceProfile` 新增 `origin`（国产/进口/混合）和 `lead_time`（供货周期）字段

- 设备库总数从 114 增至 117（新增 ascend_910c、h3c_s12500r_cpo_51_2t、ruijie_s6910_32oc2vs_1_6t）

## [2.7.4] - 2026-08-02

### 专业能力增强

v2.7.4 增强光模块/液冷/PUE/PDF 的专业度，对标行业最新标准，完成 11 项任务。

#### 光模块多技术路线 (T1-T3)

- **T1**: 光模块库补充 1.6T 多路线（硅光/LPO/EML/薄膜铌酸锂 TFLN），新增 4 款 1.6T 模块

- **T2**: 光模块选型支持 MMF/SMF 严格匹配，新增 `fiber_type` 参数与 `_SPEC_FIBER_MAP` 映射表

- **T3**: BOM 清单支持成本/功耗/供货周期权衡，`OpticalSelection` 扩展 `power_w`/`lead_time_weeks`/`unit_cost_lo/hi` 字段

#### 液冷与 PUE 增强 (T4-T6)

- **T4**: 液冷模型增加 OCP 冷板标准接口校验规则 V012，校验冷却液类型（PG25/PG40/FC3283/water）

- **T5**: PUE 模型增强，新增湿度修正、UPS 冗余损耗（N/N+1/2N）、冷热通道隔离参数

- **T6**: 新增校验规则 V011，PUE > 1.3 时报合规警告（区别于 V003 的 1.25 优化目标）

#### PDF 报告增强 (T7-T8)

- **T7**: PDF 报告增加图表（功率分布柱状图、光模块成本饼图），使用 matplotlib 动态生成

- **T8**: PDF 报告增加页眉（项目名+版本）、页脚（页码）、目录

#### 设备清单与算法优化 (T9-T11)

- **T9**: `generate_device_list` 从 device_library 拉取 vendor/model 填充设备清单

- **T10**: 收敛比计算增加 Spine fanout，提供 Leaf 级和全局两级收敛比（3-tier CLOS）

- **T11**: Excel 美化算法优化，从 8 次遍历减少到 2 次（单次遍历 + 预计算合并区域），万级连接导出 ≤ 5s

#### 设备库扩展

- 设备 schema 新增 `tech_route`（技术路线）、`origin`（国产/进口）、`lead_time`（供货周期）字段

## [2.7.3] - 2026-08-02

### 体验与性能

v2.7.3 修复前端体验痛点，优化大规模拓扑性能，完成 15 项任务。

#### 快捷键与布局 (T1-T5)

- **T1**: 全局快捷键注册，`src/utils/shortcuts.ts` 集中管理快捷键映射表

- **T2**: ShortcutsDialog 从 shortcuts.ts 自动生成，对话框列出的快捷键全部可用

- **T3**: ContextMenu 边界检测，靠近右/下边缘时菜单自动调整位置

- **T4**: ResizableAppLayout 迁移 react-resizable-panels，支持 a11y、键盘、持久化

- **T5**: app/edge token 亮色补全，亮色模式下色调统一

#### 性能优化 (T6-T8)

- **T6**: 拓扑布局算法迁移 Web Worker，2048 节点布局不阻塞主线程

- **T7**: TopologyTab 引用稳定化，`React.memo` + 自定义 `areEqual` 避免全量重渲染

- **T8**: Tab 懒加载，首屏仅加载当前 Tab 代码

#### UI 组件库 (T9-T11)

- **T9**: UI 组件库导出补齐 Modal/ContextMenu/Toggle/SettingsRow

- **T10**: 新增 Tooltip/Dropdown/Tabs 组件

- **T11**: 处理哑设置项 fontSize/compactMode/animations，接入 CSS 变量

#### FileExplorer 拆分与优化 (T12-T15)

- **T12**: 设备库列表虚拟化（@tanstack/react-virtual），500+ 设备滚动流畅

- **T13**: FileExplorer 拆分为 ProjectListPanel/FileTreePanel/SettingsPanel/TemplateSaveDialog

- **T14**: 原生 prompt() 替换为 RenameProjectModal（复用组件）

- **T15**: Toast 优化，容器位置调整 + 悬停暂停计时

## [2.7.2] - 2026-08-02

### 算法可用性

v2.7.2 让 validation 引擎与 Rail-Optimized 算法真正生效,统一配置格式,完成 12 项任务。

#### 校验引擎接入 (T1-T3)

- **T1**: `validation.py` 接入 `engine.handle_design`,替换简化版校验为 10 条规则结构化校验 (V001-V010)

- **T2**: 修复 V004/V005/V009 字段映射,与 engine.py 的 edge schema 对齐 (`a_port_type` → `speed`, `network_type` 改为英文枚举)

- **T3**: 前端 `ValidationPanel.tsx` 重写,按规则 ID 分组展示,支持折叠/展开,错误优先

#### Rail-Optimized 拓扑修复 (T4-T5)

- **T4**: 修复 `rail_topology.py` 连接生成,光模块型号 (`a_module`/`z_module`) 使用 `network_speed` 变量,端口名改用计数器

- **T5**: 服务器分配改为交错模式 (`idx % rail_count`),符合 NVIDIA SuperPOD 规范,单 Rail 故障不集中

#### 配置统一与持久化 (T6-T7)

- **T6**: `design:generate` 改为合并更新 `project_config.json`,保留 `rail_mode`/`param_protocol` 等扩展字段

- **T7**: `DesignConfig` 接口补充 `rail_mode`/`rail_count`/`param_protocol` 字段,DesignTab UI 增加配置控件

#### 设备选型与网络增强 (T8-T9)

- **T8**: `designer.py` 根据 `param_protocol` (IB/RoCE) 自动选择参数网交换机 (IB→NVIDIA Quantum, RoCE→H3C S9820)

- **T9**: 存储网放开 3-tier 限制,根据服务器数量自动判断是否升级为 3-tier 拓扑

#### 项目迁移与端口适配 (T10-T12)

- **T10**: 项目加载时自动检测 V2.0 INI 格式并迁移为 V2.1 JSON 格式

- **T11**: OOB/业务网下联口数从设备档案 `port_count` 读取,覆盖硬编码 48/32

- **T12**: 业务网框式阈值参数化,`biz_chassis_threshold`/`biz_chassis_frames_map` 可配置,移除硬编码 128/512/1024 → 4/8/18

#### Bug 修复(回归测试发现)

- 修复 INI 模式缺少 `biz_chassis_threshold` 属性导致 33 个测试失败

- 修复 `LibraryDevice` 无 `port_prefix` 属性问题 (改用 `name_prefix`)

- 补充缺失的 `_calc_biz_chassis_frames` 方法

#### 测试统计

- 前端:304 passed (15 files)

- 后端:398 passed

- TypeScript:0 errors

- ESLint:0 errors (78 warnings)

***

## [2.7.1] - 2026-08-01

### 质量基线

v2.7.1 建立质量门禁,补齐核心算法测试,修复 VERSION 同步问题。

#### CI 质量门禁

- CI 增加 vitest(前端) + pytest(后端) 测试步骤,PR 全绿方可合并

- CI 增加 VERSION 文件与 package.json version 一致性校验

- CI 增加 ruff(Python lint) + mypy(类型检查) 步骤

#### 后端算法测试补齐(94 用例)

- 新建 `test_validation.py`:覆盖 V001-V010 共 10 条校验规则,每条 ≥1 正例 + ≥1 反例

- 新建 `test_estimation.py`:覆盖 PUE 估算(风冷/冷板/浸没 + 温度/自然冷/负载率)、收敛比(4 种网络类型)、机柜密度(5 档)

- 新建 `test_optical_selector.py`:覆盖速率解析、距离估算、规格推荐、选型逻辑、价格估算

#### 前端 Store 测试补齐(108 用例)

- explorer.store(15)、render.store(16)、toast.store(10)、ui.store(17)、wizard.store(20)、workspace.store(20)、ProjectContext(10)

- 覆盖状态变更、action 调用、persist 中间件、边界情况

#### Bug 修复

- VERSION 文件从 2.6.9 同步至 2.7.1

#### 测试统计

- 前端:304 passed(15 files)

- 后端:393 passed

- TypeScript:0 errors

- ESLint:0 errors

***

## [2.7.0] - 2026-08-01

### 三项核心修复

#### 1. 暗色模式拖拽分隔线颜色修复

- **问题**：暗色模式下中栏（文件浏览器）与工作区之间的垂直拖拽分隔线显示为白色，视觉突兀

- **根因**：`ResizableAppLayout.tsx` 使用 `dark:bg-edge-default` 类，但 Tailwind 的 `edge.DEFAULT` 生成的类名是 `bg-edge`（无后缀），`bg-edge-default` 是无效类，导致暗色模式下未覆盖亮色的 `bg-gray-200`

- **修复**：`dark:bg-edge-default` → `dark:bg-edge`（渲染为 `#484F58` 暗灰，与水平分隔线一致）

#### 2. 项目浏览器目录显示修复

- **问题**：应用重启后，项目浏览器中已展开的目录/子目录无法正确显示对应文件，点击无响应

- **根因**：`explorer.store.ts` 持久化了 `expandedProjects`（展开状态）但不持久化 `projectStructures`（结构缓存）。重启后项目显示为"已展开"但结构缓存为空，而 `toggleProjectExpand` 的条件 `!currently && !projectStructures[name]` 因 `currently===true` 跳过了结构拉取

- **修复**：

  - `toggleProjectExpand` 条件改为 `!projectStructures[projectName]`（不依赖当前展开状态）

  - 新增 `useEffect`：组件挂载时自动为所有"已展开但无结构缓存"的项目拉取结构

#### 3. 自动更新下载重构

- **问题**：检查到新版本后点击下载无反应或失败，原实现回退到打开浏览器而非真正下载

- **根因**：国内网络下 `electron-updater.checkForUpdates()` 失败后走 fallback 通道，但 fallback 只解析了 version 未解析下载信息；`downloadUpdate()` 因 electron-updater 内部无 `updateInfo` 缓存而抛错

- **修复**（`update.service.ts` 重构）：

  - **增强 fallback 检查**：解析 `latest.yml` 的 `path` 字段（当前平台安装包文件名），构造下载 URL 并缓存

  - **平台适配**：新增 `getPlatformYmlName()`，Windows/macOS/Linux 分别请求 `latest.yml`/`latest-mac.yml`/`latest-linux.yml`

  - **正向直接下载**：新增 `downloadInstallerFile()`，用 Electron net 模块直接下载安装包到本地下载目录，手动处理 GitHub 的 302 重定向，实时发送下载进度

  - **多级 fallback**：electron-updater 下载 → 直接下载安装包 → 打开浏览器

  - **安装支持**：`quitAndInstall()` 检测直接下载场景，打开本地安装包并退出应用

### 涉及文件

- `src/components/layout/ResizableAppLayout.tsx`：拖拽线颜色修复

- `src/components/layout/FileExplorer.tsx`：项目浏览器结构缓存恢复

- `electron/services/update.service.ts`：自动更新下载逻辑重构

- `README.md`：版本号更新至 2.7.0，自动更新章节重写

- `docs/deployment.md`：版本号更新至 2.7.0，自动更新机制章节重写，新增下载失败 FAQ

- `package.json`：版本号 2.6.9 → 2.7.0

### 回归测试

- TypeScript typecheck：0 errors

- ESLint：0 errors（7 warnings 为历史遗留）

***

## [2.6.5] - 2026-07-31

### 更新检查机制修复

#### 问题根因

v2.6.3 及之前版本的 `checkForUpdates` 在网络失败或 electron-updater 模块异常时,catch 吞掉错误并返回 `{ updateAvailable: false }`,前端显示"已是最新版本",误导用户以为没有新版本,实际是检查失败(国内 GitHub Releases 访问超时)。

#### 修复方案

- **备用更新检查通道**:新增 `checkLatestYmlFallback`,使用 Electron `net` 模块(走 Chromium 网络栈)直接请求 `releases/latest/download/latest.yml` 并解析版本号。当 electron-updater 主路径失败时自动启用

- **错误信息透传**:`checkForUpdates` 返回类型增加 `error?: string` 字段,前端可区分"无更新"与"检查失败"

- **15 秒超时**:备用通道设置 15 秒超时,避免长时间挂起

- **版本比较修正**:主路径增加 `compareVersions` 比较,避免 electron-updater 在 dev 模式下误报

- **手动下载入口**:检查失败时 UI 显示"手动下载"按钮,一键打开 GitHub Releases 页面

- **新增 IPC**:`app:open-releases-page` 打开浏览器跳转 Releases

- **5 语言 i18n**:新增 `update.manualDownload` key(手动下载/Manual Download/手動ダウンロード/수동 다운로드/手動下載)

#### 涉及文件

- `electron/services/update.service.ts`:新增备用检查通道 + 错误透传 + openReleasesPage

- `electron/ipc/handlers.ts`:新增 `app:open-releases-page` IPC

- `electron/preload.ts`:暴露 `openReleasesPage` API

- `src/types/electron.d.ts`:更新 checkUpdate 返回类型

- `src/components/layout/UpdatePopover.tsx`:区分"无更新"与"检查失败",添加手动下载按钮

- `src/i18n/resources/*/common.json`:5 语言补充 manualDownload

### 回归测试

- TypeScript typecheck:0 errors

- 前端 vitest:196/196 通过

***

## [2.6.4] - 2026-07-31

### v2.6.3 收尾:文档补齐与 U3 组件抽取

- **U3 收尾**:抽取 `ui/Toggle.tsx` 和 `ui/SettingsRow.tsx` 通用组件,迁移 FileExplorer 内联定义(`Toggle`/`ToggleMini`/`SettingsSection`/`SettingsRow`/`INPUT_CLASS`)

- **CHANGELOG**:补齐 v2.5.0-v2.6.3 全部变更记录

- **README**:更新至 V2.6 功能说明(拓扑持久化/自动更新/本地用户指南/PDF 报告/设备库一致性校验)

- **deployment.md**:重写为 V2.6 版本(自动更新机制/数据持久化/reportlab 依赖/V2.6 常见问题)

- **user_guide.md**:新增第 11 章「自动更新」,项目结构补充 topology.json/rack_layout.json,输出类型补充 PDF 报告,设置补充「重置工作区」,常见问题补充 Q8-Q10

- **v2.6.3 PRD**:状态更新为已完成,验收清单全部勾选

### 回归测试

- TypeScript typecheck:0 errors

- ESLint:0 errors(78 warnings 为历史遗留)

- 前端 vitest:196/196 通过

- 后端 pytest:299/299 通过

***

## [2.6.3] - 2026-07-31

### UI 系统优化（U1-U9 全部完成）

#### P0 用户关注点

- **U1 项目浏览器信息密度增强**：项目项卡片化（状态点 + 名称 + 文件数 + 时间 + 收藏）；输出文件按扩展名显示类型图标（xlsx/csv/png/json 等）；模板项卡片化（描述 + 标签 + 内置徽章）

- **U2 关于界面排版优化**：4 区块内边距统一（px-6 / px-4）；字号梯度从 5 种收敛到 3 种；快捷链接图标统一 12px；版权走 i18n（`about.copyright`）；AboutSettings 版本号动态获取

- **U3 设置界面优化**：删除死代码 `SettingsPanel.tsx`；控件宽度统一（select w-32 / input w-20）；抽象 `ui/Toggle.tsx` + `ui/SettingsRow.tsx` + `INPUT_CLASS` 常量；快捷键列表以 MenuBar ShortcutsDialog 为权威源

- **U4 全局字体体系统一**：tailwind.config.js 新增 `text-2xs`(10px)/`text-3xs`(9px) token；中文字体堆栈配置 PingFang SC / Microsoft YaHei / Hiragino Sans GB / Source Han Sans CN；全项目迁移 `text-[10px]`/`text-[11px]`/`text-[9px]`/`text-[8px]` 任意值类（248 处 → 0）；修复 `gray-750`/`gray-850` 无效颜色类

#### P1 结构性优化

- **U5 颜色体系统一**：启用语义色板 success/error/warning/info 替换 green/red/amber/blue 基础色（333 处）；新建 `constants/topology-colors.ts` 统一 TopologyNodes 与 exportTopology 节点色常量

- **U6 通用 Modal 组件**：新建 `ui/Modal.tsx`（ESC 关闭/遮罩关闭/焦点陷阱/body 滚动锁定可配置）；迁移 ConfirmDeleteDialog / RenameProjectModal / CreateProjectWizardModal / AboutDialog / EditTemplateModal / ShortcutsDialog

- **U7 通用 ContextMenu 组件**：新建 `ui/ContextMenu.tsx`（统一 z-index / 点击外部关闭 / 分隔线 / 禁用态 / 危险态 / 图标支持）；迁移 FileExplorer + WorkspaceView 右键菜单

- **U8 i18n 补全**：App.tsx Tab 标题、18 处 toast 消息、ConfirmDeleteDialog、ErrorBoundary、WorkspaceErrorBoundary、LogPanel 全部走 i18n（5 语言对齐）

- **U9 删除死代码**：`SettingsPanel.tsx` / `WorkspaceWelcome.tsx` / `WorkspaceTabBar.tsx` 全部删除

### 回归测试

- TypeScript typecheck：0 errors

- ESLint：0 errors（78 warnings 为历史遗留）

- 前端 vitest：196/196 通过

- 后端 pytest：299/299 通过

***

## [2.6.2] - 2026-07-31

### 核心功能修复与持久化

#### T1 更新功能致命 bug 修复

- **根因**：`electron-updater` 错误放在 `devDependencies`，打包后 asar 内模块缺失，`import('electron-updater')` 静默失败导致更新功能完全失效

- **修复**：将 `electron-updater` 移到 `dependencies`；`update.service.ts` 增加 dev 模式 `forceDevRunConfig` 支持

- **验证**：打包后 app.asar 内包含 electron-updater 模块

#### T2 关于页面软件栈修复

- `handlers.ts` 使用 `app.getAppPath()` 替代 `__dirname/../..` 读取 package.json（修复打包后路径失效）

- 依赖读取合并 `dependencies` + `devDependencies`（修复 typescript/vite 显示 `-`）

- Python 检测增加 `py --version`（Windows py launcher）回退

#### T3 关于页面产品简介

- AboutDialog 新增 `app.description` 段落

- 5 语言 common.json 补充 `app.description` key

#### T4 菜单栏 Logo

- Header.tsx 在 MenuBar 前插入 Logo（macOS 自动避让红绿灯按钮）

#### T5 编辑菜单扩充

- Edit 菜单从 1 项扩充为 9 项：撤销/重做/剪切/复制/粘贴/全选/查找/首选项

- 调用 Clipboard API 与 `document.execCommand` 实现基础功能

#### T6 拓扑数据按项目持久化（核心）

- 新增 `project:saveFile` IPC（白名单：`topology.json` / `rack_layout.json` / `network_config.ini`）

- `design.store` 改为读写项目根目录 `topology.json`；加载失败清空 store（不残留上个项目）

- `rack.store` 改为保存 `rack_layout.json` 到项目根目录；防抖 500ms 自动保存

- `project.store.selectProject` 统一加载入口：异步加载 config + topology + rack layout

- 项目导出 ZIP 白名单纳入 `topology.json` / `rack_layout.json`

### 测试验证

- TypeScript typecheck：0 errors

- 前端 vitest：196/196 通过

- 后端 pytest：299/299 通过

- CI 三平台构建成功（run id: 30614761805）

***

## [2.6.1] - 2026-07-31

### 体验完善与死代码清理

#### R12 全局 ErrorBoundary

- App.tsx 最外层加 ErrorBoundary 包裹整个 render 树

- 各 Modal 独立 ErrorBoundary，避免组件崩溃导致白屏

- Workspace 组件均包裹 WorkspaceErrorBoundary

#### R13 workspace.store 持久化校验

- 加载持久化 tabs 时通过 `project:list` 校验项目存在性，无效 tabs 自动过滤

- `reopenLastClosedClosed` 同步校验

- Tab 状态持久化在 localStorage，可通过「Reset Workspace」按钮重置

#### R14-R15 死代码清理与拆分

- 删除 `sidebar/` 目录 9 个未引用文件

- 删除 `WorkspaceTabBar.tsx` / `WorkspaceWelcome.tsx`

- FileExplorer.tsx 从 1736 行按模块拆分为 6 个 Explorer 子组件

- TopologyTab.tsx 从 855 行按职责拆分为 hooks + 子组件

#### R16 TopologyTab 暗色模式适配

- 使用 MutationObserver 追踪 dark mode 变化

- ECharts 配色方案随主题切换

#### R17-R18 MenuBar i18n 与快捷键单一数据源

- MenuBar 全部菜单名/菜单项/Toast/ShortcutsDialog 走 i18n（5 语言）

- AboutDialog 快捷键链接复用 ShortcutsDialog 单一数据源

- 菜单栏语言随 UI 语言切换同步更新

***

## [2.6.0] - 2026-07-30

### 紧急缺陷修复（用户反馈 8 项 + P0 隐藏 bug）

#### R1 多语言机制修复

- `device` 命名空间 4 语言（en/ja/ko/zh-TW）补齐

- `i18n/index.ts` 启动时从 `ui.store` 读取持久化 language，修复刷新后语言错位

- 关键硬编码中文（SettingsPanel/FileExplorer 右键菜单/WorkspaceView 卡片）i18n 化

#### R3 关于弹窗内容修正

- 软件栈补充 Python 后端版本（11 项）

- 快捷键链接改为打开本地弹窗（非跳转浏览器）

- 版权信息动态年份、Logo 尺寸修正为 96px

- 移除 `t()` 调用的第二参数回退文案

#### R4 向导对话框滚动机制

- CreateProjectWizardModal 模态添加 `overflow-hidden`

- Header/步骤指示器/底部按钮栏加 `shrink-0`

- 800px 屏幕下底部按钮始终可见

#### R5 设备选型 IB/RoCE 联动

- `migration.py` 存储交换机按 `protocol` 分流（IB → NVIDIA Quantum，RoCE → 华为 CE6881）

- `WizardStepDevices.tsx` `STORAGE_DEFAULTS_BY_PROTOCOL` 区分协议

- 协议切换联动纳入 `storage_leaf_switch`

- 设备库补充 IB 存储交换机型号（NVIDIA SN5600/SN4700）

#### R6 设备库数据纠正

- 修正 `h3c_s6850_56hf.json`：从错误的 200G 存储交换机改为 25G 业务交换机（category/port_speed/port_type/description/tags 全字段修正，物理文件移目录）

- 修正 `library_index.json` 中 `huawei_ce6860_48s6cq` 归属（switches_storage → switches_biz）

- `device_library.py` 加载时加一致性校验（category 字段与目录一致）

- 业务交换机默认选型从 10G 改为 25G，与 `biz_port_speed='25G'` 对齐

#### R7 一键渲染修复

- `handleQuickRender` 改为跳转工作台 + toast 提示（方案 A）

- `OutputTab.tsx` 修复 `getFileBinary` 调用参数（从 useProjectStore 取 projectName，路径加 `output/` 前缀）

#### R8 项目浏览器文件树展开

- "全部项目" TreeItem 改为可展开，调 `project:getStructure` 拉取目录树递归渲染

- 新增"输入文件" Section（network_config.ini / project_config.json / project.json）

- 展开状态提升到 `explorer.store`，关闭侧栏再开状态保留

#### R9-R11 P0 隐藏 bug 修复

- preload 暴露 `dialog.openDirectory`（此前完全未实现）

- `getFileBinary` 返回类型统一为 `Promise<string | null>`（base64）

- `device-library:export` 返回类型对齐

- `versions` 类型补 chromium 字段

- `shell:openPath`/`showItemInFolder` 移除 `sanitizePath` 限制（修复导出 ZIP 打开目录被拦截）

- 根目录 5 个重复 Python 文件清理

### 测试验证

- 前端 vitest：196/196 通过

- 后端 pytest：299/299 通过

***

## [2.5.0] - 2026-07-30

### V2.4 系列延续与质量验收

- 完成 V2.4 PRD 验收与质量评估（完成度 65% → 验收通过）

- Logo 设计规范文档化（[docs/v2.5/logo_specification.md](docs/v2.5/logo_specification.md)）

- 启动加载动画优化（粒子背景 + 旋转环 + 进度条）

- 更新机制完善：版本号动态化、首次启动自动检测更新并 toast 通知、Release Notes 折叠展示、下载进度条优化

- 项目复制/重命名/导出导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）

- 批量项目导出（工具栏按钮）

- 模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）

- 模板导入导出 ZIP

- 项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）

- 5 种语言 i18n 文案补齐

### 测试验证

- 后端 pytest：267/267 通过

- TypeScript typecheck：无错误

***

## [2.4.6] - 2026-07-30

### 补齐半成品功能（V2.4 PRD 完成度 48% → 65%）

#### Phase J1: Rail-Optimized 架构集成

- NetworkObject 新增 `rail_id`/`rail_role` 字段（NVIDIA SuperPOD 8-Rail 标准）

- rail_topology.py 传递 Rail 字段到 Leaf/Spine

- designer.py 新增 `rail_mode` 配置开关（standard / rail_optimized）

- 新增 `_create_rail_optimized_switches` 和 `_wire_rail_optimized` 方法

- engine.py 输出 `railMode`/`railCount`/`railId`/`railRole` 字段

- 新增 9 个 Rail-Optimized 单元测试 + 集成测试

#### Phase J2: 规则校验前端

- engine.py 新增 `validationIssues` 结构化问题列表输出

- design.store.ts 新增 `ValidationIssue` 类型和 `validationIssues` 状态

- 新建 ValidationPanel.tsx 组件：问题列表 + 严重程度图标 + 修复建议

- DesignTab.tsx 集成 ValidationPanel 替换原布尔值显示

- 5 种语言 i18n 文案更新（zh-CN/en/zh-TW/ja/ko）

#### Phase J3: PDF 报告生成

- 新增 reportlab 依赖

- exporter.py 新增 `export_pdf_report` 函数：6 章节 PDF（概览/架构/功耗/光模块/成本/校验）

- 中文字体自动检测（Windows 微软雅黑 / Linux 文泉驿 / fallback Helvetica）

- engine.py 新增 `pdfReport` 导出类型

- ReportViewPanel.tsx 新增"导出 PDF"按钮

- 新增 3 个 PDF 生成测试

#### Phase J4: 液冷配置面板

- 确认 PUEEstimatePanel 已完整实现液冷配置：

  - 散热方式选择（风冷 / 冷板液冷 / 浸没式液冷）

  - 室外温度、负载率、UPS 效率、自然冷开关

#### Phase J5: cluster_512 模板

- 新增"中型-512"模板：512 H100 GPU + 48 存储 + 24 通算

- 三层 Fat-Tree 400G，4 POD × 128 GPU/POD

### 测试验证

- 后端 pytest：267/267 通过（含新增 12 个测试）

- TypeScript typecheck：无错误

- 累计完成率：65%

## [2.4.5] - 2026-07-29

### 拓扑布局四象限分区 + 服务器组垂直居中

- 重构布局算法：服务器区中心化 + 四象限网络设备分区（OOB 左上 / 业务 右上 / 参数 左下 / 存储 右下）

- 服务器区"概念宽度"自适应容纳网络设备区，网络设备始终在服务器区 X 范围内（需求8：服务器左右无网络设备）

- 左右半区对称分配（以中心为界），确保左半区在中心左侧、右半区在中心右侧

- 服务器节点在概念宽度内居中排列

- 服务器组垂直居中：动态计算 verticalGap，使上方间距 ≈ 下方间距（差值 ≤ 20px）

- topRegionHeight 包含 Y_AGG 顶部边距，消除计算偏差

- layoutBottomRegion 使用动态 verticalGap，确保底部间距与顶部间距相等

- 16:9 比例自适应（容差 ±15%）

- 布局版本号升级到 v4，自动清除旧 localStorage 布局数据

- POD 背景框改为轻量细虚线样式，减少视觉干扰

### 测试覆盖

- 新增 AC10 服务器组垂直居中测试（上方间距 ≈ 下方间距，差值 ≤ 20px）

- 27 个前端布局测试全部通过（含四象限分区 AC2/AC3/AC4/AC6/AC7/AC9/AC10 + E2E H100-100台 217节点）

- 255 个后端 pytest 全部通过

- TypeScript typecheck 无错误

## [2.4.1] - 2026-07-29

### 项目与模板生命周期管理完善

- 新增项目复制功能（右键菜单 → 复制项目，自动追加 _副本 后缀）

- 新增项目重命名功能（右键菜单 → 重命名）

- 新增项目导出/导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）

- 新增批量项目导出（工具栏按钮，选择目录后批量打包）

- 新增模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）

- 新增模板导出/导入 ZIP

- 新增项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）

- 新增 5 种语言 i18n 文案（zh-CN/en/ja/ko/zh-TW）

- 优化 TemplateSection 标题栏，hover 显示导入按钮

- 优化 Section 组件支持右侧操作按钮

### 应用图标与启动动画

- 新应用图标：网络拓扑"A"形设计，蓝青色渐变（build/logo.svg）

- 新启动加载动画：粒子背景 + 旋转环 + 进度条 + 三点加载指示器（public/splash.html）

- 启动时主窗口隐藏，加载完成后显示

### 更新机制完善

- 版本号动态化（从 package.json 读取，不再硬编码）

- 启动时自动检测更新并 toast 通知（仅首次提示）

- Release Notes 折叠展示（点击展开/收起）

- 下载进度条 + 错误提示优化

## [2.4.0] - 2026-07-29

### Phase A: 数据资产扩展

- 设备库从 56 款扩展至 109+ 款

- 新增光模块库（30 款，100G-1.6T 全速率覆盖）

- 新增并行文件系统存储节点（BeeGFS、IBM Scale、WekaIO、DDN、VAST）

- 新增国产化 GPU（华为昇腾 910B、海光 K100 AI、寒武纪 MLU590）

- 新增 7 套智算场景模板（SuperPOD-256、NVL72、L20-推理等）

### Phase B: 后端引擎

- Rail-Optimized 拓扑算法（NVIDIA SuperPOD 8-Rail 架构）

- PUE 估算模型（风冷 / 冷板液冷 / 浸没式液冷）

- 收敛比计算（参数网 / 存储网 / 业务网）

- 规则校验引擎（10 条核心规则）

- 光模块智能选型器

### Phase C: 后端导出

- 布线指导表导出（含光模块型号、长度估算、成本）

- BOM 成本估算导出

- 报告数据生成（概览/架构/功耗/光模块/成本/校验）

### Phase D: 前端智能专业能力对接

- PUE 估算结果展示组件（能耗分解、达标判断、参数化重新估算）

- 报告数据可视化展示组件（可折叠，按需加载）

- 新增 cablingGuide / bom 导出选项

### 可视化重构（P0 重点）

- 拓扑渲染引擎从 ECharts 迁移至 react-flow

- 分层 × 分区 × 分组三维防重叠布局

- 节点拖拽、框选、缩放、小地图

- 参数网/存储网/业务网/OOB 功能分区

### 打包与部署

- 修复打包后模板路径（`resourcesPath/template`）

- 安装包内置 11 套场景模板 + 109+ 款设备库

- 首次启动自动创建 3 个示例项目

- 三平台 CI 矩阵（Windows NSIS / macOS DMG x64+arm64 / Linux AppImage+DEB）

***

## [2.3.0] - 2026-07-29

### 设计系统

- 新增 Tailwind 语义色系：`success`、`error`、`warning`、`info`

- 新增暗色模式自定义滚动条样式

- 新增 CSS Design Tokens（`--color-surface`、`--radius-*`、`--font-size-base`）

- 新增 `prefers-reduced-motion` 适配

- 新增共享 UI 组件库（`Button`、`Input`、`Select`、`EmptyState`、`SectionCard`、`FormSection`、`NumberInput`）

### 缺陷修复

- 修复 Toast 无最大条数限制（最多 5 条）

- 向导创建项目失败现在会显示错误 Toast

- 错误边界合并为通用组件，支持重试时强制重新挂载

- 修正 `app:getVersion` 从 `package.json` 动态读取版本号

- 移除 `handlers.ts` 中 `categoryPathMap` 三处重复定义，提取为模块常量

- 移除菜单中无功能的"撤销/重做"项

### 交互优化

- 新增 `Ctrl+S` 快捷键触发保存配置

- 新增 Tab 右键菜单（关闭 / 关闭其他 / 关闭右侧 / 关闭全部）

- 新增首次使用引导（"新建项目 / 打开 Demo"按钮）

- Resizable 面板拖拽手柄始终可见（`bg-gray-200`）

- ActivityBar 选中态增强（`bg-primary-100 dark:bg-primary-900/40`）

***

## [2.2.0] - 2026-07-29

### Bug 修复

- 修复 `rack.store` 中 `initFromTopology` 设备丢失 bug

- 修复 ActivityBar 切换后高亮不更新的问题

- 修复 4 个 P0 设备数据错误（端口速率/类型/品类）

### 功能增强

- MenuBar 全部 24 个菜单项关联功能回调

- ActivityBar 新增设备库入口（Cpu 图标，Ctrl+Shift+L）

- 侧边栏新增 DeviceLibExplorer（7 个设备分类）

- 设备库侧边栏与工作区 Tab 联动过滤

### 拓扑优化

- 节点改为矩形，服务器 `100×26` 横条、交换机 `72-96×32-44`

- 层级重排：业务/OOB 在上 → 服务器居中 → 参数/存储在下

- 服务器按连接的 param_leaf 自动分组，组间 80px 间隔

- 水平间距从 90 增至 120

### 机柜规划

- RackTab 新增左侧待分配设备列表 + 点击 U 位放置交互

- 设备冲突红色高亮、功率不足提示

***

## [2.1.0] - 2026-07-28

### 功能

- 设备库系统：50+ 设备 JSON 配置，按品类分类

- 项目向导：5 步创建（基本信息 → 网络 → 设备 → 机柜 → 确认）

- 机柜规划：42U/49U 可视化，功率监控，Excel 导出

- 拓扑可视化：ECharts 渲染，多网络过滤，布局保存/恢复

***

## [2.0.0] - 2026-07-27

### 初始版本

- Electron + React + Python 架构

- Activity + Tab 双导航系统

- Fat-Tree 拓扑自动计算（二层/三层）

- 连接表导出

- 5 种语言国际化

